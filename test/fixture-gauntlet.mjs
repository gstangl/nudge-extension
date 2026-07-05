// Suite F — Fixture Gauntlet: third-party UI idioms from the internet, vendored
// under test/fixtures/ (see fixtures/README.md for sources + licenses). Where
// Suite E proves OUR apps, Suite F proves the wild: Tailwind/Flowbite patterns
// (sticky nav, dropdown, modal with backdrop outside-close, z-9999 toast,
// transformed parents, shadow DOM, 40-row near-identical tables) and TodoMVC
// React (the classic re-render UI). Own bridge on 4722, static server on 5320.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const FIXTURES = path.join(HERE, 'fixtures')
const STORE = '/tmp/nudge-gauntlet-store'
const TESTPORT = 4722
const PAGEPORT = 5320
fs.rmSync(STORE, { recursive: true, force: true })

const statics = spawn('python3', ['-m', 'http.server', String(PAGEPORT), '-d', FIXTURES], { stdio: 'ignore' })
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], {
  env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(TESTPORT) }, stdio: ['ignore', 'ignore', 'inherit'],
})
{
  let up = false
  for (let i = 0; i < 25 && !up; i++) {
    await new Promise(r => setTimeout(r, 200))
    try { up = (await (await fetch(`http://localhost:${TESTPORT}/.identity`)).json()).store === STORE } catch { /* not yet */ }
  }
  if (!up) { console.error('FAIL: test bridge did not come up'); process.exit(1) }
}
const cleanup = () => { bridge.kill(); statics.kill() }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const until = async (fn, ms, what) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)) }
  fail(`timeout waiting for ${what}`)
}
const selection = async () => (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
const pins = async () => (await fetch(`http://localhost:${TESTPORT}/comments`)).json()
const HB = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'suite-f', pid: process.pid, since: Date.now() }) }
const heartbeat = setInterval(() => { fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {}) }, 2000)
await fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {})

let ctx
try {
  ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), TESTPORT)
  const page = ctx.pages()[0] || await ctx.newPage()
  const boot = async (p) => {
    await page.goto(`http://localhost:${PAGEPORT}/${p}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  }
  const pick = async (locator) => {
    await page.locator('.pill .btn-pick').click()
    await locator.click()
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
  }
  const cancel = () => page.locator('.composer .cancel').click()

  await boot('tailwind-gauntlet.html')
  await page.waitForTimeout(600) // tailwind play compiles classes on load
  // the fixture's nav puts a button top-right — under the pill's DEFAULT spot.
  // The product answer to that collision is the movable grip: drag it away.
  {
    const grip = await page.locator('.pill .grip').boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(300, 820, { steps: 5 })
    await page.mouse.up()
  }

  // ---------- F1: Flowbite modal — A-8 in the wild ----------
  {
    await page.locator('#g-modal-btn').click()
    await page.locator('#g-modal-title').waitFor({ timeout: 3000 })
    // toolbar click must NOT count as the modal's outside-click
    await page.locator('.pill .btn-pick').click()
    await page.waitForTimeout(250)
    if (!(await page.locator('#g-modal-title').isVisible())) fail('F1: pill click closed the Flowbite modal (A-8)')
    await page.locator('#g-modal-title').click()
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
    const sel = await selection()
    if (sel.selector !== '#g-modal-title') fail(`F1: expected #g-modal-title, got ${sel.selector}`)
    if (!(await page.locator('#g-modal-title').isVisible())) fail('F1: picking inside the modal closed it')
    await cancel()
    await page.locator('#g-modal-ok').click() // close via the app's own button
    await page.locator('#g-modal-title').waitFor({ state: 'hidden', timeout: 3000 })
    console.log('PASS F1 Flowbite modal (survives toolbar click + in-modal pick, A-8 wild)')
  }

  // ---------- F2: dropdown — pick inside transient UI without navigating ----------
  {
    await page.locator('#g-dd-btn').click()
    await page.locator('#g-dd-item-2').waitFor({ timeout: 3000 })
    await pick(page.locator('#g-dd-item-2'))
    const sel = await selection()
    if (sel.selector !== '#g-dd-item-2') fail(`F2: expected #g-dd-item-2, got ${sel.selector}`)
    if (!page.url().includes('tailwind-gauntlet')) fail('F2: pick navigated away (href followed)')
    if (page.url().includes('#beta')) fail('F2: pick followed the anchor href')
    await cancel()
    await page.keyboard.press('Escape')
    console.log('PASS F2 dropdown (item picked, href NOT followed, page stays)')
  }

  // ---------- F3: scroll + near-identical rows — unique selector, sane rect ----------
  {
    await page.locator('#g-deep-title').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await pick(page.locator('#g-deep-title'))
    const sel = await selection()
    if (sel.selector !== '#g-deep-title') fail(`F3: deep pick got ${sel.selector}`)
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    if (!sel.rect || sel.rect.y < 0 || sel.rect.y > vp.h) fail(`F3: rect outside viewport after scroll (${JSON.stringify(sel.rect)})`)
    await cancel()
    // row 35 of 40 near-identical table rows, inside the scrolled container
    await page.evaluate(() => { document.getElementById('g-table-wrap').scrollTop = 900 })
    await page.waitForTimeout(200)
    const cell = page.locator('#g-table-body tr:nth-child(35) td:first-child')
    await cell.scrollIntoViewIfNeeded()
    await pick(cell)
    const sel2 = await selection()
    const check = await page.evaluate((s) => {
      const els = document.querySelectorAll(s)
      return { n: els.length, text: els[0]?.textContent || '' }
    }, sel2.selector)
    if (check.n !== 1) fail(`F3: selector "${sel2.selector}" matches ${check.n} of 40 rows`)
    if (!check.text.includes('INV-1035')) fail(`F3: unique selector hit the wrong row (${check.text})`)
    await cancel()
    await page.evaluate(() => scrollTo(0, 0))
    console.log('PASS F3 scroll + table (deep pick rect sane; row 35/40 uniquely addressed)')
  }

  // ---------- F4: transformed parent — the mark matches the VISUAL box ----------
  {
    await page.locator('#g-transformed').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await pick(page.locator('#g-tx-title'))
    const sel = await selection()
    const real = await page.evaluate(() => {
      const r = document.getElementById('g-tx-title').getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    for (const k of ['x', 'y', 'w', 'h']) {
      if (Math.abs((sel.rect?.[k] ?? -999) - real[k]) > 2) fail(`F4: rect.${k} off under transform (sel ${sel.rect?.[k]} vs real ${real[k]})`)
    }
    await cancel()
    console.log('PASS F4 transformed parent (selection rect = visual box within 2px)')
  }

  // ---------- F5: shadow DOM — pick retargets to the HOST (documented boundary) ----------
  {
    await page.locator('#g-shadow-host').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    // click hits shadow content; the document-level listener sees the retargeted host
    await page.locator('.pill .btn-pick').click()
    await page.locator('#g-shadow-host').click({ position: { x: 30, y: 30 } })
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
    const sel = await selection()
    if (sel.selector !== '#g-shadow-host') fail(`F5: expected retarget to host, got ${sel.selector}`)
    await cancel()
    console.log('PASS F5 shadow DOM (pick retargets to the host element — closed boundary documented)')
  }

  // ---------- F6: z-index 9999 toast — the overlay still wins ----------
  {
    await pick(page.locator('#g-toast'))
    const sel = await selection()
    if (sel.selector !== '#g-toast') fail(`F6: expected #g-toast, got ${sel.selector}`)
    if (!sel.innerText?.includes('deployed')) fail('F6: toast innerText missing')
    await cancel()
    console.log('PASS F6 z-9999 toast (aggressive page z-index cannot beat the picker)')
  }

  // ---------- F7: TodoMVC React — re-render between pick and send ----------
  {
    await boot('todomvc-react/index.html')
    const input = page.locator('.new-todo')
    await input.waitFor({ timeout: 5000 })
    for (const t of ['Bridge härten', 'Suiten grün halten', 'Release taggen']) {
      await input.fill(t)
      await input.press('Enter')
    }
    const items = page.locator('.todo-list li')
    if (await items.count() !== 3) fail('F7: todos not created')
    await pick(items.nth(1).locator('label'))
    const selBefore = await selection()
    // React re-render: toggle ANOTHER todo — list items re-render, keyed rows shuffle classes
    await page.evaluate(() => document.querySelectorAll('.todo-list li .toggle')[0].click())
    await page.waitForTimeout(300)
    await page.locator('textarea[placeholder*="Nudge"]').fill('[TEST-F7] re-render pick')
    await page.locator('.composer .send').click()
    await until(async () => (await pins()).some(p => p.text?.includes('[TEST-F7]')), 6000, 'todo pin stored')
    const stored = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins.find(p => p.text.includes('[TEST-F7]'))
    const r = stored.target?.rect
    if (!r || !(r.w > 10 || r.width > 10)) fail(`F7: pin lost its rect after re-render (${JSON.stringify(r)})`)
    if (Math.abs((r.y ?? 0) - (selBefore.rect?.y ?? -999)) > 30) fail('F7: rect drifted far from pick-time')
    if (!stored.target?.innerText?.includes('Suiten grün halten')) fail(`F7: innerText lost (${stored.target?.innerText})`)
    console.log('PASS F7 TodoMVC (React re-render between pick and send — selector, rect, text survive)')
  }

  console.log('\nSuite F — Fixture Gauntlet: ALL PASS')
} finally {
  clearInterval(heartbeat)
  try { await ctx?.close() } catch { /* gone */ }
  cleanup()
}
