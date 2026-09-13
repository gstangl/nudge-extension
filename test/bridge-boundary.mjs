// Real HTTP/WS regressions for the GitHub developer-preview review. Random
// side port and fresh retained store; never touches a live bridge or inbox.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import WebSocket from '../bridge/node_modules/ws/index.js'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'artifacts/safari'), { recursive: true })
const out = fs.mkdtempSync(path.join(root, 'artifacts/safari/boundary-'))
const store = path.join(out, 'store')
const file = path.join(store, 'store.json')
const report = { scope: 'HTTP/WS and stored data only; no browser acceptance', results: [] }
const probe = net.createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
assert.notEqual(port, 4700)
const base = `http://127.0.0.1:${port}`
let child, log = ''
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function start() {
  child = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: root, env: { ...process.env, NUDGE_PORT: String(port), NUDGE_STORE: store }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', data => { log += data })
  for (let i = 0; i < 80; i++) {
    try { if ((await (await fetch(base + '/.identity')).json()).store === store) return } catch { /* starting */ }
    await pause(50)
  }
  throw new Error('Isolated bridge did not start: ' + log)
}
async function stop() {
  if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
}
const post = (route, value) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
const heartbeat = (session, wake = 'pull') => post('/agent/heartbeat', { label: session, session, pid: session === 'original' ? 101 : 102, since: session === 'original' ? 1 : 2, wake })
const httpStatus = headers => new Promise((resolve, reject) => {
  const req = http.get(base + '/comments', { headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
  req.on('error', reject)
})
async function socket(headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers })
    ws.once('message', data => { resolve({ status: 101, frame: JSON.parse(data) }); ws.close() })
    ws.once('unexpected-response', (_, res) => { res.resume(); resolve({ status: res.statusCode }) })
    ws.once('error', reject)
  })
}
async function check(name, action) {
  await action()
  assert.equal(child.exitCode, null, 'bridge survives each boundary case')
  report.results.push({ name, verdict: 'passed' }); console.log('PASS', name)
}
try {
  await start()
  await check('Host and Origin independently gate HTTP and WS', async () => {
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, 'foreign.example', 'localhost.evil', 'localhost:65536']) {
      for (const origin of [undefined, 'http://localhost:4886', 'https://foreign.example', 'null']) {
        const headers = { Host: host, ...(origin === undefined ? {} : { Origin: origin }) }
        const allowed = (host === `localhost:${port}` || host === `127.0.0.1:${port}`) && (origin === undefined || origin === 'http://localhost:4886')
        assert.equal(await httpStatus(headers), allowed ? 200 : 403, `HTTP ${JSON.stringify(headers)}`)
        assert.equal((await socket(headers)).status, allowed ? 101 : 401, `WS ${JSON.stringify(headers)}`)
      }
    }
    for (const [target, host] of [['/comments', ''], ['http://foreign.example/comments', `Host: localhost:${port}\r\n`], ['//foreign.example/comments', `Host: localhost:${port}\r\n`]]) {
      const response = await new Promise((resolve, reject) => {
        const conn = net.connect(port, '127.0.0.1'); let data = ''
        conn.on('connect', () => conn.write(`GET ${target} HTTP/1.1\r\n${host}Connection: close\r\n\r\n`))
        conn.on('data', chunk => { data += chunk }); conn.on('end', () => resolve(data)); conn.on('error', reject)
      })
      assert.match(response, /^HTTP\/1\.1 (400|403) /)
    }
  })
  await check('invalid annotations cannot create poisoned records or receipts', async () => {
    for (const annotations of [{}, [null], [{ type: 'lasso', points: [[null, 2]] }], [{ type: 'lasso', points: [[1, 2]], extra: 'x'.repeat(100_000) }]]) {
      const res = await post('/comments', { text: '[TEST] invalid stroke', annotations, submissionId: 'stroke_check', submissionCreatedAt: new Date().toISOString() })
      assert.equal(res.status, 400); assert.equal((await res.json()).error, 'invalid_annotations')
    }
    assert.deepEqual(await (await fetch(base + '/comments')).json(), [])
    assert.equal((await socket()).status, 101)
  })
  await check('valid multibyte text survives a real split HTTP request', async () => {
    const text = '[TEST] Größe 🙂 日本語'
    const body = Buffer.from(JSON.stringify({ text, target: { innerText: text } }))
    const split = body.indexOf(Buffer.from('ö')) + 1
    const response = new Promise((resolve, reject) => {
      const req = http.request(base + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      req.on('error', reject); req.write(body.subarray(0, split)); setTimeout(() => req.end(body.subarray(split)), 30)
    })
    assert.equal(await response, 201)
    const pin = JSON.parse(fs.readFileSync(file, 'utf8')).pins[0]
    assert.equal(pin.text, text); assert.equal(pin.target.innerText, text)
  })
  await heartbeat('original')
  const create = async () => (await (await post('/comments', { text: '[TEST] withdrawal', url: 'http://localhost:4886/' })).json()).id
  const originalPin = await create(), offlinePin = await create(), resolvedPin = await create()
  await heartbeat('replacement', 'push')
  await check('withdrawal acknowledges the original pull session, not the new push owner', async () => {
    const res = await (await fetch(`${base}/comments/${originalPin}`, { method: 'DELETE' })).json()
    assert.deepEqual(res, { ok: true, notified: true, agent: 'original', wake: 'pull' })
    assert((await post(`/comments/${resolvedPin}/resolve`)).ok)
    assert.deepEqual(await (await fetch(`${base}/comments/${resolvedPin}`, { method: 'DELETE' })).json(), { ok: true, notified: false, agent: null, wake: null })
  })
  await stop()
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  saved.pins[0].annotations = {}
  fs.writeFileSync(file, JSON.stringify(saved)) // deliberate historical-corruption fixture, bridge is stopped
  await start()
  await check('restart preserves recoverable prompts with malformed historical annotations', async () => {
    const frame = (await socket()).frame
    assert.equal(frame.pins.find(pin => pin.id === saved.pins[0].id).text, saved.pins[0].text)
    assert.equal(frame.pins.find(pin => pin.id === saved.pins[0].id).isRegion, false)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pins.length, saved.pins.length)
  })
  await heartbeat('replacement', 'push')
  await check('offline original and ownerless legacy work never claim a new recipient', async () => {
    assert.deepEqual(await (await fetch(`${base}/comments/${offlinePin}`, { method: 'DELETE' })).json(), { ok: true, notified: false, agent: null, wake: null })
    // The first prompt was made before any agent was armed.
    assert.deepEqual(await (await fetch(`${base}/comments/${saved.pins[0].id}`, { method: 'DELETE' })).json(), { ok: true, notified: false, agent: null, wake: null })
  })
} catch (error) {
  report.error = String(error); process.exitCode = 1; console.error(error)
} finally {
  await stop()
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'bridge.log'), log)
  console.log('Evidence:', path.relative(root, out))
}
