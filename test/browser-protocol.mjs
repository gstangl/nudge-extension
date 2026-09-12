// Additive browser protocol: origin admission, source-bound evidence and
// submission idempotency. It uses protocol clients, not a Safari claim.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-browser-protocol-'))
const PORT = Number(process.env.NUDGE_TEST_PORT || 4821), base = `http://127.0.0.1:${PORT}`
const bridge = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ready() { for (let i = 0; i < 30; i++) { try { const r = await fetch(`${base}/.identity`, { signal: AbortSignal.timeout(500) }); if (r.ok && (await r.json()).store === STORE) return } catch {} await sleep(100) }; throw new Error('bridge did not start') }
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLq7wAAAABJRU5ErkJggg=='
const source = { browser: 'safari', session: 'session_1', tab: 'tab_1', document: 'document_1' }
try {
  await ready()
  assert.equal((await fetch(`${base}/comments`, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  console.log('PASS foreign HTTP origin is rejected before mutation')

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'http://localhost:5322' })
  const messages = []
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.on('message', data => messages.push(JSON.parse(data)))
  ws.send(JSON.stringify({ type: 'hello', url: 'http://localhost:5322/fixture', browserSource: source }))
  await sleep(80)
  assert(messages.some(m => m.type === 'pins'), 'hello must receive a snapshot')

  const payload = { text: 'source-bound', url: 'http://localhost:5322/fixture', target: { selector: '#target' }, screenshot: png, browserSource: source, submissionId: 'submission_1', submissionCreatedAt: new Date().toISOString() }
  let response = await fetch(`${base}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const created = await response.json(); assert.equal(response.status, 201)
  response = await fetch(`${base}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const replay = await response.json(); assert.equal(response.status, 200); assert.equal(replay.id, created.id)
  response = await fetch(`${base}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, text: 'different' }) })
  assert.equal(response.status, 409)
  console.log('PASS submission retry is exactly-once and content conflicts')

  await fetch(`${base}/comments/${created.id}/resolve`, { method: 'POST' })
  for (let i = 0; i < 30 && !messages.some(m => m.type === 'capture-after-v2'); i++) await sleep(100)
  const request = messages.find(m => m.type === 'capture-after-v2')
  assert(request?.requestId, 'source client must receive a private capture request')
  response = await fetch(`${base}/comments/${created.id}/after`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshot: png, requestId: request.requestId, browserSource: { ...source, document: 'wrong_document' } }) })
  assert.equal(response.status, 409)
  response = await fetch(`${base}/comments/${created.id}/after`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshot: png, requestId: request.requestId, browserSource: source }) })
  assert.equal(response.status, 200)
  response = await fetch(`${base}/comments/${created.id}/after`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshot: png, requestId: request.requestId, browserSource: source }) })
  assert.equal(response.status, 200)
  console.log('PASS source-bound after evidence rejects wrong documents and accepts exact duplicate delivery')

  await fetch(`${base}/comments/${created.id}`, { method: 'DELETE' })
  response = await fetch(`${base}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const withdrawn = await response.json(); assert.equal(response.status, 200); assert.equal(withdrawn.withdrawn, true)
  assert.equal((await (await fetch(`${base}/comments`)).json()).some(pin => pin.id === created.id), false)
  console.log('PASS withdrawn submission receipt cannot resurrect a nudge')
  ws.close()
} finally {
  if (bridge.exitCode === null && bridge.signalCode === null) {
    const exited = new Promise(resolve => bridge.once('exit', resolve))
    bridge.kill('SIGTERM')
    await exited
  }
  fs.rmSync(STORE, { recursive: true, force: true })
}
