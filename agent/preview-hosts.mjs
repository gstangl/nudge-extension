// Preview ownership follows the serving process's worktree, never a branch-name
// guess or a shared proxy port. Portless is optional; no app framework is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ORIGIN_OK } from '../bridge/http-boundary.mjs'

const cwdCache = new Map()
export function processCwd(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null
  try { process.kill(pid, 0) } catch { return null }
  const cached = cwdCache.get(pid)
  if (cached && Date.now() - cached.at < 5000) return cached.cwd
  try {
    const cwd = process.platform === 'linux' ? fs.readlinkSync(`/proc/${pid}/cwd`)
      : execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').find(line => line.startsWith('n'))?.slice(1)
    const real = cwd ? fs.realpathSync(cwd) : null
    cwdCache.set(pid, { at: Date.now(), cwd: real })
    return real
  } catch { return null }
}

export function previewHost(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !ORIGIN_OK.test(url.origin) || url.username || url.password || url.port === '0') throw new Error('preview URL must be an HTTP local app')
  return url.host.replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
}

export function discoverPreviews({ cwd = process.cwd(), env = process.env, home = os.homedir(), lookupCwd = processCwd } = {}) {
  let project = fs.realpathSync(cwd)
  try { project = fs.realpathSync(execFileSync('git', ['-C', project, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim()) } catch { /* plain local project */ }
  const state = env.PORTLESS_STATE_DIR || path.join(home, '.portless')
  let routes, port
  try {
    routes = JSON.parse(fs.readFileSync(path.join(state, 'routes.json'), 'utf8'))
    port = Number(fs.readFileSync(path.join(state, 'proxy.port'), 'utf8').trim())
  } catch { return { project, previews: [] } }
  if (!Array.isArray(routes) || !Number.isInteger(port) || port < 1 || port > 65535 || fs.existsSync(path.join(state, 'proxy.tls'))) return { project, previews: [] }
  const previews = []
  for (const route of routes.slice(0, 256)) {
    if (!Number.isInteger(route.pid) || !Number.isInteger(route.port) || route.port < 1 || route.port > 65535) continue
    const servingCwd = lookupCwd(route.pid)
    if (!servingCwd || (servingCwd !== project && !servingCwd.startsWith(project + path.sep))) continue
    try {
      const url = `http://${route.hostname}:${port}`
      const host = previewHost(url)
      if (host !== `${route.hostname}:${port}`) continue
      previews.push({ url, host, serverPort: route.port, pid: route.pid })
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
