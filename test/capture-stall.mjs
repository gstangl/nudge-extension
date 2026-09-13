// Suite Y — Capture stall. The Freeform tool used to bet the whole overlay on a
// screenshot: captureRegion hid the pill/dots/composer, awaited the capture, and
// restored AFTER the await. `chrome.tabs.captureVisibleTab` does not always
// settle — with a debugger attached to the tab (BrowserTools MCP, 2026-07-29) it
// neither resolves nor throws, so sw.js never answers and the await hung forever:
// the user circled a region and was left with a stroke on the page, no toolbar, no
// composer, and an EMPTY console (nothing threw, so nothing was logged).
//
// The stall is reproduced exactly at its source: captureVisibleTab is replaced in
// the real service worker with a promise that never settles. Own bridge on 4795.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const STORE = '/tmp/nudge-stall-store'
const PORT = 4795
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 40; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch { } } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

let ctx = null
const cleanup = () => { try { bridge.kill() } catch { } try { ctx?.close() } catch { } }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(120) } fail(`timeout waiting for ${what}`) }
const store = () => { try { return JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')) } catch { return { pins: [] } } }

// a live agent so the toolbar is in its normal green state
const HB = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'suite-y', pid: process.pid, since: Date.now(), host: 'Zed', wake: 'push' }) }
const hb = setInterval(() => { fetch(`${B}/agent/heartbeat`, HB).catch(() => { }) }, 2000)
await fetch(`${B}/agent/heartbeat`, HB).catch(() => { })

async function lasso(page, box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const rx = box.width / 2 + 30, ry = box.height / 2 + 25
  await page.mouse.move(cx + rx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
  await page.mouse.up()
}

try {
  ctx = await chromium.launchPersistentContext('', {
    headless: process.env.NUDGE_HEADLESS === '1', channel: 'chromium',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), PORT)
  const page = ctx.pages()[0] || await ctx.newPage()
  const warnings = []
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()) })
  await page.goto(`${B}/demo`)
  await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  const ta = page.locator('.composer textarea')

  // ---------- Y1: the healthy path still produces a screenshot ----------
  {
    await page.locator('.pill .btn-draw').click()
    await lasso(page, await page.locator('.banner').boundingBox())
    await ta.waitFor({ timeout: 4000 })
    await ta.fill('Healthy path — with picture.')
    await page.locator('.composer .send').click()
    await until(() => store().pins.length === 1, 8000, 'the nudge to land')
    const pin = store().pins[0]
    if (!pin.screenshot) fail('Y1: a healthy Freeform nudge must carry its region screenshot')
    if (!pin.annotations?.[0]?.points?.length) fail('Y1: the lasso stroke must ship with it')
    pass('Y1 healthy Freeform: composer opens, screenshot + stroke ship with the nudge')
  }

  // ---------- the stall: exactly what an attached debugger does ----------
  // captureVisibleTab is an OWN property of chrome.tabs — keep the original, a
  // `delete` would not fall back to a native implementation (cost a red Y5)
  await sw.evaluate(() => {
    globalThis.__origCapture = chrome.tabs.captureVisibleTab
    chrome.tabs.captureVisibleTab = () => new Promise(() => { })
  })

  // ---------- Y2: a stalled capture costs neither toolbar nor composer ----------
  {
    const t0 = Date.now()
    await page.locator('.pill .btn-draw').click()
    await lasso(page, await page.locator('.banner').boundingBox())
    // the composer must arrive on the grace timer, NOT on the capture
    await ta.waitFor({ timeout: 2000 })
    const openedAfter = Date.now() - t0
    if (!await page.locator('.pill').isVisible()) fail('Y2: the toolbar must come back — it is not evidence, it is the chrome')
    const pillDisplay = await page.locator('.pill').evaluate(el => el.style.display)
    if (pillDisplay === 'none') fail('Y2: the pill is still display:none — the restore did not run')
    pass(`Y2 stalled capture: composer opens anyway (${openedAfter} ms) and the toolbar is back`)
  }

  // ---------- Y3: the nudge still goes out, without the picture ----------
  {
    await ta.fill('Stalled — but the nudge still has to go out.')
    await page.locator('.composer .send').click()
    await until(() => store().pins.length === 2, 12000, 'the nudge to land despite the stall')
    const pin = store().pins[1]
    if (pin.text !== 'Stalled — but the nudge still has to go out.') fail(`Y3: wrong text: ${pin.text}`)
    if (!pin.annotations?.[0]?.points?.length) fail('Y3: the stroke must still ship — it is the mark')
    if (pin.screenshot) fail('Y3: a stalled capture must not fabricate a screenshot')
    pass('Y3 the nudge ships without the picture — stroke + element context intact')
  }

  // ---------- Y4: it says so, instead of pretending ----------
  {
    await until(async () => (await page.locator('.feed .item', { hasText: 'No screenshot' }).count()) > 0, 6000, 'the honest toast')
    // Sending during an already-busy capture now truthfully acknowledges the
    // shot-free prompt immediately. Its diagnostic still belongs to the real
    // 3s capture timeout, not to the earlier submission acknowledgement.
    await until(() => warnings.some(w => w.includes('capture failed') && /timed out/i.test(w)), 3500, 'the actual capture-timeout diagnostic')
    if (!warnings.some(w => w.includes('capture failed') && /timed out/i.test(w)))
      fail(`Y4: the timeout must be logged for diagnosis, got: ${JSON.stringify(warnings)}`)
    pass('Y4 honest about it: toast in the feed + a console warning naming the timeout')
  }

  // ---------- Y5: recovery — a fixed browser works again, no reload needed ----------
  {
    // (a torn-down/restarted SW already has the native one — then there is nothing to put back)
    await sw.evaluate(() => { if (globalThis.__origCapture) chrome.tabs.captureVisibleTab = globalThis.__origCapture })
    await page.reload()
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
    await page.locator('.pill .btn-draw').click()
    await lasso(page, await page.locator('.banner').boundingBox())
    await page.locator('.composer textarea').waitFor({ timeout: 4000 })
    await page.locator('.composer textarea').fill('Healthy again.')
    await page.locator('.composer .send').click()
    await until(() => store().pins.length === 3, 8000, 'the third nudge')
    if (!store().pins[2].screenshot) fail('Y5: screenshots must return once the browser is healthy again')
    pass('Y5 recovery: once capture works again, screenshots come back — no stuck state left behind')
  }

  console.log('\nSuite Y green — a stuck screenshot can no longer take the overlay down with it.')
} finally { clearInterval(hb); cleanup() }
