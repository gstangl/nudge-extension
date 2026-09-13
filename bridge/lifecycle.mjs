// One bounded lifecycle check for native hosts, agent hooks and future Safari
// helpers. A listening TCP port is not evidence that it is our bridge.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const validPort = port => Number.isInteger(port) && port > 0 && port <= 65535
export async function bridgeIdentity({ port = 4700, fetchImpl = fetch, timeoutMs = 700 } = {}) {
  if (!validPort(port)) throw new Error('invalid bridge port')
  const response = await fetchImpl(`http://127.0.0.1:${port}/.identity`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`identity returned ${response.status}`)
  return response.json()
}
function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return null
  let current = path.resolve(value)
  const suffix = []
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...suffix) } catch (error) {
      if (error.code !== 'ENOENT' || current === path.dirname(current)) return null
      suffix.unshift(path.basename(current)); current = path.dirname(current)
    }
  }
}
export function compatibleIdentity(identity, { store, app = 'groundworks-nudge' } = {}) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) || identity.app !== app) return false
  const version = typeof identity.version === 'string' && /^(0)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(identity.version)
  if (!version || Number(version[2]) < 19) return false
  if (!['sourceBoundEvidence', 'submissionIdempotency', 'lifecycleIdentity'].every(key => identity.capabilities?.[key] === 1)) return false
  const actual = canonicalPath(identity.store)
  return !!actual && (store === undefined || actual === canonicalPath(store))
}
function connectionRefused(error) {
  if (!error) return false
  if (error.code === 'ECONNREFUSED') return true
  if (error.cause) return connectionRefused(error.cause)
  return Array.isArray(error.errors) && error.errors.length > 0 && error.errors.every(connectionRefused)
}
export async function ensureBridge({ port = 4700, store, bridge, env = process.env, spawnImpl = spawn, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!validPort(port) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid bridge lifecycle configuration')
  if (store !== undefined && !canonicalPath(store)) throw new Error('invalid canonical store path')
  const expected = { port, store, fetchImpl }
  try {
    const identity = await bridgeIdentity(expected)
    if (compatibleIdentity(identity, expected)) return { state: 'running', identity }
    throw new Error('an incompatible listener owns the requested port')
  } catch (error) {
    // HTTP errors, malformed JSON, resets and timeouts establish an unhealthy
    // listener, not an absent one. Never spawn or kill a process in those cases.
    if (!connectionRefused(error)) throw error
  }
  if (typeof bridge !== 'string' || !path.isAbsolute(bridge)) throw new Error('an absolute bridge entry point is required')
  const child = spawnImpl(process.execPath, [bridge], { detached: true, stdio: 'ignore', env: { ...env, NUDGE_PORT: String(port), ...(store ? { NUDGE_STORE: store } : {}) } })
  let spawnError = null
  child.once('error', error => { spawnError = error })
  child.unref()
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    await wait(Math.min(120, deadline - Date.now()))
    if (spawnError) throw new Error(`bridge spawn failed: ${spawnError.message}`)
    if (Date.now() >= deadline) break
    try {
      const identity = await bridgeIdentity({ ...expected, timeoutMs: Math.max(1, Math.min(700, deadline - Date.now())) })
      if (compatibleIdentity(identity, expected)) return { state: 'started', identity }
      throw new Error('an incompatible listener owns the requested port')
    } catch (error) { last = error; if (!connectionRefused(error)) break }
  }
  throw new Error(`bridge did not become healthy: ${last?.message || 'startup timeout'}`)
}
