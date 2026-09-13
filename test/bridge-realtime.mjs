// Real WebSocket protocol errors and live roster updates. Each case gets its
// own bridge/store; malformed clients must not disconnect healthy peers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import WebSocket from '../bridge/node_modules/ws/index.js'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'artifacts/safari'), { recursive: true })
const out = fs.mkdtempSync(path.join(root, 'artifacts/safari/realtime-'))
const report = { scope: 'Real HTTP/WS protocol and roster updates; no browser acceptance', results: [] }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(25) }
  throw new Error(`Timeout: ${label}`)
}
async function check(name, action) {
  let child, log = ''
  const clients = []
  const result = { name }
  try {
    const probe = net.createServer()
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = probe.address().port
    await new Promise(resolve => probe.close(resolve))
    assert.notEqual(port, 4700)
    const base = `http://127.0.0.1:${port}`, store = path.join(out, name)
    child = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: root, env: { ...process.env, NUDGE_STORE: store, NUDGE_PORT: String(port), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    const exited = once(child, 'exit')
    child.stderr.on('data', data => { log += data })
    const identity = () => fetch(base + '/.identity', { signal: AbortSignal.timeout(1000) }).then(r => r.json())
    await until(async () => { try { return (await identity()).store === store } catch { return false } }, 'isolated bridge identity')
    async function connect() {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`), frames = []
      clients.push(ws)
      ws.on('message', data => frames.push(JSON.parse(data)))
      ws.on('error', () => {}) // a rejected client is expected; a server crash is not
      await until(() => frames.length, 'initial snapshot')
      return { ws, frames }
    }
    const post = async (route, body) => {
      const res = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1000) })
      assert(res.ok, `${route}: ${res.status}`); return res.json()
    }
    await action({ connect, post, identity, child })
    assert.equal(child.exitCode, null, 'bridge remains alive')
    result.verdict = 'passed'
    console.log('PASS', name)
    // Keep the exit promise handled until cleanup, including protocol failures.
    for (const ws of clients) ws.terminate()
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
  } catch (error) {
    result.verdict = 'failed'; result.error = String(error); process.exitCode = 1
    console.error('FAIL', name, String(error))
  } finally {
    for (const ws of clients) ws.terminate()
    if (child?.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended }
    report.results.push(result)
    fs.writeFileSync(path.join(out, name + '.log'), log)
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  }
}

for (const [name, payload, closeCode] of [
  ['invalid-utf8-is-contained', Buffer.from([0xc3, 0x28]), 1007],
  ['oversized-frame-is-contained', 'x'.repeat(64 * 1024 + 1), 1009],
]) await check(name, async ({ connect, post, child }) => {
  const healthy = await connect(), invalid = await connect()
  let closed = null
  invalid.ws.on('close', code => { closed = code })
  invalid.ws.send(payload, { binary: false })
  await until(() => closed !== null, 'invalid client rejected')
  assert.equal(closed, closeCode)
  assert.equal(child.exitCode, null, 'protocol error must not crash the bridge')
  assert.equal(healthy.ws.readyState, WebSocket.OPEN, 'healthy peer stays connected')
  await post('/comments', { text: '[TEST] healthy peer after invalid frame' })
  await until(() => healthy.frames.some(frame => frame.pins?.some(pin => pin.text === '[TEST] healthy peer after invalid frame')), 'healthy peer receives later updates')
})

await check('roster-updates-without-heartbeat-spam', async ({ connect, post, identity }) => {
  const agent = { label: 'Realtime owner', session: 'realtime_owner', pid: 101, since: 1, wake: 'push', project: 'before', runtime: 'test' }
  await post('/agent/heartbeat', agent)
  const { frames } = await connect()
  assert.equal(frames.at(-1).agentWake, 'push')
  const changed = { ...agent, wake: 'pull', project: 'after', branch: 'review', surface: 'terminal' }
  await post('/agent/heartbeat', changed)
  assert.equal((await identity()).agentWake, 'pull')
  await until(() => frames.at(-1)?.agentWake === 'pull', 'push-to-pull update reaches connected browser')
  assert.equal(frames.at(-1).agents[0].project, 'after')
  assert.equal(frames.at(-1).agents[0].branch, 'review')
  assert.equal(frames.at(-1).agents[0].surface, 'terminal')
  const metadataOnly = { ...changed, branch: 'review-updated' }
  await post('/agent/heartbeat', metadataOnly)
  await until(() => frames.at(-1)?.agents[0].branch === 'review-updated', 'metadata-only update reaches connected browser')
  const count = frames.length
  for (let i = 0; i < 3; i++) await post('/agent/heartbeat', metadataOnly)
  await pause(250)
  assert.equal(frames.length, count, 'freshness-only heartbeats do not spam snapshots')
  await post('/agent/heartbeat', agent)
  await until(() => frames.at(-1)?.agentWake === 'push', 'pull-to-push update reaches connected browser')
})
console.log('Evidence:', path.relative(root, out))
