// Suite A — isolated E2E: real Chromium + loaded extension -> demo page.
// Covers: status dot, movable pill, pick = mark (selection, chip retarget,
// cancel), report completeness (selector/xpath/innerText/styles/console/shots),
// fire-and-forget badge, invisible evidence loop + feed chips, lasso, SPA refilter.
import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/pin-e2e-store'
fs.rmSync(STORE, { recursive: true, force: true })

// OWN side port — the live bridge on 4700 keeps serving Gerald untouched.
// The extension in the TEST browser is re-pointed via chrome.storage.nudgePort
// (see below); stealing 4700 once showed a test agent in the real toolbar.
const TESTPORT = 4720
let bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], {
  env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(TESTPORT) }, stdio: ['ignore', 'ignore', 'inherit'],
})
{
  let up = false
  for (let i = 0; i < 25 && !up; i++) {
    await new Promise(r => setTimeout(r, 200))
    try { up = (await (await fetch(`http://localhost:${TESTPORT}/.identity`)).json()).store === STORE } catch { /* not yet */ }
  }
  if (!up) { console.error('FAIL: test bridge did not come up on side port'); process.exit(1) }
}

const fail = (msg) => { console.error('FAIL:', msg); bridge.kill(); process.exit(1) }
const store = () => JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8'))
const until = async (fn, ms, what) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)) }
  fail(`timeout waiting for ${what}`)
}
// Suite A simulates a LIVE agent: without this heartbeat the status dot stays
// amber and every „Agent arbeitet" expectation depends on whether some real
// session happens to run a watcher (bit us 2026-07-05 after the Nudge rename).
// host:'Zed'+wake:'push' → this simulated agent is a live AUTO-waker („kommt
// automatisch"), the common case; the pull-owner status is asserted in Suite W
const HB = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'suite-a', pid: process.pid, since: Date.now(), host: 'Zed', wake: 'push' }) }
const heartbeat = setInterval(() => { fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {}) }, 2000)
await fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {})
// identity: the owner label is visible to agents (hook) and the extension
const idn = await (await fetch(`http://localhost:${TESTPORT}/.identity`)).json()
if (idn.agentLabel !== 'suite-a') { console.error('FAIL: agentLabel missing: ' + JSON.stringify(idn.agentLabel)); process.exit(1) }
console.log('PASS agent identity (heartbeat label -> /.identity)')

let ctx
try {
  // --- CORS boundary (bridge 0.5.0): foreign origins get NO CORS headers,
  //     localhost origins are reflected ---
  const evil = await fetch(`http://localhost:${TESTPORT}/selection`, { headers: { Origin: 'https://evil.example' } })
  if (evil.headers.get('access-control-allow-origin')) { console.error('FAIL: CORS must not allow foreign origins'); process.exit(1) }
  const good = await fetch(`http://localhost:${TESTPORT}/selection`, { headers: { Origin: 'http://localhost:5185' } })
  if (good.headers.get('access-control-allow-origin') !== 'http://localhost:5185') { console.error('FAIL: CORS must reflect localhost origins'); process.exit(1) }
  console.log('PASS CORS boundary (foreign origin blocked, localhost reflected)')

  ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  // re-point THIS browser's extension at the test bridge before any page loads
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), TESTPORT)
  const page = ctx.pages()[0] || await ctx.newPage()
  page.on('console', m => { if (m.type() === 'warning') console.error('  [browser]', m.text()) })
  await page.goto(`http://localhost:${TESTPORT}/demo`)

  // --- connection: status dot goes green (WS connected) ---
  // 15 s: this is the COLD-START barrier (extension boot + WS + first snapshot
  // under load), not a behavior assertion — flip timings are asserted in A12/D5
  await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  await until(async () => ((await page.locator('.pill .status').getAttribute('title')) || '').includes('suite-a'), 5000, 'owner label in the status tooltip')
  await until(async () => ((await page.locator('.pill .who').textContent()) || '').includes('suite-a'), 5000, 'session label visible in the toolbar')
  // session dropdown: roster row with identity, owner marked
  await page.locator('.pill .who').click()
  await page.locator('.who-menu.on .w-row.is-owner', { hasText: 'suite-a' }).waitFor({ timeout: 3000 })
  // it is a real popover: the caret points at the session label it opened from (C-7)
  const whoCaretΔ = await page.evaluate(() => {
    const r = document.getElementById('__roots-nudge-host').shadowRoot
    const m = r.querySelector('.who-menu'), who = r.querySelector('.pill .who').getBoundingClientRect()
    const caretX = m.getBoundingClientRect().left + parseFloat(m.style.getPropertyValue('--caret-x'))
    return Math.abs(caretX - (who.left + who.width / 2))
  })
  if (whoCaretΔ > 1.5) fail(`Switch-session caret not aligned to its label (Δ ${whoCaretΔ})`)
  await page.keyboard.press('Escape')
  await until(async () => !(await page.locator('.who-menu.on').count()), 2000, 'dropdown closes on Escape')

  // --- status hint: clicking the status dot opens a guide for the CURRENT state
  //     (green push owner → „Agent aktiv"), closes on Escape ---
  await page.locator('.pill .status').click()
  await page.locator('.status-menu.on .q-head', { hasText: 'Agent aktiv' }).waitFor({ timeout: 3000 })
  { // caret points at the dot it opened from (same popover contract as who/queue)
    const dΔ = await page.evaluate(() => {
      const r = document.getElementById('__roots-nudge-host').shadowRoot
      const m = r.querySelector('.status-menu'), s = r.querySelector('.pill .status').getBoundingClientRect()
      const caretX = m.getBoundingClientRect().left + parseFloat(m.style.getPropertyValue('--caret-x'))
      return Math.abs(caretX - (s.left + s.width / 2))
    })
    if (dΔ > 1.5) fail(`status-hint caret not aligned to the dot (Δ ${dΔ})`)
  }
  await page.keyboard.press('Escape')
  await until(async () => !(await page.locator('.status-menu.on').count()), 2000, 'status hint closes on Escape')
  console.log('PASS status hint (click dot → state guide, caret aligned, Escape)')

  // --- movable toolbar: drag the grip, position changes and persists; an OPEN
  //     popover belongs to the toolbar and must MOVE WITH it (Gerald 2026-07-06) ---
  await page.locator('.pill .who').click() // open Switch session before dragging
  await page.locator('.who-menu.on').waitFor({ timeout: 3000 })
  const menuBefore = await page.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.who-menu').getBoundingClientRect().left)
  const before = await page.locator('.pill').boundingBox()
  const grip = await page.locator('.pill .grip').boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(260, 480, { steps: 6 }) // big move: unclamps the popover so its follow is unmistakable
  await page.mouse.up()
  const after = await page.locator('.pill').boundingBox()
  if (Math.abs(after.x - before.x) < 200 || Math.abs(after.y - before.y) < 100) fail(`pill did not move: ${JSON.stringify({ before, after })}`)
  const followGeo = await page.evaluate(() => {
    const r = document.getElementById('__roots-nudge-host').shadowRoot
    const m = r.querySelector('.who-menu'), who = r.querySelector('.pill .who').getBoundingClientRect()
    const caretX = m.getBoundingClientRect().left + parseFloat(m.style.getPropertyValue('--caret-x'))
    return { left: m.getBoundingClientRect().left, on: m.classList.contains('on'), caretΔ: Math.abs(caretX - (who.left + who.width / 2)) }
  })
  if (!followGeo.on || Math.abs(followGeo.left - menuBefore) < 100) fail(`open popover did not follow the dragged toolbar (${menuBefore} → ${followGeo.left})`)
  if (followGeo.caretΔ > 1.5) fail(`popover caret misaligned after drag (Δ ${followGeo.caretΔ})`)
  await page.keyboard.press('Escape')

  // --- A-8: our chrome is INERT for the page — a transient popover with an
  //     outside-click closer must survive the pill click and remain pickable ---
  await page.evaluate(() => {
    const pop = document.createElement('div')
    pop.id = 'page-pop'
    pop.textContent = 'Finale Version freigeben?'
    pop.style.cssText = 'position:fixed;left:40px;bottom:40px;background:#fff;border:1px solid #999;padding:10px;z-index:10;'
    document.body.appendChild(pop)
    document.addEventListener('click', (e) => { if (!pop.contains(e.target)) pop.remove() }) // typical outside-close
    document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target)) pop.remove() })
  })
  await page.locator('.pill .btn-pick').click() // this click must NOT reach the page
  if (!(await page.locator('#page-pop').count())) fail('pill click dismissed the page popover (A-8)')
  await page.locator('#page-pop').click() // pick the popover itself
  await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 3000 })
  await page.locator('.composer .cancel').click()
  await page.evaluate(() => document.getElementById('page-pop')?.remove())
  await page.keyboard.press('Escape')
  console.log('PASS chrome inert (page popover survives pill click, stays pickable)')

  // --- pick mode with layer chips: click INTO the card (hits inner li), then
  //     pick the card via its chip ---
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').click() // center -> innermost element (li/span)
  const ta = page.locator('textarea[placeholder*="Nudge"]')
  await ta.waitFor({ timeout: 3000 })
  const chips = page.locator('.composer .layers button')
  if (await chips.count() < 2) fail('layer chips missing')
  await page.locator('.composer .layers button', { hasText: 'card-conversion' }).click()
  const active = await page.locator('.composer .layers button.active').textContent()
  if (!active.includes('card-conversion')) fail(`active chip after switch: ${active}`)
  // --- the PICK already published the selection (no send needed) — DOM only,
  //     NO screenshot for elements (browser-tools-mcp style; screenshots are
  //     exclusive to the Kreis tool). The chip then retargets to the card. ---
  await until(async () => {
    const sel = await (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
    return !!sel.selector && !!sel.xpath && !sel.screenshot
  }, 5000, 'element selection published DOM-only (no screenshot)')
  await page.locator('.composer .layers button', { hasText: 'card-conversion' }).click()
  await until(async () => {
    const sel = await (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
    return sel.selector === '#card-conversion' && !sel.screenshot
  }, 5000, 'chip retarget updates selection (still DOM-only)')

  // --- Abbrechen keeps the selection valid (mark without sending) ---
  await page.locator('.composer .cancel').click()
  await page.waitForTimeout(200)
  if (await page.locator('.composer').isVisible()) fail('composer did not close on Abbrechen')
  const selAfterCancel = await (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
  if (selAfterCancel.selector !== '#card-conversion') fail('selection lost after cancel')
  // store.json does not even exist yet — a pure mark must create NO pin
  if (fs.existsSync(path.join(STORE, 'store.json')) && store().pins.length) fail('cancel must not create a pin')
  console.log('PASS pick = mark (selection published, survives Abbrechen, no pin created)')

  // --- empty send = NUMBERED MARK (0.20.0, reverses the 0.10.0 pure-mark rule):
  //     plain Enter mints a referenceable pin, its number pill sits at the element ---
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').click({ position: { x: 10, y: 10 } })
  await ta.waitFor({ timeout: 3000 })
  await ta.press('Enter') // plain Enter sends (⌘↩ keeps working, Shift+Enter = newline)
  await page.locator('.feed .item', { hasText: 'nudge_1 marked' }).waitFor({ timeout: 8000 })
  await until(() => fs.existsSync(path.join(STORE, 'store.json')) && store().pins.length === 1 && store().pins[0].text === '', 5000, 'mark-only pin in store')
  // the pill at the element shows the readable NUMBER — the chat referent
  await until(async () => (await page.locator('.dot:visible .d-num').first().textContent()) === '1', 5000, 'number pill shows 1')
  // discard the mark so the suite's downstream arithmetic starts clean (ids stay monotonic)
  await fetch(`http://localhost:${TESTPORT}/comments/nudge_1`, { method: 'DELETE' })
  await until(() => !store().pins.length, 3000, 'mark discarded')
  console.log('PASS empty send = numbered mark (Enter sends, pill shows the number)')

  // re-open for the actual send flow
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').click()
  await ta.waitFor({ timeout: 3000 })
  await page.locator('.composer .layers button', { hasText: 'card-conversion' }).click()
  await ta.fill('Die Heat-pump-Karte braucht mehr Abstand zum Titel.')
  await ta.press('Shift+Enter') // newline convention: must NOT send
  await page.waitForTimeout(250)
  if (!(await page.locator('.composer').isVisible())) fail('Shift+Enter must not send')
  await page.locator('.composer .send').click()
  await page.locator('.feed .item', { hasText: 'nudge_2' }).waitFor({ timeout: 8000 })
  // the feedback chips sit directly UNDER the toolbar, left-aligned to it (not
  // floating in the screen corner) — placeFeed tracks the movable pill
  {
    const geo = await page.evaluate(() => {
      const r = document.getElementById('__roots-nudge-host').shadowRoot
      const f = r.querySelector('.feed').getBoundingClientRect(), p = r.querySelector('.pill').getBoundingClientRect()
      return { dLeft: Math.abs(f.left - p.left), dTop: f.top - p.bottom }
    })
    if (geo.dLeft > 3) fail(`feed not left-aligned to the toolbar (Δleft ${geo.dLeft})`)
    if (geo.dTop < 2 || geo.dTop > 20) fail(`feed not directly under the toolbar (Δtop ${geo.dTop})`)
  }

  const pin = store().pins[0]
  if (pin.target.selector !== '#card-conversion') fail(`selector: ${pin.target.selector}`)
  if (pin.target.source !== 'src/components/Card.astro:8:2') fail(`source hint: ${pin.target.source}`)
  if (!pin.target.styles?.typography?.color) fail(`categorized styles missing: ${JSON.stringify(pin.target.styles)}`)
  if (!pin.target.xpath?.startsWith('/html/')) fail(`xpath missing: ${pin.target.xpath}`)
  if (!pin.target.innerText) fail('innerText missing')
  if (!pin.console?.some(l => l.includes('Demo-Fehler'))) fail(`console excerpt missing: ${JSON.stringify(pin.console)}`)
  if (!pin.console?.some(l => l.includes('[net]') && l.includes('404'))) fail(`network error missing: ${JSON.stringify(pin.console)}`)
  // element pin = DOM only, NO screenshot (Gerald 2026-07-05)
  if (pin.screenshot) fail(`element pin must have no screenshot: ${pin.screenshot}`)

  // --- badge counts the in-flight prompt; ONE amber dot marks the element (0.9.0:
  //     open prompts stay subtly visible — no popovers/threads, just the dot) ---
  await until(async () => (await page.locator('.pill .count').textContent()) === '1', 5000, 'badge = 1 after send')
  await until(async () => (await page.locator('.dot:visible').count()) === 1, 3000, 'one open-nudge dot on the element')
  if (!(await page.locator('.dot.live').count())) fail('dot must be GREEN while the agent heartbeats (live state)')

  // --- badge click -> read-only queue popover shows what the number means ---
  await page.locator('.pill .count').click()
  await page.locator('.queue.on .q-row', { hasText: 'nudge_2' }).waitFor({ timeout: 3000 })
  // provenance in the list: each row names the agent session that owns the nudge
  // (stamped at arrival, immutable) — so Gerald sees which agent it belongs to
  const who1 = await page.locator('.queue.on .q-row', { hasText: 'nudge_2' }).locator('.q-who').textContent()
  if (who1 !== 'suite-a') fail(`queue row must show the owning session, got "${who1}"`)
  // caret aligned to the badge (C-7) + a row must NOT jitter on accordion toggle (C-6):
  // collapsed and open share one first-line geometry, so dot/id hold their offset
  const qgeo = await page.evaluate(() => {
    const r = document.getElementById('__roots-nudge-host').shadowRoot
    const q = r.querySelector('.queue'), badge = r.querySelector('.pill .count').getBoundingClientRect()
    const caretX = q.getBoundingClientRect().left + parseFloat(q.style.getPropertyValue('--caret-x'))
    const row = r.querySelector('.queue .q-row')
    const rel = () => { const t = s => row.querySelector(s).getBoundingClientRect(), tx = t('.q-text'); return `${(t('.q-dot').top - tx.top).toFixed(1)}|${(t('.q-id').top - tx.top).toFixed(1)}` }
    const a = rel(); row.click(); const b = rel(); row.click(); const c = rel()
    return { caretΔ: Math.abs(caretX - (badge.left + badge.width / 2)), a, b, c }
  })
  if (qgeo.caretΔ > 1.5) fail(`queue caret not aligned to the badge (Δ ${qgeo.caretΔ})`)
  if (qgeo.a !== qgeo.b || qgeo.a !== qgeo.c) fail(`queue row jitters on accordion toggle (${qgeo.a} → ${qgeo.b} → ${qgeo.c})`)
  await page.keyboard.press('Escape')
  await until(async () => !(await page.locator('.queue.on').count()), 2000, 'queue closes on Escape')
  console.log('PASS badge queue popover (open, content, owner shown, Escape)')

  // --- resolve: feed chip + badge clears; element pins get NO after-shot
  //     (no before-shot to compare — that stays a Kreis-pin feature) ---
  await fetch(`http://localhost:${TESTPORT}/comments/nudge_2/resolve`, { method: 'POST' })
  await page.locator('.feed .item', { hasText: 'nudge_2 done' }).waitFor({ timeout: 5000 }) // in-page loop closure
  await until(async () => !(await page.locator('.pill .count.show').count()), 5000, 'badge cleared after resolve')
  await until(async () => !(await page.locator('.dot:visible').count()), 3000, 'dot gone after resolve')
  await page.waitForTimeout(500)
  if (store().pins[0].screenshotAfter) fail('element pin must NOT get an after-shot')

  console.log('PASS pick + chips + styles + net-errors (DOM-only, no screenshot) + badge')
  console.log(`  nudge_2:      "${pin.text}" @ ${pin.target.selector} (xpath ${pin.target.xpath})`)

  // --- lasso mode: circle the SCOP banner ---
  await page.locator('.pill .btn-draw').click()
  const bb = await page.locator('.banner').boundingBox()
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2
  const rx = bb.width / 2 + 30, ry = bb.height / 2 + 25
  await page.mouse.move(cx + rx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
  await page.mouse.up()
  await ta.waitFor({ timeout: 3000 })
  await ta.fill('Dieser Banner wirkt verloren - breiter und mit mehr Präsenz.')
  await page.locator('.composer .send').click()
  await page.locator('.feed .item', { hasText: 'nudge_3' }).waitFor({ timeout: 8000 })
  // history: with the lasso nudge open, the badge exists — the popover lists
  // the resolved nudge_2 under „Erledigt" with a check icon
  await page.locator('.pill .count').click()
  await page.locator('.queue.on .q-div', { hasText: 'Done' }).waitFor({ timeout: 3000 })
  await page.locator('.queue.on .q-row.done', { hasText: 'nudge_2' }).waitFor({ timeout: 3000 })
  if (!(await page.locator('.queue.on .q-row.done svg.q-ok').count())) fail('history row needs the check icon')
  await page.keyboard.press('Escape')
  const lasso = store().pins[1]
  if (!lasso.annotations?.[0]?.points?.length) fail('lasso stroke not stored')
  if (!lasso.target.selector.includes('banner')) fail(`lasso centroid selector: ${lasso.target.selector}`)
  // the Kreis tool is the ONLY one that captures a screenshot (region = pixels)
  if (!lasso.screenshot || fs.statSync(path.join(STORE, lasso.screenshot)).size < 2000) fail('lasso pin must carry a screenshot')

  console.log('PASS lasso (stroke + screenshot; screenshots exclusive to Kreis)')
  console.log(`  nudge_3:      "${lasso.text}" (stroke ${lasso.annotations[0].points.length} points)`)

  // --- SPA navigation: badge counts only THIS route's open prompts ---
  await until(async () => (await page.locator('.pill .count').textContent()) === '1', 5000, 'badge = 1 (open lasso prompt)')
  await page.evaluate(() => { location.hash = '#/andere-seite' })
  await until(async () => !(await page.locator('.pill .count.show').count()), 3000, 'badge cleared after hashchange')
  await page.evaluate(() => { history.back() })
  await until(async () => (await page.locator('.pill .count').textContent()) === '1', 3000, 'badge back after returning')
  console.log('PASS SPA navigation badge refilter (hashchange/popstate)')

  // --- evidence loop lives on for Kreis pins: resolve nudge_3 -> after-shot ---
  await fetch(`http://localhost:${TESTPORT}/comments/nudge_3/resolve`, { method: 'POST' })
  await until(() => store().pins[1].screenshotAfter, 10000, 'lasso after-shot in store')
  // late re-check: the WS-snapshot backlog path must not capture for element
  // pins either (it once did — the +500ms check above only won by timing)
  if (store().pins[0].screenshotAfter) fail('element pin got an after-shot via the snapshot backlog path')
  console.log('PASS Kreis evidence loop (resolve -> after-shot; element pins stay shot-free)')

  // --- multi-selection: Shift+Klick collects elements into ONE mark/prompt ---
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').click({ modifiers: ['Shift'] })
  await ta.waitFor({ timeout: 3000 })
  await page.locator('.banner').click({ modifiers: ['Shift'], position: { x: 10, y: 10 } })
  await until(async () => {
    const sel = await (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
    return sel.targets?.length === 2 && !sel.screenshot
  }, 5000, 'multi selection published (2 targets, DOM-only)')
  const meta = await page.locator('.composer .meta').textContent()
  if (!meta.startsWith('2 elements')) fail(`composer meta should count elements: ${meta}`)
  if (await page.locator('.hl-multi').count() !== 2) fail('expected one outline per collected element')
  await ta.fill('Tausche diese beiden Elemente.')
  await page.locator('.composer .send').click()
  await page.locator('.feed .item', { hasText: 'nudge_4' }).waitFor({ timeout: 8000 })
  const multiPin = store().pins[2]
  if (multiPin.targets?.length !== 2) fail(`multi pin targets: ${JSON.stringify(multiPin.targets?.map(t => t.selector))}`)
  if (!multiPin.targets.every(t => t.selector && t.xpath)) fail('each target needs selector + xpath')
  if (multiPin.screenshot) fail('multi pin is element context -> no screenshot')
  // fire-and-forget: nothing survives the send, incl. the collection outlines
  if (await page.locator('.hl-multi').count()) fail('multi outlines must vanish after send')
  console.log('PASS multi-selection (Shift+Klick -> 2 targets in selection + pin, outlines transient)')

  // --- click convention (0.10.0): plain click RESETS an active multi-selection
  //     to a single pick (Finder/Figma: click = one, Shift = collect) ---
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').click({ modifiers: ['Shift'] })
  await ta.waitFor({ timeout: 3000 })
  await page.locator('.banner').click({ modifiers: ['Shift'], position: { x: 10, y: 10 } })
  await until(async () => (await page.locator('.hl-multi').count()) === 2, 3000, 'two multi outlines')
  await page.locator('#card-source').click({ position: { x: 10, y: 10 } }) // PLAIN click
  await until(async () => (await page.locator('.hl-multi').count()) === 0, 3000, 'plain click cleared the multi outlines')
  const metaSingle = await page.locator('.composer .meta').textContent()
  if (metaSingle.includes('elements')) fail(`plain click must reset to single pick: ${metaSingle}`)
  await page.keyboard.press('Escape')
  console.log('PASS click convention (plain click resets multi to single)')

  // --- queue management (0.9.0): speaking label + discard × + dots lifecycle ---
  // a text-less pin (legacy „nur Markierung" shape) posted directly: the queue must
  // say WHAT is marked, the × must remove it entirely, its dot must disappear
  const pageUrl = await page.evaluate(() => location.href)
  await fetch(`http://localhost:${TESTPORT}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '', url: pageUrl, target: { selector: '#card-source', innerText: 'Energy sources' } }),
  })
  // open on this route now: multi pin (2 target dots) + the mark (1 dot)
  await until(async () => (await page.locator('.dot:visible').count()) === 3, 5000, '3 dots (2 multi targets + 1 mark)')
  await page.locator('.pill .count').click()
  const markRow = page.locator('.queue.on .q-row', { hasText: 'nudge_5' })
  await markRow.waitFor({ timeout: 3000 })
  const label = await markRow.locator('.q-text').textContent()
  if (!label.includes('Mark') || !label.includes('Energy sources')) fail(`speaking label: ${label}`)
  // accordion: row click expands to the full text, second click collapses
  await markRow.click()
  if (!(await markRow.getAttribute('class')).includes('open')) fail('row click must expand (accordion)')
  await markRow.click()
  if ((await markRow.getAttribute('class')).includes('open')) fail('second click must collapse')
  await markRow.locator('.q-x').click()
  await page.locator('.feed .item', { hasText: 'nudge_5 dismissed' }).waitFor({ timeout: 5000 })
  await until(() => !store().pins.some(p => p.id === 'nudge_5'), 3000, 'nudge_5 removed from store')
  if (fs.existsSync(path.join(STORE, 'inbox', 'nudge_5.md'))) fail('inbox mirror must be deleted on discard')
  await until(async () => (await page.locator('.dot:visible').count()) === 2, 3000, 'dot gone after discard')
  console.log('PASS queue management (label „was ist markiert", discard ×, dots lifecycle)')

  // --- agent wiring drift: installed copies must equal the repo sources
  //     (hook + skill exist twice by design; drift was only noticeable manually) ---
  for (const [repo, installed] of [
    [path.join(HERE, '../agent/NUDGE-SKILL.md'), path.join(os.homedir(), '.claude/skills/nudge/SKILL.md')],
    [path.join(HERE, '../agent/nudge-context.mjs'), path.join(os.homedir(), '.claude/hooks/nudge-context.mjs')],
    [path.join(HERE, '../agent/nudge-session-start.sh'), path.join(os.homedir(), '.claude/hooks/nudge-session-start.sh')],
  ]) {
    if (fs.existsSync(installed) && !fs.readFileSync(repo).equals(fs.readFileSync(installed)))
      fail(`agent wiring drift: ${path.basename(repo)} (repo != installiert - nudge/agent/setup-agent.sh ausführen)`)
  }
  console.log('PASS agent wiring in sync (repo = installed)')
} catch (e) {
  fail(e.message || String(e))
} finally {
  clearInterval(heartbeat)
  await ctx?.close()
  bridge.kill()
}
