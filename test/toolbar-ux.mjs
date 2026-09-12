// Suite L — Toolbar & popover UX guarantees. Locks in the polish shipped
// 2026-07-07 so a later refactor can't break it silently: the localhost is
// ALWAYS a clean pill (never an inline ":port" in any label), only one popover
// is open at a time, the P/F tool hotkeys are tightly gated, and reduced-motion
// is honoured. Own bridge on side port 4785, own tiny page server on 5196 —
// the user's real Chrome on 4700 is untouched.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/nudge-uxsuite-store'
const PORT = 4785, PAGE = 5196
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><h1 id="t">UX suite</h1><input id="inp" placeholder="type here">') }).listen(PAGE)
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const cleanup = () => { try { bridge.kill() } catch {} try { pageSrv.close() } catch {} }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

const now = Date.now()
const hb = o => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) })
// two sessions labelled the way a user would, with the :PORT suffix in the name
const A = { label: 'Estimate Templates :5175', pid: 701, session: 'estT', since: now - 5 * 60000, project: 'roots-apps', branch: 'feat/x', host: 'Zed' }
const M = { label: 'Maps-Refactor :5276', pid: 702, session: 'mapR', since: now - 3 * 60000, project: 'roots-apps', branch: 'feat/y', host: 'Zed' }
const beat = setInterval(() => { hb(A); hb(M) }, 1000)
await hb(A); await hb(M); await sleep(200)
await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: A.pid, session: A.session, host: `localhost:${PAGE}` }) })
await sleep(300)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate(p => chrome.storage.local.set({ nudgePort: p }), PORT)
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await p.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  await p.waitForTimeout(700)
  // drag the pill clear of the corner so popovers have room
  const g = await p.locator('.pill .grip').boundingBox()
  await p.mouse.move(g.x + 6, g.y + 6); await p.mouse.down(); await p.mouse.move(420, 160, { steps: 4 }); await p.mouse.up()
  await p.waitForTimeout(150)

  const rd = fn => p.evaluate(fn)
  const click = sel => p.evaluate(s => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector(s).click(), sel)
  const noInlinePort = s => !/:\d{2,5}\b/.test(s || '')

  // ---------- L1: localhost is a pill, never inline — toolbar + switcher rows ----------
  {
    const tl = await rd(() => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill .who-label').textContent)
    const th = await rd(() => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill .who-host').textContent)
    const tk = await rd(() => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill .who-kind').textContent)
    if (tk !== 'Agent:') fail(`L1: toolbar should label the owner with "Agent:", got "${tk}"`)
    // the owner's session id is visible in the toolbar WITHOUT any click
    const tid = await rd(() => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill .who-id').textContent)
    if (tid !== 'estT') fail(`L1: toolbar should show the owner's session id (estT) without a click, got "${tid}"`)
    if (!noInlinePort(tl)) fail(`L1: toolbar label has inline port: "${tl}"`)
    // the toolbar shows the localhost as a clean pill (owner is "Estimate Templates :5175")
    if (th !== 'localhost:5175') fail(`L1: toolbar host pill should be localhost:5175, got "${th}"`)
    await click('.pill .who')
    await p.locator('.who-menu.on').waitFor({ timeout: 3000 })
    const rows = await rd(() => [...document.getElementById('__groundworks-nudge-host').shadowRoot.querySelectorAll('.who-menu .w-row')].map(x => ({ name: x.querySelector('.w-name').textContent, host: x.querySelector('.w-host')?.textContent || null, l2: x.querySelector('.w-line2')?.textContent || '' })))
    // each row carries its session id — the key the /groundworks-nudge arm-report
    // prints, so chat ↔ dropdown match 1:1 even with duplicate labels
    for (const want of [{ n: 'Estimate Templates', id: 'estT' }, { n: 'Maps-Refactor', id: 'mapR' }]) {
      const r = rows.find(x => x.name.replace('● ', '') === want.n)
      if (r && !r.l2.includes(want.id)) fail(`L1: row "${want.n}" must show its session id ${want.id} in the meta line, got "${r.l2}"`)
    }
    // no row may show an inline :port anywhere in its NAME (the roster may hold
    // noise from concurrent test bridges — that's fine, we assert the invariant)
    for (const r of rows) if (!noInlinePort(r.name.replace('● ', ''))) fail(`L1: row name has inline port: "${r.name}"`)
    // and the two port-carrying sessions we armed must each show a clean localhost pill
    for (const want of [{ n: 'Estimate Templates', h: 'localhost:5175' }, { n: 'Maps-Refactor', h: 'localhost:5276' }]) {
      const r = rows.find(x => x.name.replace('● ', '') === want.n)
      if (!r) fail(`L1: session row "${want.n}" not in the switcher`)
      if (r.host !== want.h) fail(`L1: "${want.n}" pill should be ${want.h}, got "${r.host}"`)
    }
    await p.keyboard.press('Escape')
    pass('L1 localhost is a clean pill on the toolbar AND switcher rows, never inline in the name')
  }

  // ---------- L2: connection feed chip — clean name + host pill ----------
  {
    const chips = await rd(() => [...document.getElementById('__groundworks-nudge-host').shadowRoot.querySelectorAll('.feed .item')].map(it => ({ text: it.querySelector('.feed-text')?.textContent, host: it.querySelector('.feed-host')?.textContent || null })))
    const agentChips = chips.filter(c => /^Agent: /.test(c.text || ''))
    if (!agentChips.length) fail('L2: no "Agent: …" connection chip appeared')
    for (const c of agentChips) {
      if (!noInlinePort(c.text)) fail(`L2: feed chip text has inline port: "${c.text}"`)
      if (!c.host || !/^localhost:\d+$/.test(c.host)) fail(`L2: feed chip missing clean localhost pill, got "${c.host}"`)
    }
    pass('L2 connection feed chip shows a clean name + localhost pill (no inline :port)')
  }

  // ---------- L3: only one popover open at a time ----------
  {
    // one open nudge so the count badge + queue exist
    await fetch(`${B}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'note', url: `http://localhost:${PAGE}/`, target: { selector: '#t' } }) })
    await p.waitForTimeout(300)
    const state = () => rd(() => { const r = document.getElementById('__groundworks-nudge-host').shadowRoot; return { queue: !!r.querySelector('.queue.on'), who: !!r.querySelector('.who-menu.on') } })
    await click('.pill .count'); await p.waitForTimeout(120)
    let s = await state(); if (!(s.queue && !s.who)) fail(`L3: after opening queue: ${JSON.stringify(s)}`)
    await click('.pill .who'); await p.waitForTimeout(120)
    s = await state(); if (!(s.who && !s.queue)) fail(`L3: opening who must close queue: ${JSON.stringify(s)}`)
    await click('.pill .count'); await p.waitForTimeout(120)
    s = await state(); if (!(s.queue && !s.who)) fail(`L3: opening queue must close who: ${JSON.stringify(s)}`)
    await p.keyboard.press('Escape')
    pass('L3 only one popover open at a time (queue ↔ switch-session are mutually exclusive)')
  }

  // ---------- L4: P/F tool hotkeys, tightly gated ----------
  {
    const modeCls = () => rd(() => { const r = document.getElementById('__groundworks-nudge-host').shadowRoot; return { pick: r.querySelector('.btn-pick').classList.contains('active'), draw: r.querySelector('.btn-draw').classList.contains('active') } })
    await p.locator('body').click({ position: { x: 5, y: 5 } }) // focus the page, not an input
    await p.keyboard.press('p'); await p.waitForTimeout(80)
    let m = await modeCls(); if (!(m.pick && !m.draw)) fail(`L4: "p" should enter picking, got ${JSON.stringify(m)}`)
    await p.keyboard.press('f'); await p.waitForTimeout(80)
    m = await modeCls(); if (!(m.draw && !m.pick)) fail(`L4: "f" should switch to drawing, got ${JSON.stringify(m)}`)
    await p.keyboard.press('f'); await p.waitForTimeout(80)
    m = await modeCls(); if (m.draw || m.pick) fail(`L4: "f" again should toggle drawing off, got ${JSON.stringify(m)}`)
    // gated: typing in a page input must NOT switch tools
    await p.locator('#inp').focus()
    await p.keyboard.type('pf'); await p.waitForTimeout(80)
    m = await modeCls(); if (m.pick || m.draw) fail(`L4: typing "pf" in an input must not switch tools, got ${JSON.stringify(m)}`)
    const typed = await rd(() => document.getElementById('inp').value)
    if (typed !== 'pf') fail(`L4: the input should receive the keys, got "${typed}"`)
    pass('L4 P/F hotkeys switch tools, and are suppressed while typing in a page field')
  }

  // ---------- L5: reduced-motion is honoured ----------
  {
    await p.emulateMedia({ reducedMotion: 'reduce' })
    await p.waitForTimeout(80)
    const dur = await rd(() => { const r = document.getElementById('__groundworks-nudge-host').shadowRoot; const hl = r.querySelector('.hl'); return getComputedStyle(hl).transitionDuration })
    // "0.001s" (our near-zero override) or "0s" both mean motion is off
    const secs = Math.max(...String(dur).split(',').map(x => parseFloat(x) || 0))
    if (secs > 0.05) fail(`L5: highlight still animates under reduced-motion (transition-duration ${dur})`)
    await p.emulateMedia({ reducedMotion: null })
    pass('L5 reduced-motion collapses overlay transitions (no gliding highlight / spinning clock)')
  }

  // ---------- L7: the toolbar stays COMPLETELY visible ----------
  // 2026-07-31: "when a browser opens automatically, or I open the inspection
  // bar on the right, the toolbar is often covered and gone."
  // A docked DevTools panel shrinks the page viewport exactly like a smaller
  // window does — and the bar ALSO grows on its own when a longer session label
  // arrives. Both must keep it inside; neither may cost the remembered spot.
  {
    const box = () => rd(() => {
      const r = document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill').getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }
    })
    const inside = b => b.left >= 0 && b.top >= 0 && b.right <= b.vw && b.bottom <= b.vh
    // 1. the viewport shrinks under the bar (DevTools docked right / small window)
    await p.setViewportSize({ width: 700, height: 620 })
    await p.waitForTimeout(250)
    let b = await box()
    if (!inside(b)) fail(`L7: a shrunken viewport left the toolbar hanging over the edge: ${JSON.stringify(b)}`)
    // 2. parked at the right edge, the bar then GROWS on its own — a longer
    //    session label lands on the next WS frame and NO resize event fires
    A.label = 'Est :5175' // short first, so the growth in a moment is unmistakable
    await hb(A)
    await p.waitForTimeout(1600)
    const g2 = await p.locator('.pill .grip').boundingBox()
    await p.mouse.move(g2.x + 6, g2.y + 6); await p.mouse.down(); await p.mouse.move(690, 200, { steps: 4 }); await p.mouse.up()
    await p.waitForTimeout(200)
    const dropped = await box()
    if (!inside(dropped)) fail(`L7: dropping the bar at the right edge already put it outside: ${JSON.stringify(dropped)}`)
    A.label = 'Estimate Templates with a really very long session name :5175'
    await hb(A)
    await p.waitForTimeout(1600) // heartbeat -> bridge -> WS frame -> toolbar
    const grown = await rd(() => document.getElementById('__groundworks-nudge-host').shadowRoot.querySelector('.pill .who-label').textContent)
    if (!grown.includes('very long')) fail(`L7: the long label never reached the toolbar, got "${grown}"`)
    b = await box()
    // guard against a vacuous test: if the label doesn't widen the bar, step 2 proves nothing
    if (b.right - b.left <= dropped.right - dropped.left) fail('L7: the long label did not widen the toolbar — the growth case is not being exercised')
    if (!inside(b)) fail(`L7: the toolbar grew out of the viewport with no resize to correct it: ${JSON.stringify(b)}`)
    // 3. room comes back (DevTools closed) -> back to where the user dropped it
    await p.setViewportSize({ width: 1400, height: 900 })
    await p.waitForTimeout(250)
    b = await box()
    if (!inside(b)) fail(`L7: toolbar outside the restored viewport: ${JSON.stringify(b)}`)
    if (Math.abs(b.left - dropped.left) > 2 || Math.abs(b.top - dropped.top) > 2)
      fail(`L7: the remembered spot was lost — dropped at ${dropped.left}/${dropped.top}, back at ${b.left}/${b.top}`)
    A.label = 'Estimate Templates :5175'
    await hb(A)
    pass('L7 the toolbar stays completely inside the viewport (shrink + its own growth) and returns to its dropped spot')
  }

  // ---------- L6: an orphaned tab tells the user to ⌘R instead of dying silently ----------
  // (runs LAST: chrome.runtime.reload() kills the SW handle for good)
  {
    await sw.evaluate(() => chrome.runtime.reload()).catch(() => {}) // handle dies mid-call — expected
    let hint = null
    for (let i = 0; i < 24; i++) { await sleep(500); hint = await p.evaluate(() => document.getElementById('__groundworks-nudge-reload-hint')?.textContent || null); if (hint) break }
    if (!hint || !hint.includes('⌘R')) fail(`L6: orphaned tab must show the ⌘R reload hint, got ${JSON.stringify(hint)}`)
    const hostGone = await p.evaluate(() => !document.getElementById('__groundworks-nudge-host'))
    if (!hostGone) fail('L6: the dead overlay must remove itself alongside the hint')
    await p.evaluate(() => document.getElementById('__groundworks-nudge-reload-hint').click())
    if (await p.evaluate(() => !!document.getElementById('__groundworks-nudge-reload-hint'))) fail('L6: click must dismiss the hint')
    pass('L6 an orphaned tab (extension reload) shows the ⌘R hint instead of vanishing silently; click dismisses')
  }

  console.log('\nSuite L — Toolbar & popover UX: ALL PASS')
} finally {
  clearInterval(beat)
  try { await ctx?.close() } catch {}
  cleanup()
}
