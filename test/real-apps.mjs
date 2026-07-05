// Suite E — Real Apps: the demo page proves mechanics, the REAL apps prove the
// product. Picks/prompts against md-pdf, estimate (ProseMirror!) and media,
// each started from THIS worktree on side ports (never Gerald's live dev
// servers). The attractive edge cases live here: detached ProseMirror nodes
// (A-2), selector uniqueness in a grid of identical cards, typed input values
// that must NOT leak into a mark, per-route queue truth across apps.
import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..') // repo root (worktree)
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/nudge-realapps-store'
fs.rmSync(STORE, { recursive: true, force: true })

// ---------- app servers: reuse if already on the side port, else spawn ----------
const APPS = [
  { name: 'md-pdf', dir: 'apps/md-pdf', port: 5313, path: '/' },
  { name: 'estimate', dir: 'apps/estimate', port: 5315, path: '/estimate/?editor=v2#/' },
  { name: 'media', dir: 'apps/media', port: 5318, path: '/media/' },
]
const spawned = []
async function ensureApp(app) {
  const url = `http://localhost:${app.port}${app.path}`
  const alive = async () => { try { return (await fetch(`http://localhost:${app.port}/`, { signal: AbortSignal.timeout(1000) })).status < 500 } catch { return false } }
  if (!(await alive())) {
    const p = spawn('npx', ['vite', '--port', String(app.port), '--strictPort'], {
      cwd: path.join(ROOT, app.dir), stdio: 'ignore', detached: false,
    })
    spawned.push(p)
    for (let i = 0; i < 60; i++) { if (await alive()) break; await new Promise(r => setTimeout(r, 500)) }
    if (!(await alive())) { console.error(`FAIL: ${app.name} did not start on :${app.port}`); process.exit(1) }
  }
  return url
}

// OWN side port — the live bridge on 4700 keeps serving Gerald untouched.
// The extension in the TEST browser is re-pointed via chrome.storage.nudgePort
// (see below); stealing 4700 once showed a test agent in the real toolbar.
const TESTPORT = 4721
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
const cleanup = () => { bridge.kill(); for (const p of spawned) p.kill() }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const until = async (fn, ms, what) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)) }
  fail(`timeout waiting for ${what}`)
}
const selection = async () => (await fetch(`http://localhost:${TESTPORT}/selection`)).json()
const pins = async () => (await fetch(`http://localhost:${TESTPORT}/comments`)).json()
// live agent so chips/status read "Agent arbeitet" deterministically
const HB = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'suite-e', pid: process.pid, since: Date.now() }) }
const heartbeat = setInterval(() => { fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {}) }, 2000)
await fetch(`http://localhost:${TESTPORT}/agent/heartbeat`, HB).catch(() => {})

const urls = {}
for (const app of APPS) urls[app.name] = await ensureApp(app)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  // re-point THIS browser's extension at the test bridge before any page loads
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), TESTPORT)
  const page = ctx.pages()[0] || await ctx.newPage()
  const boot = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 }) // cold-start barrier
  }
  const pick = async (locator) => {
    await page.locator('.pill .btn-pick').click()
    await locator.click()
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
  }

  // ---------- E1: md-pdf — pick on a real product surface, panel stays usable ----------
  {
    await boot(urls['md-pdf'])
    await pick(page.locator('#dz-card'))
    // the pick lands on the INNERMOST element (chips retarget upward by design) —
    // assert it resolves to something inside the card, not a specific id
    await until(async () => !!(await selection()).selector, 5000, 'md-pdf selection')
    const sel = await selection()
    const inCard = await page.evaluate((s) => {
      try { const el = document.querySelector(s); return !!el && !!el.closest('#dz-card') } catch { return false }
    }, sel.selector)
    if (!inCard) fail(`E1: selector "${sel.selector}" not inside #dz-card`)
    if (sel.screenshot) fail('E1: element pick must be DOM-only')
    await page.locator('.composer .cancel').click()
    // load a REAL document via the dropzone (dynamic file input -> filechooser),
    // then pick inside the PagedJS print preview — a heavyweight rendered surface
    fs.writeFileSync('/tmp/nudge-e1-doc.md', '# Suite-E Dokument\n\nEin Absatz mit **Substanz** für die Vorschau.\n\n- Punkt eins\n- Punkt zwei\n')
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#dz-card').click()
    await (await chooser).setFiles('/tmp/nudge-e1-doc.md')
    // staging step: file is read, fields prefilled — the RENDER happens only on
    // the explicit »Generate document« click (md-pdf product flow)
    await page.locator('.btn-generate').first().waitFor({ timeout: 5000 })
    await page.locator('.btn-generate').first().click()
    await page.locator('.pagedjs_page').first().waitFor({ timeout: 30000 })
    const pageEl = page.locator('.pagedjs_page_content h1, .pagedjs_page_content p').first()
    await pick(pageEl)
    const sel2 = await selection()
    const inPage = await page.evaluate((s) => {
      try { const el = document.querySelector(s); return !!el && !!el.closest('.pagedjs_page') } catch { return false }
    }, sel2.selector)
    if (!inPage) fail(`E1: selector "${sel2.selector}" not inside the rendered page`)
    await page.locator('.composer .cancel').click()
    console.log('PASS E1 md-pdf (dropzone pick DOM-only; real doc loaded, pick inside PagedJS preview)')
  }

  // ---------- E4: typed input values must NOT leak into a mark ----------
  {
    // doc is still loaded from E1 (same tab) — app controls are visible now.
    // The boundary this leg documents: PAGE-OWNED surfaces (title, url) carry
    // whatever the page puts there (md-pdf reflects the Dokumenttitel field into
    // document.title — that is the APP's exposure, reported faithfully);
    // ELEMENT-OWNED channels (innerText, outerHTML, styles, targets) must NEVER
    // carry a typed value — DOM properties are not serialized.
    const SECRET = 'geheim-hunter2-4711'
    await page.locator('#settings-toggle').click()
    const inputs = page.locator('input[type="text"]:visible')
    const nIn = await inputs.count()
    for (let i = 0; i < nIn; i++) await inputs.nth(i).fill(`${SECRET}-${i}`)
    await pick(inputs.nth(Math.min(1, nIn - 1))) // a NON-title field
    const sel = await selection()
    const elementOwned = JSON.stringify({ innerText: sel.innerText, outerHTML: sel.outerHTML, styles: sel.styles, targets: sel.targets, selector: sel.selector, xpath: sel.xpath })
    if (elementOwned.includes(SECRET)) fail('E4: typed value leaked into ELEMENT-owned channels')
    await page.locator('textarea[placeholder*="Nudge"]').fill('[TEST-E4] input hygiene')
    await page.locator('.composer .send').click()
    await until(async () => (await pins()).some(p => p.text?.includes('[TEST-E4]')), 6000, 'hygiene pin stored')
    const storedRaw = fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')
    const pinE4 = JSON.parse(storedRaw).pins.find(p => p.text.includes('[TEST-E4]'))
    const pinOwned = JSON.stringify({ ...pinE4, title: null, url: null })
    if (pinOwned.includes(SECRET)) fail('E4: typed value leaked into the stored pin outside page-owned fields')
    console.log('PASS E4 input hygiene (typed values never in element-owned channels; page-owned title reflection is the app\'s, documented)')
  }

  // ---------- E2: estimate — ProseMirror, THE detached-element case (A-2) ----------
  {
    await boot(urls['estimate'])
    // open a document: first library row, else the demo button
    const row = page.locator('.lib-row').first()
    if (await row.count()) await row.click()
    else await page.locator('.lib-btn', { hasText: 'Demo' }).first().click()
    await page.locator('.ProseMirror').first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(800) // editor settles
    const para = page.locator('.ProseMirror p').first()
    if (!(await para.count())) fail('E2: no paragraph in the editor')
    await pick(para)
    const selBefore = await selection()
    if (!selBefore.selector || !selBefore.rect) fail('E2: PM pick published no selector/rect')
    const rectBefore = selBefore.rect
    // THE A-2 moment: the picked node leaves the DOM before send (re-render).
    // ProseMirror does this on every transaction that rebuilds the block.
    await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror p')
      const clone = el.cloneNode(true)
      el.replaceWith(clone) // same content, NEW node — the picked reference is detached
    })
    await page.locator('textarea[placeholder*="Nudge"]').fill('[TEST-E2] detached PM node')
    await page.locator('.composer .send').click()
    await until(async () => (await pins()).some(p => p.text?.includes('[TEST-E2]')), 6000, 'detached-node pin stored')
    const pin = (await pins()).find(p => p.text?.includes('[TEST-E2]'))
    const stored = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins.find(p => p.id === pin.id)
    const r = stored.target?.rect
    if (!r || !(r.w > 10 || r.width > 10)) fail(`E2: detached node lost its rect (${JSON.stringify(r)}) — fallback chain broken`)
    if (Math.abs((r.x ?? r.left ?? 0) - (rectBefore.x ?? rectBefore.left ?? 0)) > 5) fail('E2: rect drifted from pick-time')
    console.log('PASS E2 estimate (ProseMirror pick; node detached before send -> pick-time rect survives, A-2)')
  }

  // ---------- E3: media — selector uniqueness in a grid of near-identical cards ----------
  {
    await boot(urls['media'])
    await page.locator('.asset').first().waitFor({ timeout: 15000 })
    const n = await page.locator('.asset').count()
    if (n < 2) { console.log(`PASS E3 media (SKIPPED uniqueness: only ${n} asset in the gallery)`) }
    else {
      const second = page.locator('.asset').nth(1)
      await pick(second.locator('.asset__thumb').first())
      const sel = await selection()
      const unique = await page.evaluate((s) => {
        try { return document.querySelectorAll(s).length } catch { return -1 }
      }, sel.selector)
      if (unique !== 1) fail(`E3: selector "${sel.selector}" matches ${unique} elements — not unique in the grid`)
      const hits = await page.evaluate((s) => {
        const el = document.querySelector(s)
        return el && document.querySelectorAll('.asset')[1].contains(el)
      }, sel.selector)
      if (!hits) fail('E3: unique selector points at the WRONG card')
      await page.locator('.composer .cancel').click()
      // multi-select across two cards
      await page.locator('.pill .btn-pick').click()
      // convention (A-7): only SHIFT collects — the multi-selection starts with
      // a shift-click; a plain first pick would enter composing and go single
      await page.locator('.asset').nth(0).locator('.asset__thumb').first().click({ modifiers: ['Shift'] })
      await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
      // shift-click the FARTHEST asset — the composer floats near the first mark
      // and may cover the neighbour (test geometry, not a product path)
      await page.locator('.asset').nth(n - 1).locator('.asset__thumb').first().click({ modifiers: ['Shift'] })
      await until(async () => (await selection()).targets?.length === 2, 5000, 'multi-selection across cards')
      await page.locator('.composer .cancel').click()
      console.log(`PASS E3 media (unique selector among ${n} identical cards, shift-multi across cards)`)
    }
  }

  // ---------- E5: per-route queue truth ACROSS apps ----------
  {
    // one open pin now exists on md-pdf (E4); create one on media, then check both badges
    await boot(urls['media'])
    await pick(page.locator('#gallery'))
    await page.locator('textarea[placeholder*="Nudge"]').fill('[TEST-E5] media pin')
    await page.locator('.composer .send').click()
    await until(async () => (await pins()).filter(p => p.status === 'open').length >= 2, 6000, 'two open pins across apps')
    await until(async () => ((await page.locator('.pill .count.show').textContent().catch(() => '')) || '').trim() === '1', 6000, 'media badge counts only its route')
    await boot(urls['md-pdf'])
    await until(async () => ((await page.locator('.pill .count.show').textContent().catch(() => '')) || '').trim() === '1', 6000, 'md-pdf badge counts only its route')
    console.log('PASS E5 cross-app queue truth (each tab counts only its own route)')
  }

  console.log('\nSuite E — Real Apps: ALL PASS')
} finally {
  clearInterval(heartbeat)
  try { await ctx?.close() } catch { /* gone */ }
  cleanup()
}
