// One bounded lifecycle check for native hosts, agent hooks and future Safari
// helpers. A listening TCP port is not evidence that it is our bridge.
import { spawn } from 'node:child_process'
import path from 'node:path'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
export async function bridgeIdentity({ port = 4700, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/.identity`, { signal: AbortSignal.timeout(700) })
  if (!response.ok) throw new Error(`identity returned ${response.status}`)
  return response.json()
}
export function compatibleIdentity(identity, { store, app = 'groundworks-nudge' } = {}) {
  if (!identity || identity.app !== app || !identity.capabilities?.sourceBoundEvidence || !identity.capabilities?.submissionIdempotency) return false
  return !store || path.resolve(identity.store) === path.resolve(store)
}
export async function ensureBridge({ port = 4700, store, bridge, env = process.env, spawnImpl = spawn } = {}) {
  const expected = { port, store }
  try {
    const identity = await bridgeIdentity(expected)
    if (compatibleIdentity(identity, expected)) return { state: 'running', identity }
    throw new Error('an incompatible listener owns the requested port')
  } catch (error) {
    if (!/fetch failed|aborted|ECONNREFUSED|identity returned/.test(String(error?.message))) throw error
  }
  const child = spawnImpl(process.execPath, [bridge], { detached: true, stdio: 'ignore', env: { ...env, NUDGE_PORT: String(port), ...(store ? { NUDGE_STORE: store } : {}) } })
  child.unref()
  let last
  for (let attempt = 0; attempt < 25; attempt++) {
    await wait(120)
    try {
      const identity = await bridgeIdentity(expected)
      if (compatibleIdentity(identity, expected)) return { state: 'started', identity }
      last = new Error('an incompatible listener owns the requested port')
      break
    } catch (error) { last = error }
  }
  throw new Error(`bridge did not become healthy: ${last?.message || 'unknown error'}`)
}
