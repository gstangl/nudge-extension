// Real keyboard/input delivery against an app with canvas capture shortcuts.
// Every prompt goes to an isolated bridge/store; never to a user's session.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { stageBrowserResources } from './browser-joint-coexistence.mjs'

const root = path.resolve(import.meta.dirname, '..')
const artifacts = path.join(root, 'artifacts/safari')
fs.mkdirSync(artifacts, { recursive: true })
const out = fs.mkdtempSync(path.join(artifacts, 'input-contract-'))
const store = path.join(out, 'store'), report = { scope: 'Real Chromium typing and delivery on HTTP/HTTPS; no Safari acceptance', results: [] }
const children = []
let context, server
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(50) }
  throw new Error('Timeout: ' + label)
}
async function freePort() {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  assert(![4700, 1355].includes(port))
  return port
}
const bridgePort = await freePort(), base = `http://127.0.0.1:${bridgePort}`
const env = { ...process.env, NUDGE_PORT: String(bridgePort), NUDGE_STORE: store, NUDGE_NO_RELOAD: '1' }
function child(file, args, label) {
  const p = spawn(process.execPath, [file, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const item = { p, label, output: '' }
  for (const stream of [p.stdout, p.stderr]) stream.on('data', data => { item.output += data })
  children.push(item)
  return p
}
const pins = () => {
  try { return JSON.parse(fs.readFileSync(path.join(store, 'store.json'), 'utf8')).pins }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
const pass = (protocol, name) => { report.results.push({ protocol, name, verdict: 'passed' }); console.log('PASS', protocol, name) }
const html = `<!doctype html><meta charset="utf-8"><title>Input contract</title>
<style>body{padding:60px;font:16px sans-serif}#canvas{margin-top:40px;padding:30px;background:#eee}#target{padding:20px}.page-input{display:block;margin:20px}</style>
<h1>Input contract</h1><input class="page-input" aria-label="Page input"><button id="target">Pick this target</button><div id="canvas" tabindex="0">Canvas shortcuts</div>
<script>
window.pageKeys = []; window.pageTool = null;
const canvas = document.querySelector('#canvas');
function canvasKeys(event) {
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.type === 'keydown') {
    if (event.currentTarget === window) window.pageKeys.push(event.key);
    if (/^[pmldrt0-9]$/.test(event.key) || ['Enter','Backspace','Delete'].includes(event.key)) {
      window.pageTool = event.key; event.preventDefault();
    }
  }
  // A canvas takes focus once its third shortcut is seen. Shadow retargeting
  // makes a naive editable check above mistake the overlay for the canvas.
  if (event.type === 'keyup' && window.pageKeys.length >= 3) canvas.focus();
}
for (const type of ['keydown','keyup','keypress']) window.addEventListener(type, canvasKeys, true);
document.addEventListener('keydown', canvasKeys, true);
</script>`

try {
  child('bridge/bridge.mjs', [], 'bridge')
  await until(async () => { try { return (await (await fetch(base + '/.identity')).json()).store === store } catch { return false } }, 'isolated bridge')
  for (const protocol of ['http', 'https']) {
    if (protocol === 'https') {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', path.join(out, 'test.key'), '-out', path.join(out, 'test.crt')], { stdio: 'ignore' })
      server = https.createServer({ key: fs.readFileSync(path.join(out, 'test.key')), cert: fs.readFileSync(path.join(out, 'test.crt')) })
    } else server = http.createServer()
    server.on('request', (_, res) => { res.setHeader('content-type', 'text/html'); res.end(html) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `${protocol}://127.0.0.1:${server.address().port}/`
    const scopedPins = () => pins().filter(pin => pin.url === url)
    const watcher = child('agent/groundworks-nudge.mjs', ['watch', '--label', 'Input contract', '--agent-id', `input-${protocol}`, '--url', url, '--wake', 'pull'], `watch-${protocol}`)
    const extension = path.join(out, protocol + '-extension')
    const resources = stageBrowserResources({ out: extension, port: bridgePort, family: 'chromium' })
    context = await chromium.launchPersistentContext('', { headless: process.env.NUDGE_HEADLESS !== '0', channel: 'chromium', ignoreHTTPSErrors: protocol === 'https', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const page = await context.newPage()
    page.on('pageerror', error => { (report.browserErrors ||= []).push(String(error)) })
    await page.goto(url)
    await page.locator('.pill .status.ok').waitFor()
    await page.bringToFront()
    const state = () => page.locator('.composer textarea').evaluate(el => ({ text: el.value, focused: el.getRootNode().activeElement === el, start: el.selectionStart, end: el.selectionEnd }))
    const type = async (selector, text) => {
      const field = typeof selector === 'string' ? page.locator(selector) : selector
      await field.click()
      await page.keyboard.type(text.slice(0, 3), { delay: 25 })
      await sleep(200)
      assert.equal(await field.inputValue(), text.slice(0, 3))
      assert(await field.evaluate(el => el.getRootNode().activeElement === el), 'The third character must not lose focus')
      await page.keyboard.type(text.slice(3), { delay: 15 })
      assert.equal(await field.inputValue(), text, 'Every character must reach the field beyond the first three')
      assert(await field.evaluate(el => el.getRootNode().activeElement === el), 'Typing must retain focus')
    }
    await page.locator('.btn-pick').click(); await page.locator('#target').click()
    const text = 'abc pmldrt 123 — Größe bleibt erhalten'
    await type('.composer textarea', text)
    assert.deepEqual(await page.evaluate(() => window.pageKeys), [], 'Prompt keys must not reach canvas shortcuts')
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.type('e')
    const edited = (await state()).text
    assert.equal(edited, text, 'ArrowLeft and Backspace edit at the actual caret')
    assert.equal((await state()).start, text.length - 1)
    assert((await state()).focused)
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type(' zweite Zeile')
    const firstText = (await state()).text
    assert(firstText.includes('\n'), 'Shift+Enter inserts a newline')
    await page.keyboard.press('Enter')
    await until(() => scopedPins().some(pin => pin.text === firstText), 'Enter stores the exact prompt')
    await page.locator('.composer').waitFor({ state: 'hidden' })
    pass(protocol, 'Composer keeps text, focus, cursor editing and multiline input; Enter delivers')
    await page.locator('.btn-pick').click(); await page.locator('#target').click()
    const secondText = 'abc pmldrt 456 button delivery'
    await type('.composer textarea', secondText)
    await page.locator('.composer .send').click()
    const second = await until(() => scopedPins().find(pin => pin.text === secondText), 'Send button stores the exact prompt')
    await page.locator('.composer').waitFor({ state: 'hidden' })
    assert.equal(second.owner.session, `input-${protocol}`)
    assert.equal(scopedPins().filter(pin => pin.text === secondText).length, 1)
    pass(protocol, 'Send button delivers exactly once after normal typing')
    await page.locator('.count').click()
    const row = page.locator('.q-row').filter({ hasText: secondText })
    await row.locator('.q-add').click()
    await type(row.locator('.q-amend-input'), 'abc pmldrt amendment')
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('continued')
    const amendment = await row.locator('.q-amend-input').inputValue()
    await page.keyboard.press('Enter')
    await until(() => scopedPins().find(pin => pin.id === second.id)?.amendments?.some(item => item.text === amendment), 'Enter stores amendment')
    await row.locator('.q-add').click()
    await type(row.locator('.q-amend-input'), 'abc second amendment')
    await row.locator('.q-amend-send').click()
    await until(() => scopedPins().find(pin => pin.id === second.id)?.amendments?.length === 2, 'amendment button stores once')
    assert.deepEqual(scopedPins().find(pin => pin.id === second.id).owner, second.owner, 'Amendments retain the original owner')
    assert.deepEqual(await page.evaluate(() => window.pageKeys), [], 'All Nudge fields isolate app shortcuts')
    pass(protocol, 'History amendment supports typing, multiline, Enter and button delivery')
    await page.keyboard.press('Escape')
    await page.locator('.btn-pick').click(); await page.locator('#target').click()
    const keyboardText = 'abc keyboard button activation'
    await type('.composer textarea', keyboardText)
    await page.keyboard.press('Tab')
    assert(await page.locator('.composer .cancel').evaluate(el => el.getRootNode().activeElement === el))
    await page.keyboard.press('Tab')
    assert(await page.locator('.composer .send').evaluate(el => el.getRootNode().activeElement === el))
    await page.keyboard.press('Space')
    await until(() => scopedPins().some(pin => pin.text === keyboardText), 'Space activates the focused Send button')
    await page.locator('.composer').waitFor({ state: 'hidden' })
    pass(protocol, 'Tab navigation and native Space activation submit without page shortcuts')
    const commentsURL = at => ['127.0.0.1', 'localhost'].includes(at.hostname) && at.port === String(bridgePort) && at.pathname === '/comments'
    let rejectedPosts = 0
    await page.route(commentsURL, route => {
      if (route.request().method() !== 'POST') return route.continue()
      rejectedPosts++
      return route.fulfill({ status: 503, contentType: 'application/json',
        headers: { 'access-control-allow-origin': new URL(url).origin }, body: '{"error":"test unavailable"}' })
    })
    await page.locator('.btn-pick').click(); await page.locator('#target').click()
    const queuedText = 'abc keep typed work through delivery failure'
    await type('.composer textarea', queuedText)
    await page.locator('.composer .send').click()
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
    await until(() => rejectedPosts > 0, 'submission actually encounters the failed transport')
    await until(() => worker.evaluate(async text => {
      const { nudgeQueue } = await chrome.storage.local.get('nudgeQueue')
      return nudgeQueue?.entries?.some(entry => entry.payload.text === text)
    }, queuedText), 'failed delivery retains exact durable prompt')
    assert(!scopedPins().some(pin => pin.text === queuedText))
    await page.locator('.composer').waitFor({ state: 'hidden' })
    await page.unroute(commentsURL)
    await page.reload()
    await page.locator('.pill .status.ok').waitFor()
    await until(() => scopedPins().some(pin => pin.text === queuedText), 'reload and reconnection deliver retained input')
    assert.equal(scopedPins().filter(pin => pin.text === queuedText).length, 1)
    pass(protocol, 'Failed submission retains typed work across reload and reconnects without duplicates')
    assert.deepEqual(await page.evaluate(() => window.pageKeys.filter(key => key !== 'Escape')), [], 'Only the preserved Escape contract can reach the page')
    await type('.page-input', 'abc pmldrt page input')
    await page.locator('#canvas').click(); await page.keyboard.press('m')
    assert.equal(await page.evaluate(() => window.pageTool), 'm', 'Page canvas shortcuts still work outside Nudge')
    pass(protocol, 'Page fields and native canvas shortcuts remain usable')
    await page.locator('.btn-pick').click()
    await page.keyboard.press('f')
    assert(await page.locator('.btn-draw').evaluate(el => el.classList.contains('active')))
    await page.keyboard.press('p')
    assert(await page.locator('.btn-pick').evaluate(el => el.classList.contains('active')))
    await page.keyboard.press('Escape')
    pass(protocol, 'P/F tool switching also works with focus inside the toolbar')
    await page.screenshot({ path: path.join(out, protocol + '.png') })
    report.results.push({ protocol, resources, editedDraft: edited, source: 'Real Playwright keyboard and pointer actions' })
    await context.close(); context = null
    const exited = once(watcher, 'exit'); watcher.kill(); await exited
    await new Promise(resolve => server.close(resolve)); server = null
  }
} catch (error) {
  report.results.push({ verdict: 'failed', error: String(error) }); console.error(error); process.exitCode = 1
  if (context) for (const page of context.pages()) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
} finally {
  await context?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  for (const item of children.reverse()) {
    if (item.p.exitCode === null && item.p.signalCode === null) { const exited = once(item.p, 'exit'); item.p.kill(); await Promise.race([exited, sleep(5000)]) }
    fs.writeFileSync(path.join(out, item.label + '.log'), item.output)
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('Evidence:', path.relative(root, out))
}
