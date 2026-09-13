// Explicitly scoped browser evidence. The Chromium subset uses two independent
// installation profiles and real extension/UI input; it is NOT Safari evidence.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runJointCoexistence, stageBrowserResources } from './browser-joint-coexistence.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4823, PAGE = 5323, BASE = `http://localhost:${PORT}`, URL = `http://localhost:${PAGE}/same`
const chromiumOnly = process.argv.includes('--chromium-only')
if (!chromiumOnly) { await runJointCoexistence(); process.exit(process.exitCode || 0) }
const headless = process.argv.includes('--headless')
const outRoot = path.join(ROOT, 'artifacts/safari')
fs.mkdirSync(outRoot, { recursive: true })
const run = fs.mkdtempSync(path.join(outRoot, 'coexistence-'))
const store = path.join(run, 'store'), extension = path.join(run, 'extension')
const report = {
  scope: chromiumOnly ? 'Chromium-only: two installation profiles, multiple same-route tabs' : 'Safari + Chromium coexistence',
  headless, verdict: 'not_run', results: [],
  console: [],
  limitations: ['No native containing app, installed native host, distribution or native toolbar-icon acceptance.', 'Preference setup uses extension-owned storage; overlay interactions use real browser input.'],
}
const writeReport = () => { fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(`Evidence: ${path.relative(ROOT, run)}/report.json`) }
report.limitations.push('Two Chromium installations are not a substitute for simultaneous Safari + Chrome acceptance.')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const contexts = []
let bridge, server, heartbeat, bridgeLog = ''
const readStore = () => {
  try { return JSON.parse(fs.readFileSync(path.join(store, 'store.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { pins: [] }; throw error }
}
async function until(fn, label, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100) }
  throw new Error(`Timeout: ${label}`)
}
async function free(port) {
  const probe = net.createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve))
  await new Promise(resolve => probe.close(resolve))
}
async function post(route, data = {}) {
  const response = await fetch(BASE + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(3000) })
  assert(response.ok, `${route}: HTTP ${response.status}`); return response.json()
}
const agents = [
  { label: 'coexist-owner-one', session: 'coexist_owner_one', pid: process.pid, since: Date.now(), wake: 'pull' },
  { label: 'coexist-owner-two', session: 'coexist_owner_two', pid: process.pid + 1, since: Date.now() - 1000, wake: 'pull' },
]
async function beat() { for (const agent of agents) await post('/agent/heartbeat', agent) }
async function startBridge() {
  bridge = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: store, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  bridge.exited = new Promise(resolve => bridge.once('exit', resolve))
  bridge.stderr.on('data', data => { bridgeLog += data })
  await until(async () => { try { return (await (await fetch(BASE + '/.identity')).json()).store === store } catch { return false } }, 'isolated bridge')
  await beat(); heartbeat = setInterval(() => beat().catch(() => {}), 1000)
}
async function stopBridge() {
  clearInterval(heartbeat)
  if (bridge?.exitCode === null && bridge.signalCode === null) { bridge.kill('SIGTERM'); await bridge.exited }
}
const worker = context => until(() => context.serviceWorkers().find(sw => !sw.isClosed?.()), 'extension service worker')
async function focus(page) {
  await page.bringToFront()
  const sw = await worker(page.context())
  const title = await page.title()
  await sw.evaluate(async title => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.title === title)
    if (!tab) throw new Error('test tab not found')
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.update(tab.id, { active: true })
  }, title)
  await until(() => page.evaluate(() => !document.hidden), 'source tab visible')
}
async function check(name, fn) { await fn(); report.results.push({ name, verdict: 'passed', browser: 'chromium-only' }); console.log(`PASS Chromium-only: ${name}`) }
async function domPrompt(page, text, { queued = false } = {}) {
  await focus(page)
  await page.locator('.btn-pick').click(); await page.locator('#target').click()
  const composer = page.locator('.composer textarea'); await composer.waitFor({ state: 'visible' })
  await composer.fill(text); await composer.press('Enter')
  if (queued) { await until(async () => (await page.locator('.feed').textContent()).includes('queued'), 'visible durable queue acknowledgment'); return }
  return until(() => readStore().pins.find(pin => pin.text === text), `stored ${text}`)
}
async function regionPrompt(page, text) {
  // Chromium allows only two captureVisibleTab calls per second. This suite
  // checks provenance, not quota exhaustion: separate prior after-proof from
  // the next lasso's selection/send pair without changing capture assertions.
  await sleep(1100)
  await focus(page); await page.keyboard.press('Escape'); await page.locator('.btn-draw').click()
  await page.mouse.move(100, 260); await page.mouse.down()
  for (const point of [[280, 260], [280, 370], [100, 370], [100, 260]]) await page.mouse.move(...point, { steps: 8 })
  await page.mouse.up()
  const composer = page.locator('.composer textarea'); await composer.waitFor({ state: 'visible' })
  await composer.fill(text); await composer.press('Enter')
  const pin = await until(() => readStore().pins.find(pin => pin.text === text), `stored ${text}`)
  assert(pin.screenshot, `actual Freeform before-image is required; feed=${await page.locator('.feed').textContent()}`); assert(pin.browserSource?.document)
  return pin
}
async function centre(page, relative) {
  assert(relative?.startsWith('shots/'))
  const bytes = fs.readFileSync(path.join(store, relative)); assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
  return page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    return [...context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data]
  }, `data:image/png;base64,${bytes.toString('base64')}`)
}
const paint = (page, color) => page.locator('#pixels').evaluate((element, color) => { element.style.background = color }, color)
const after = id => readStore().pins.find(pin => pin.id === id)
async function queue(context) { return (await (await worker(context)).evaluate(() => chrome.storage.local.get('nudgeQueue'))).nudgeQueue?.entries || [] }

try {
  await free(PORT); await free(PAGE)
  report.resources = stageBrowserResources({ out: extension, port: PORT, family: 'chromium-test' })
  server = http.createServer((_, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Coexistence fixture</title><style>body{margin:40px;font:16px sans-serif}button{padding:12px}#pixels{position:absolute;left:80px;top:240px;width:240px;height:160px;background:rgb(20,180,90)}</style><h1>Independent installation fixture</h1><button id="target">Selected element</button><div id="pixels"></div>')
  })
  await new Promise(resolve => server.listen(PAGE, '127.0.0.1', resolve))
  await startBridge()
  const { chromium } = await import('playwright')
  for (const label of ['A', 'B']) {
    const context = await chromium.launchPersistentContext(path.join(run, `profile-${label}`), { channel: 'chromium', headless, viewport: { width: 1100, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    contexts.push(context)
    await (await worker(context)).evaluate(author => chrome.storage.sync.set({ nudgeAuthor: author }), `installation-${label}`)
  }
  const [A, B] = contexts
  report.version = A.browser().version()
  const a1 = A.pages()[0], a2 = await A.newPage(), b = B.pages()[0]
  for (const [page, label] of [[a1, 'A1'], [a2, 'A2'], [b, 'B']]) {
    page.on('console', message => report.console.push({ page: label, type: message.type(), text: message.text() }))
    await page.goto(URL); await page.evaluate(label => { document.title = `Coexistence ${label}` }, label)
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  }
  await paint(a1, 'rgb(20,180,90)'); await paint(a2, 'rgb(20,40,210)'); await paint(b, 'rgb(210,40,210)')
  let pinA1, pinA2, pinB
  await check('same-route tabs have distinct privileged tab identities; installations have distinct sessions/authors', async () => {
    pinA1 = await domPrompt(a1, '[TEST-coexistence] A1')
    pinA2 = await domPrompt(a2, '[TEST-coexistence] A2')
    pinB = await domPrompt(b, '[TEST-coexistence] B')
    for (const pin of [pinA1, pinA2, pinB]) assert.equal(pin.browserSource.browser, 'chromium-test')
    assert.equal(pinA1.browserSource.session, pinA2.browserSource.session)
    assert.notEqual(pinA1.browserSource.tab, pinA2.browserSource.tab)
    assert.notEqual(pinA1.browserSource.session, pinB.browserSource.session)
    assert.equal(pinA1.author, 'installation-A'); assert.equal(pinB.author, 'installation-B')
    assert.equal(pinA1.owner.session, agents[0].session); assert.equal(pinB.owner.session, agents[0].session)
    report.sources = [pinA1.browserSource, pinA2.browserSource, pinB.browserSource]
  })
  await check('shared bridge queue/history and owner choice reach both installations', async () => {
    for (const page of [a2, b]) {
      await focus(page); await page.locator('.pill .count').click()
      for (const text of [pinA1.text, pinA2.text, pinB.text]) await page.locator('.queue .q-row', { hasText: text }).waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
    }
    await focus(a2); await a2.locator('.pill .who').click(); await a2.locator('.w-row', { hasText: agents[1].label }).click()
    for (const page of [a1, a2, b]) await until(async () => (await page.locator('.who').textContent()).includes(agents[1].label), 'shared owner selection')
    const pin = await domPrompt(b, '[TEST-coexistence] owner changed')
    assert.equal(pin.owner.session, agents[1].session)
    assert.equal(after(pinA1.id).owner.session, agents[0].session, 'old owner stamp is immutable')
  })
  await check('overlay off-state is installation-local and propagates only within that profile', async () => {
    await (await worker(A)).evaluate(() => chrome.storage.local.set({ nudgeOff: true }))
    await a1.locator('.pill').waitFor({ state: 'hidden' }); await a2.locator('.pill').waitFor({ state: 'hidden' })
    assert(await b.locator('.pill').isVisible())
    await (await worker(A)).evaluate(() => chrome.storage.local.set({ nudgeOff: false }))
    await a1.locator('.pill').waitFor({ state: 'visible' }); await a2.locator('.pill').waitFor({ state: 'visible' })
  })
  await check('inactive same-route source defers after-evidence; foreground return captures only source pixels', async () => {
    const pin = await regionPrompt(a1, '[TEST-coexistence] inactive source')
    assert.deepEqual(await centre(a1, pin.screenshot), [20,180,90,255])
    await paint(a1, 'rgb(200,40,60)'); await focus(a2)
    await post(`/comments/${pin.id}/resolve`)
    await sleep(1500); assert(!after(pin.id).screenshotAfter, 'inactive source must not use the active same-route tab')
    await focus(b); await sleep(500); assert(!after(pin.id).screenshotAfter, 'second installation must not supply its pixels')
    await focus(a1)
    const captured = await until(() => after(pin.id).screenshotAfter, 'originating source after-image')
    assert.deepEqual(await centre(a1, captured), [200,40,60,255])
    assert.deepEqual(after(pin.id).afterBrowserSource, pin.browserSource)
  })
  await check('closed source remains unavailable despite same-route tabs in both installations', async () => {
    const pin = await regionPrompt(a1, '[TEST-coexistence] closed source')
    await a1.close(); await focus(a2); await post(`/comments/${pin.id}/resolve`)
    await focus(b); await sleep(2000)
    assert(!after(pin.id).screenshotAfter)
    const metadata = (await (await fetch(BASE + '/comments')).json()).find(item => item.id === pin.id)
    assert.deepEqual(metadata.afterEvidence, { status: 'pending', reason: 'source_unavailable' })
  })
  await check('offline queues are durable, independent and retain original tokens', async () => {
    await stopBridge()
    await domPrompt(a2, '[TEST-coexistence] offline A', { queued: true })
    await domPrompt(b, '[TEST-coexistence] offline B', { queued: true })
    const qa = await queue(A), qb = await queue(B)
    assert.equal(qa.length, 1); assert.equal(qb.length, 1)
    assert.equal(qa[0].payload.text, '[TEST-coexistence] offline A'); assert.equal(qb[0].payload.text, '[TEST-coexistence] offline B')
    assert.notEqual(qa[0].payload.submissionId, qb[0].payload.submissionId)
    report.offlineTokens = [qa[0].payload.submissionId, qb[0].payload.submissionId]
  })
  // CDP is a Chromium-only mechanism, never labelled Safari worker proof.
  const cdp = await A.newCDPSession(a2)
  const versions = new Map()
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: changes }) => { for (const version of changes) versions.set(version.versionId, version) })
  await cdp.send('ServiceWorker.enable')
  for (let i = 0; i < 20 && ![...versions.values()].some(version => version.scriptURL.startsWith('chrome-extension://')); i++) await sleep(100)
  const version = [...versions.values()].find(version => version.scriptURL.startsWith('chrome-extension://') && version.runningStatus === 'running')
  report.workerVersions = [...versions.values()]
  if (version) {
    await check('Chromium CDP worker termination preserves session/tab identity and durable queue', async () => {
      const old = await worker(A), before = await old.evaluate(() => chrome.storage.session.get('nudgeBrowserIdentity'))
      const queued = await queue(A)
      await old.evaluate(() => { globalThis.__coexistWorkerProbe = 'original-instance' })
      let closed = false
      old.once('close', () => { closed = true })
      await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId })
      await until(() => {
        report.workerAfterStop = [...versions.values()]
        return closed || versions.get(version.versionId)?.runningStatus === 'stopped'
      }, 'CDP worker stopped state', 5000)
      await a2.bringToFront(); await a2.locator('.status').click() // queue status RPC wakes the new worker
      const next = await worker(A)
      assert.equal(await next.evaluate(() => globalThis.__coexistWorkerProbe), undefined, 'new worker global scope must replace the stopped instance')
      assert.deepEqual(await next.evaluate(() => chrome.storage.session.get('nudgeBrowserIdentity')), before)
      assert.deepEqual(await queue(A), queued)
      await a2.keyboard.press('Escape')
    })
  } else {
    report.results.push({ name: 'Chromium CDP worker termination', verdict: 'blocked', reason: 'extension worker target unavailable' })
    throw new Error('Required Chromium worker-termination proof is blocked: extension worker target unavailable')
  }
  await cdp.detach()
  await check('both independent offline queues reconnect without duplicate submissions', async () => {
    await startBridge()
    for (const page of [a2, b]) { await focus(page); await page.reload(); await page.locator('.pill .status.ok').waitFor({ timeout: 15000 }) }
    await until(async () => !(await queue(A)).length && !(await queue(B)).length, 'both queues flushed')
    for (const token of report.offlineTokens) assert.equal(readStore().pins.filter(pin => pin.submissionId === token).length, 1)
    const pin = await domPrompt(a2, '[TEST-coexistence] after worker stop')
    assert.equal(pin.browserSource.session, pinA2.browserSource.session)
    assert.equal(pin.browserSource.tab, pinA2.browserSource.tab)
  })
  report.verdict = 'chromium_subset_passed'
} catch (error) {
  report.verdict = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1
  for (const [index, context] of contexts.entries()) {
    try { await context.pages().at(-1)?.screenshot({ path: path.join(run, `failure-${index}.png`) }); report[`queue${index}`] = await queue(context) } catch {}
  }
} finally {
  clearInterval(heartbeat)
  for (const context of contexts) await context.close()
  await stopBridge()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  fs.writeFileSync(path.join(run, 'bridge.log'), bridgeLog)
  writeReport()
}
