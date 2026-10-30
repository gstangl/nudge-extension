// Preview ownership follows the serving process's worktree, never a branch-name
// guess or a shared proxy port. Portless is optional; no app framework is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ORIGIN_OK } from '../bridge/http-boundary.mjs'

function inspectLsof(args, run) {
  try { return run('lsof', args, { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch (error) {
    // A missing/stopped route makes lsof exit 1 even when other requested
    // listeners were found. Those complete records still prove ownership.
    if (error.status === 1 && typeof error.stdout === 'string') return error.stdout
    throw error
  }
}

export function processDirectories(pids, { platform = process.platform, procRoot = '/proc', run = execFileSync } = {}) {
  const wanted = [...new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0))]
  const result = new Map()
  const add = (pid, cwd) => {
    try { if (wanted.includes(pid)) result.set(pid, fs.realpathSync(cwd)) } catch { /* exited or unreadable process */ }
  }
  if (platform === 'linux') {
    for (const pid of wanted) {
      try { add(pid, fs.readlinkSync(path.join(procRoot, String(pid), 'cwd'))) } catch { /* exited process */ }
    }
  } else if (wanted.length) {
    try {
      const output = inspectLsof(['-a', '-p', wanted.join(','), '-d', 'cwd', '-Fpn'], run)
      let pid = null
      for (const line of output.split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1))
        if (line.startsWith('n')) add(pid, line.slice(1))
      }
    } catch { /* no visible cwd */ }
  }
  return result
}

export function processCwd(pid) {
  return processDirectories([pid]).get(pid) || null
}

export function previewHost(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !ORIGIN_OK.test(url.origin) || url.username || url.password || url.port === '0') throw new Error('preview URL must be an HTTP or HTTPS local app')
  return url.host.replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
}

export function listeningPorts(ports, { platform = process.platform, procRoot = '/proc', run = execFileSync } = {}) {
  const wanted = new Set(ports.filter(port => Number.isInteger(port) && port > 0 && port <= 65535))
  const result = new Map([...wanted].map(port => [port, new Set()]))
  if (!wanted.size) return result
  if (platform !== 'linux') {
    try {
      // One bounded process snapshot per discovery, not one lsof per route.
      // Multiple worktree watchers must not block their wake loop on N scans.
      const output = inspectLsof(['-nP', '-a', ...[...wanted].map(port => `-iTCP:${port}`), '-sTCP:LISTEN', '-Fpn'], run)
      let pid = null
      for (const line of output.split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1))
        if (line.startsWith('n') && Number.isInteger(pid) && pid > 0) result.get(Number(line.slice(line.lastIndexOf(':') + 1)))?.add(pid)
      }
    } catch { /* no visible listener */ }
    return result
  }
  // Linux does not require lsof: LISTEN sockets expose their inode in tcp/tcp6;
  // a process owns that inode through a socket fd. Ignore races with exits.
  const inodes = new Map()
  for (const table of ['tcp', 'tcp6']) {
    try {
      for (const line of fs.readFileSync(path.join(procRoot, 'net', table), 'utf8').split('\n')) {
        const columns = line.trim().split(/\s+/)
        const port = parseInt(columns[1]?.split(':').at(-1), 16)
        if (columns[3] === '0A' && wanted.has(port)) inodes.set(columns[9], port)
      }
    } catch { /* IPv4 or IPv6 may be unavailable */ }
  }
  if (!inodes.size) return result
  let entries
  try { entries = fs.readdirSync(procRoot) } catch { return result }
  for (const pid of entries.filter(entry => /^[1-9]\d*$/.test(entry))) {
    const fdDir = path.join(procRoot, pid, 'fd')
    let fds
    try { fds = fs.readdirSync(fdDir) } catch { continue }
    for (const fd of fds) {
      try {
        const inode = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join(fdDir, fd)))?.[1]
        result.get(inodes.get(inode))?.add(Number(pid))
      } catch { /* exited process or closed fd */ }
    }
  }
  return result
}

export function listeningProcesses(port, options) {
  return [...(listeningPorts([port], options).get(port) || [])]
}

export function discoverPreviews({ cwd = process.cwd(), env = process.env, home = os.homedir(), lookupCwd = processCwd, lookupListeners = null } = {}) {
  let project = fs.realpathSync(cwd)
  try { project = fs.realpathSync(execFileSync('git', ['-C', project, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim()) } catch { /* plain local project */ }
  const state = env.PORTLESS_STATE_DIR || path.join(home, '.portless')
  let routes, port
  try {
    routes = JSON.parse(fs.readFileSync(path.join(state, 'routes.json'), 'utf8'))
    port = Number(fs.readFileSync(path.join(state, 'proxy.port'), 'utf8').trim())
  } catch { return { project, previews: [] } }
  if (!Array.isArray(routes) || !Number.isInteger(port) || port < 1 || port > 65535) return { project, previews: [] }
  const scheme = fs.existsSync(path.join(state, 'proxy.tls')) ? 'https' : 'http'
  let proxyPid = null
  try { proxyPid = Number(fs.readFileSync(path.join(state, 'proxy.pid'), 'utf8').trim()) } catch { /* older state */ }
  const snapshot = lookupListeners ? null : listeningPorts(routes.slice(0, 256).filter(route => route && route.port !== port).map(route => route.port))
  const listenersAt = lookupListeners || (port => [...(snapshot.get(port) || [])])
  const directories = lookupCwd === processCwd ? processDirectories(routes.slice(0, 256).filter(route => route && route.port !== port).flatMap(route => {
    const listeners = listenersAt(route.port)
    return listeners.length ? listeners : [route.pid]
  })) : null
  const cwdOf = directories ? pid => directories.get(pid) : lookupCwd
  const previews = []
  for (const route of routes.slice(0, 256)) {
    if (!route || !Number.isInteger(route.port) || route.port < 1 || route.port > 65535 || route.port === port) continue
    try {
      const url = `${scheme}://${route.hostname}:${port}`
      const host = previewHost(url)
      if (new URL(url).hostname !== route.hostname) continue
      const listeners = listenersAt(route.port)
      const pids = listeners.length ? listeners : [route.pid]
      // A known foreign/unreadable listener must never fall back to proxy cwd.
      if (!pids.every(pid => {
        if (pid === proxyPid) return false
        const cwd = cwdOf(pid)
        if (!cwd) return false
        const servingCwd = fs.realpathSync(cwd)
        return servingCwd === project || servingCwd.startsWith(project + path.sep)
      })) continue
      previews.push({ url, host, serverPort: route.port, pid: pids[0] })
    } catch { /* malformed or nonlocal route */ }
  }
  return { project, previews }
}

// A bridge may discover an older watcher's cwd in a short-lived child process,
// keeping process inspection off its HTTP/WS event loop.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = processCwd(Number(process.argv[2]))
  console.log(JSON.stringify(cwd ? discoverPreviews({ cwd }).previews.map(preview => preview.host) : []))
}
