// Suite Q — Reload resilience. 2026-07-29: "every time the browser reloads
// because the agent is doing something in the background, my Nudge bar briefly
// disappears, my input field too, and I lose what I was about to do."
// The dev server reloads the tab under the user's hands; the content script dies
// with the half-written nudge in it. A content script cannot survive a
// navigation — so the WORKING state is snapshotted into sessionStorage and
// rebuilt on the next load. Legs cover the promise and its accepted worst case:
// the typed text ALWAYS comes back, the DOM anchor only if the app renders that
// element again (incl. late hydration), and a mark whose element is gone still
// sends instead of throwing.
// Hermetic: own page server on 5196, extension re-pointed to a DEAD bridge port
// (4799) so no fetch can ever reach the user's live bridge on 4700.
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const PAGE = 5196
const DEAD_PORT = 4799 // nothing listens here — the live bridge stays untouched
const sleep = ms => new Promise(r => setTimeout(r, ms))

// `?gone=1` drops #alpha — the element the agent's edit removed from the render.
// #late appears only after 900ms: the SPA-hydration case the restore must wait for.
const HTML = `<!doctype html><html><head><meta charset=utf8><title>reload</title><style>
  body{margin:0;font-family:sans-serif;padding:40px}
  .box{width:240px;height:64px;background:#eee;border:1px solid #ccc;margin:12px 0;display:flex;align-items:center;justify-content:center}
</style></head><body>
  <div id="wrap"></div>
  <script>
    const wrap = document.getElementById('wrap')
    const add = (id, label) => wrap.insertAdjacentHTML('beforeend', '<div class="box" id="' + id + '">' + label + '</div>')
    if (!new URLSearchParams(location.search).has('gone')) add('alpha', 'Alpha')
    add('beta', 'Beta')
    add('gamma', 'Gamma')
    setTimeout(() => add('late', 'Late'), 900)
  </script>
</body></html>`

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
let failed = 0
const fail = (m) => { console.error('FAIL:', m); failed++ }
const pass = (m) => console.log('PASS', m)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), DEAD_PORT)

  const p = await ctx.newPage()
  const sr = 'document.getElementById("__groundworks-nudge-host").shadowRoot'
  const ready = async () => { await p.locator('.pill').waitFor({ timeout: 15000 }); await sleep(250) }
  const meta = () => p.evaluate(`${sr}.querySelector('.composer .meta').textContent`)
  const metaLost = () => p.evaluate(`${sr}.querySelector('.composer .meta').classList.contains('lost')`)
  const taVal = () => p.evaluate(`${sr}.querySelector('.composer textarea').value`)
  const open = () => p.evaluate(`getComputedStyle(${sr}.querySelector('.composer')).display === 'block'`)
  const hlTop = () => p.evaluate(`${sr}.querySelector('.hl').classList.contains('on') ? parseFloat(${sr}.querySelector('.hl').style.top) : null`)
  const outlines = () => p.evaluate(`${sr}.querySelectorAll('.hl-multi').length`)
  const topOf = (id) => p.evaluate(`document.getElementById('${id}').getBoundingClientRect().top`)
  const at = async (id) => p.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
  const arm = async () => { await p.keyboard.press('Escape'); await sleep(120); await p.evaluate(`${sr}.querySelector('.btn-pick').click()`); await sleep(150) }
  const click = async (id) => { const c = await at(id); await p.mouse.click(c.x, c.y); await sleep(300) }
  const shiftClick = async (id) => { const c = await at(id); await p.keyboard.down('Shift'); await p.mouse.click(c.x, c.y); await p.keyboard.up('Shift'); await sleep(300) }
  const until = async (fn, ms, what) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150) }
    fail(`timeout waiting for ${what}`)
    return false
  }

  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await ready()

  // ---------- Q1: the half-written nudge comes back ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('round off this edge')
    await sleep(400) // let the snapshot settle (pagehide flushes anyway)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (!await open()) fail('Q1: the composer did not come back after the reload')
    else if (await taVal() !== 'round off this edge') fail(`Q1: typed text lost, got "${await taVal()}"`)
    else if (!(await meta()).includes('#beta')) fail(`Q1: the mark lost its target, meta="${await meta()}"`)
    else pass('Q1 draft + target survive a page reload')
  }

  // ---------- Q2: the mark re-attaches to the live element ----------
  {
    const ok = await until(async () => !await metaLost() && await hlTop() !== null, 8000, 'the highlight to re-attach')
    const dy = Math.abs((await hlTop()) - (await topOf('beta')))
    if (!ok) { /* already reported */ }
    else if (dy > 3) fail(`Q2: the highlight is ${dy}px off the element it marks`)
    else pass('Q2 the restored mark snaps back onto its live element')
  }

  // ---------- Q3: an element that hydrates LATE is still found ----------
  {
    await arm()
    await until(async () => p.evaluate(`!!document.getElementById('late')`), 4000, '#late to render')
    await click('late')
    await p.keyboard.type('this one only after hydration')
    await sleep(400)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready() // the content script is up while #late does not exist yet
    if (await taVal() !== 'this one only after hydration') fail('Q3: text lost on the late-element reload')
    else if (!await until(async () => !await metaLost() && await hlTop() !== null, 8000, 'the late element to be relocated')) { /* reported */ }
    else if (!(await meta()).includes('#late')) fail(`Q3: relocated onto the wrong node, meta="${await meta()}"`)
    else pass('Q3 an element rendered ~1s after load is found inside the retry window')
  }

  // ---------- Q4: the element never comes back — text survives, the mark says so ----------
  {
    await arm()
    await click('alpha')
    await p.keyboard.type('Alpha is about to vanish')
    await sleep(400)
    await p.goto(`http://localhost:${PAGE}/?gone=1`, { waitUntil: 'domcontentloaded' }) // same route, #alpha no longer rendered
    await ready()
    if (!await open()) fail('Q4: composer gone — the draft must outlive its element')
    else if (await taVal() !== 'Alpha is about to vanish') fail(`Q4: typed text lost with the element, got "${await taVal()}"`)
    else if (!await until(metaLost, 12000, 'the mark to report its lost anchor')) { /* reported */ }
    else if (!(await meta()).startsWith('element gone')) fail(`Q4: the meta must SAY the anchor is gone, got "${await meta()}"`)
    else pass('Q4 element gone: text kept, anchor honestly reported as lost')
  }

  // ---------- Q5: such a mark still sends (frozen context, no crash) ----------
  {
    const errs = []
    p.on('pageerror', e => errs.push(String(e)))
    await p.evaluate(`${sr}.querySelector('.composer .send').click()`)
    await sleep(900)
    const chips = await p.evaluate(`[...${sr}.querySelectorAll('.feed .feed-text')].map(n => n.textContent)`)
    if (errs.length) fail(`Q5: sending an anchor-less mark threw: ${errs[0]}`)
    else if (!chips.some(t => /queued|offline/i.test(t))) fail(`Q5: no send feedback, chips=${JSON.stringify(chips)}`)
    else if (await open()) fail('Q5: the composer stayed open after the send')
    else pass('Q5 a mark whose element is gone still sends (queued offline, no crash)')
  }

  // ---------- Q6: a cancelled draft must NOT resurrect ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('never mind, not this')
    await sleep(300)
    await p.keyboard.press('Escape')
    await sleep(300)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    await sleep(600)
    if (await open()) fail(`Q6: a cancelled composer came back with "${await taVal()}"`)
    else pass('Q6 Escape before the reload leaves nothing to restore')
  }

  // ---------- Q7: a Shift-collected multi-selection survives too ----------
  {
    await arm()
    await click('beta')
    await shiftClick('gamma')
    await p.keyboard.type('swap these two')
    await sleep(400)
    if (await outlines() !== 2) fail('Q7: setup — the multi-selection did not form')
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (await taVal() !== 'swap these two') fail('Q7: text lost on the multi reload')
    else if (!await until(async () => await outlines() === 2, 8000, 'both outlines to come back')) { /* reported */ }
    else if (!(await meta()).startsWith('2 elements')) fail(`Q7: the set lost its count, meta="${await meta()}"`)
    else pass('Q7 a Shift-collected set of elements survives the reload')
  }

  console.log(failed ? `\nSuite Q — Reload resilience: ${failed} FAILED` : '\nSuite Q — Reload resilience: ALL PASS')
} catch (e) {
  fail(e.message || String(e))
} finally {
  try { await ctx?.close() } catch { /* already gone */ }
  try { pageSrv.close() } catch { /* already closed */ }
}
process.exit(failed ? 1 : 0)
