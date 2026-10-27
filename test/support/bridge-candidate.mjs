// Test-only executable boundary. Never discover, stop or replace a live bridge.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const delay = ms => new Promise(r => setTimeout(r, ms))
export async function until(fn, ms = 5000, description = 'condition') {
  const start = performance.now()
  while (performance.now() - start < ms) { const value = await fn(); if (value) return value; await delay(20) }
  throw new Error(`deadline: ${description}`)
}
export async function freePort(port = 0) {
  if (port === 4700) throw new Error('live default port refused')
  const server = net.createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve))
  const allocated = server.address().port
  await new Promise(resolve => server.close(resolve))
  if (allocated === 4700) throw new Error('live default port refused')
  return allocated
}
export function binding() {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).filter(n => !n.startsWith('artifacts/') && !n.startsWith('test/artifacts/'))
  const files = names.sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')])
  return { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files }
}
export async function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  try { process.kill(-child.pid, signal) } catch (e) { if (e.code !== 'ESRCH') throw e }
  let timer
  await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 1500) })]); clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) { process.kill(-child.pid, 'SIGKILL'); await closed }
}
export function ownedChild(argv, env, log) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw new Error('argument-array command required')
  const child = spawn(argv[0], argv.slice(1), { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.on('error', error => log?.('spawn-error', String(error)))
  child.stdout.on('data', b => log?.('stdout', b.toString())); child.stderr.on('data', b => log?.('stderr', b.toString()))
  return child
}
export function isolatedEnv(store, port, extra = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(CLAUDE|CODEX|NUDGE|PIN_)/.test(key)) delete env[key]
  return { ...env, NUDGE_STORE: store, NUDGE_PORT: String(port), NUDGE_NO_RELOAD: '1', ...extra }
}
export async function candidate({ argv, port, fixture, log = () => {} } = {}) {
  port = await freePort(port)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-comparison-'))
  const store = path.join(home, 'store'); fs.mkdirSync(store)
  if (fixture) fs.cpSync(fixture, store, { recursive: true })
  argv ||= process.env.NUDGE_CANDIDATE ? JSON.parse(process.env.NUDGE_CANDIDATE) : [process.execPath, path.join(root, 'bridge/bridge.mjs')]
  const env = isolatedEnv(store, port)
  let child
  const api = {
    port, home, store, env, argv, get child() { return child },
    async start() {
      await freePort(port)
      child = ownedChild(argv, env, log)
      try {
        const identity = await until(async () => {
          if (child.exitCode !== null || child.signalCode !== null) throw new Error('candidate exited before readiness')
          try { return await (await fetch(`http://127.0.0.1:${port}/.identity`, { signal: AbortSignal.timeout(200) })).json() } catch { return null }
        }, 5000, 'candidate identity')
        if (identity.app !== 'groundworks-nudge' || fs.realpathSync(identity.store) !== fs.realpathSync(store) || identity.capabilities?.submissionIdempotency !== 1) throw new Error('candidate identity/store mismatch')
        const lease = JSON.parse(fs.readFileSync(path.join(store, '.bridge-writer-lease.json')))
        if (lease.pid !== child.pid) throw new Error('candidate lease PID mismatch')
        return identity
      } catch (error) { await stop(child); throw error }
    },
    async request(route, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      return { status: response.status, body: await response.json() }
    },
    read() { return JSON.parse(fs.readFileSync(path.join(store, 'store.json'), 'utf8')) },
    async stop(signal) { await stop(child, signal) },
    async close() { await stop(child) },
  }
  return api
}
