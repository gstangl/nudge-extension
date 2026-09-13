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
const startBridge = () => spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
let bridge = startBridge()
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
async function ready() { for (let i = 0; i < 30; i++) { try { const r = await fetch(`${base}/.identity`, { signal: AbortSignal.timeout(500) }); if (r.ok && (await r.json()).store === STORE) return } catch {} await sleep(100) }; throw new Error('bridge did not start') }
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg=='
const differentPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWL6z8DwHwAAAP//A3ONEwAAAAZJREFUAwAFCgIByRpMngAAAABJRU5ErkJggg=='
const source = { browser: 'safari', session: 'session_1', tab: 'tab_1', document: 'document_1' }
const clients = []
const post = (route, body = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function client(browserSource, url = 'http://localhost:5322/fixture') {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'http://localhost:5322' })
  const messages = []
  ws.on('message', data => messages.push(JSON.parse(data)))
  clients.push(ws)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const hello = async (nextSource = browserSource, nextUrl = url) => {
    ws.send(JSON.stringify({ type: 'hello', browserSource: nextSource, url: nextUrl }))
    await sleep(80)
  }
  await hello()
  return { ws, messages, hello }
}
async function pending(browserSource = source, url = 'http://localhost:5322/fixture') {
  const r = await post('/comments', { text: 'pending evidence', url, screenshot: png, browserSource })
  assert.equal(r.status, 201)
  const { id } = await r.json()
  await post(`/comments/${id}/resolve`)
  await sleep(80)
  return id
}
const capture = (c, id) => c.messages.filter(m => m.type === 'capture-after-v2' && m.id === id).at(-1)
const reply = (id, request, browserSource, screenshot = png) => post(`/comments/${id}/after`, { requestId: request?.requestId, browserSource, screenshot })
const evidence = async id => (await (await fetch(`${base}/comments`)).json()).find(pin => pin.id === id)?.afterEvidence
try {
  await ready()
  assert.equal((await fetch(`${base}/comments`, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  for (const origin of ['null', 'http://localhost.evil.example', 'https://foreign.example']) {
    assert.equal((await fetch(`${base}/comments`, { headers: { Origin: origin } })).status, 403)
    await new Promise((resolve, reject) => {
      const refused = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin })
      refused.on('open', () => { refused.terminate(); reject(new Error('foreign WS accepted')) })
      refused.on('unexpected-response', (_, response) => { assert.equal(response.statusCode, 401); response.resume(); refused.terminate(); resolve() })
      refused.on('error', () => {})
    })
  }
  console.log('PASS foreign HTTP origin is rejected before mutation')

  for (const badSource of [{ browser: 'safari' }, { ...source, tab: null }, { ...source, session: 1 }, { ...source, document: 'x'.repeat(129) }]) {
    assert.equal((await post('/comments', { browserSource: badSource })).status, 400)
    assert.equal((await post('/selection', { browserSource: badSource })).status, 400)
  }
  for (const fields of [{ submissionId: 'incomplete' }, { submissionCreatedAt: new Date().toISOString() }]) {
    assert.equal((await post('/comments', { text: 'must not silently use legacy', ...fields })).status, 400)
  }
  console.log('PASS incomplete source and submission identities cannot downgrade to legacy')

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'http://localhost:5322' })
  clients.push(ws)
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
  assert.equal((await reply(created.id, request, source, differentPng)).status, 409, 'same request with different valid image must not succeed')
  console.log('PASS source-bound after evidence rejects wrong documents and accepts exact duplicate delivery')

  const old = await client({ ...source, tab: 'reload_tab' })
  const other = await client({ ...source, tab: 'other_tab' })
  const legacy = await client(undefined)
  const reloadSource = { ...source, tab: 'reload_tab' }
  const reloadId = await pending(reloadSource)
  const staleRequest = capture(old, reloadId)
  assert(staleRequest)
  assert(!capture(other, reloadId)); assert(!capture(legacy, reloadId))
  assert(!legacy.messages.some(m => m.type === 'capture-after' && m.pin?.id === reloadId))
  assert(!old.messages.filter(m => m.type === 'pins').some(m => JSON.stringify(m).includes(staleRequest.requestId)))
  const successorSource = { ...reloadSource, document: 'successor' }
  const successor = await client(successorSource, 'http://localhost:5322/fixture?hmr=2')
  const successorRequest = capture(successor, reloadId)
  assert(successorRequest, 'same-tab successor on query-only change must continue evidence')
  const requestIndex = successor.messages.indexOf(successorRequest)
  assert(successor.messages.slice(0, requestIndex).some(m => m.type === 'pins' && m.pins.some(p => p.id === reloadId)), 'pin context must arrive before private request')
  assert.equal(successor.messages[requestIndex - 1].capabilities.sourceBoundEvidence, 1)
  assert.equal((await reply(reloadId, staleRequest, reloadSource)).status, 409)
  await old.hello()
  assert.equal(capture(old, reloadId), staleRequest, 'retired document hello cannot reclaim its tab')
  assert.equal((await reply(reloadId, successorRequest, successorSource)).status, 200)
  const saved = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'))).pins.find(p => p.id === reloadId)
  assert.deepEqual(saved.browserSource, reloadSource)
  assert.deepEqual(saved.afterBrowserSource, successorSource)
  console.log('PASS private requests follow same-tab reload/query continuity, invalidate old documents and retain original plus accepted provenance')

  const routeSource = { ...source, tab: 'route_tab' }
  const routeClient = await client(routeSource, 'http://localhost:5322/elsewhere')
  const routeId = await pending(routeSource)
  assert.deepEqual(await evidence(routeId), { status: 'pending', reason: 'source_route_changed' })
  assert.equal(capture(old, reloadId), staleRequest, 'another resolve must not send a retired document a new request')
  assert(!capture(routeClient, routeId), 'wrong path must not receive evidence request')
  await routeClient.hello(routeSource, 'http://localhost:5322/fixture#different')
  assert(!capture(routeClient, routeId), 'wrong hash must not receive evidence request')
  await routeClient.hello(routeSource, 'http://localhost:5322/fixture')
  const deferred = capture(routeClient, routeId); assert(deferred)
  assert.deepEqual(await evidence(routeId), { status: 'pending', reason: 'awaiting_source_capture' })
  await routeClient.hello(routeSource, 'http://localhost:5322/fixture')
  const retry = capture(routeClient, routeId); assert.notEqual(retry.requestId, deferred.requestId)
  assert.equal((await reply(routeId, deferred, routeSource)).status, 409)
  await routeClient.hello(routeSource, 'http://localhost:5322/elsewhere')
  assert.equal((await reply(routeId, retry, routeSource)).status, 409, 'navigation invalidates an issued request')
  await routeClient.hello(routeSource, 'http://localhost:5322/fixture')
  const closed = capture(routeClient, routeId)
  routeClient.ws.close(); await sleep(80)
  assert.deepEqual(await evidence(routeId), { status: 'pending', reason: 'source_unavailable' })
  assert.equal((await reply(routeId, closed, routeSource)).status, 409)
  const restarted = await client({ ...routeSource, session: 'new_browser_session' })
  assert(!capture(restarted, routeId), 'unprovable browser-restart continuity must stay unavailable')
  const returned = await client(routeSource)
  assert.equal((await reply(routeId, capture(returned, routeId), routeSource)).status, 200)
  assert.deepEqual(await evidence(routeId), { status: 'captured', provenance: 'source_bound' })
  console.log('PASS route/hash/closed source defer without cross-tab fallback; visibility hello retries invalidate prior requests')

  await fetch(`${base}/comments/${created.id}`, { method: 'DELETE' })
  response = await fetch(`${base}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const withdrawn = await response.json(); assert.equal(response.status, 200); assert.equal(withdrawn.withdrawn, true)
  assert.equal((await (await fetch(`${base}/comments`)).json()).some(pin => pin.id === created.id), false)
  console.log('PASS withdrawn submission receipt cannot resurrect a nudge')

  const restartSource = { ...source, tab: 'restart_tab' }
  const beforeRestart = await client(restartSource)
  const restartId = await pending(restartSource)
  const expiredRequest = capture(beforeRestart, restartId); assert(expiredRequest)
  const stopped = new Promise(resolve => bridge.once('exit', resolve))
  bridge.kill('SIGTERM'); await stopped
  bridge = startBridge(); await ready()
  const afterRestart = await client(restartSource)
  const reconstructed = capture(afterRestart, restartId); assert(reconstructed)
  assert.notEqual(reconstructed.requestId, expiredRequest.requestId)
  assert.equal((await reply(restartId, expiredRequest, restartSource)).status, 409)
  assert.equal((await reply(restartId, reconstructed, restartSource, 'not-an-image')).status, 409)
  assert.equal((await reply(restartId, reconstructed, restartSource)).status, 200)
  const persistedReceipt = await (await post('/comments', payload)).json()
  assert.equal(persistedReceipt.id, created.id); assert.equal(persistedReceipt.withdrawn, true)
  console.log('PASS restart reconstructs pending evidence with fresh tokens and preserves withdrawal receipts')

  const legacyResponse = await post('/comments', { text: 'legacy', url: 'http://localhost:5322/fixture', screenshot: png })
  const legacyId = (await legacyResponse.json()).id
  assert.equal((await reply(legacyId, null, null)).status, 409, 'open legacy pins still require resolution')
  await post(`/comments/${legacyId}/resolve`)
  assert.deepEqual(await evidence(legacyId), { status: 'pending', reason: 'legacy_unbound', provenance: 'legacy_unverified' })
  assert.equal((await reply(legacyId, null, null)).status, 200, 'legacy resolved screenshot pins retain compatibility')
  assert.deepEqual(await evidence(legacyId), { status: 'captured', provenance: 'legacy_unverified' })
  console.log('PASS legacy evidence retains resolved-before-image eligibility without claiming browser provenance')
  ws.close()
} finally {
  for (const ws of clients) ws.terminate()
  if (bridge.exitCode === null && bridge.signalCode === null) {
    const exited = new Promise(resolve => bridge.once('exit', resolve))
    bridge.kill('SIGTERM')
    await exited
  }
  fs.rmSync(STORE, { recursive: true, force: true })
}
