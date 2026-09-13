// Suite P — Multi-selection (Shift+click). 2026-07-29: "mark one element,
// then add more with Shift" did not work reliably — it depended on
// how the selection STARTED. Shift on the very first click worked (that path puts
// mode back to 'picking'); a plain click first opened the composer, left mode at
// 'composing', and every further click was dropped at the top of onClick. The
// composer's own placeholder promises "⇧click add element", so the promise, not
// the code, was right. Legs cover both entry paths plus the properties that make
// it feel reliable: toggle-off, typed text survives, the moat doesn't eat a
// deliberate Shift+click, and a lasso region stays out of it.
// Hermetic: own page server on 5195, no bridge (the pill renders offline).
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const PAGE = 5195
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HTML = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;font-family:sans-serif;padding:60px}
  .box{width:220px;height:70px;background:#eee;border:1px solid #ccc;margin:14px 0;display:flex;align-items:center;justify-content:center}
  #moat{position:fixed;background:#dde;border:1px solid #99a;display:none;align-items:center;justify-content:center}
</style></head><body>
  <div class="box" id="a">A</div><div class="box" id="b">B</div><div class="box" id="c">C</div>
  <div id="moat">near-composer</div>
</body></html>`

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
let failed = 0
const fail = (m) => { console.error('FAIL:', m); failed++ }
const pass = (m) => console.log('PASS', m)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: process.env.NUDGE_HEADLESS === '1', channel: 'chromium', viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await p.locator('.pill').waitFor({ timeout: 15000 })
  await sleep(500)

  const sr = 'document.getElementById("__groundworks-nudge-host").shadowRoot'
  const outlines = () => p.evaluate(`${sr}.querySelectorAll('.hl-multi').length`)
  const meta = () => p.evaluate(`${sr}.querySelector('.composer .meta').textContent`)
  const strokes = () => p.evaluate(`${sr}.querySelectorAll('.draw path').length`)
  const taVal = () => p.evaluate(`${sr}.querySelector('.composer textarea').value`)
  const chipsShown = () => p.evaluate(`getComputedStyle(${sr}.querySelector('.composer .layers')).display !== 'none'`)
  const arm = async () => { await p.keyboard.press('Escape'); await sleep(120); await p.evaluate(`${sr}.querySelector('.btn-pick').click()`); await sleep(150) }
  const at = async (id) => p.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
  const shiftAt = async (x, y) => { await p.keyboard.down('Shift'); await p.mouse.click(x, y); await p.keyboard.up('Shift'); await sleep(250) }
  const shiftClick = async (id) => { const c = await at(id); await shiftAt(c.x, c.y) }
  const click = async (id) => { const c = await at(id); await p.mouse.click(c.x, c.y); await sleep(250) }

  // ---------- P1: Shift held from the FIRST click ----------
  {
    await arm()
    await shiftClick('a'); await shiftClick('b')
    const n = await outlines()
    if (n !== 2) fail(`P1: expected 2 outlines, got ${n}`)
    else pass('P1 Shift from the very first click collects 2 elements')
  }

  // ---------- P2: plain click first, THEN Shift — the reported break ----------
  {
    await arm()
    await click('a')            // composer opens on this one, mode = 'composing'
    await shiftClick('b')
    const n = await outlines(), m = await meta()
    if (n !== 2) fail(`P2: expected 2 outlines, got ${n} · meta="${m}"`)
    else if (!m.startsWith('2 elements')) fail(`P2: meta must name the count, got "${m}"`)
    else if (await chipsShown()) fail('P2: layer chips are a single-pick affordance — must hide in multi')
    else pass('P2 plain click, then Shift+click adds the second element')
  }

  // ---------- P3: the set keeps growing ----------
  {
    await shiftClick('c')
    const n = await outlines()
    if (n !== 3) fail(`P3: expected 3 outlines, got ${n}`)
    else pass('P3 a third Shift+click extends the same selection')
  }

  // ---------- P4: Shift on a collected element toggles it back off ----------
  {
    await shiftClick('c')
    const n = await outlines()
    if (n !== 2) fail(`P4: expected 2 outlines after toggling C off, got ${n}`)
    else pass('P4 Shift+click on a collected element toggles it off')
  }

  // ---------- P5: extending must not wipe what is already typed ----------
  {
    await arm()
    await click('a')
    await p.keyboard.type('swap these two')
    await shiftClick('b')
    if ((await outlines()) !== 2) fail('P5: setup — Shift did not extend')
    else if (await taVal() !== 'swap these two') fail(`P5: composer text lost on extend, got "${await taVal()}"`)
    else pass('P5 the typed nudge survives extending the selection')
  }

  // ---------- P6: a plain click resets to a single pick ----------
  {
    await click('c')
    const n = await outlines()
    if (n !== 0) fail(`P6: expected the multi set cleared, got ${n} outlines`)
    else if (!(await meta()).includes('#c')) fail(`P6: expected a single pick on #c, meta="${await meta()}"`)
    else pass('P6 a plain click resets the multi set to one element')
  }

  // ---------- P7: the moat must not eat a deliberate Shift+click ----------
  // The composer opens BESIDE the mark, so the next element the user wants is often
  // right next to it — inside the 12px moat that absorbs near-miss clicks.
  {
    await arm()
    await click('a')
    const box = await p.evaluate(`(() => {
      const c = ${sr}.querySelector('.composer').getBoundingClientRect()
      const m = document.getElementById('moat')
      m.style.display = 'flex'; m.style.width = '90px'; m.style.height = '40px'
      m.style.left = (c.left - 96) + 'px'; m.style.top = (c.top + 20) + 'px'   // 6px gap: inside the moat
      const r = m.getBoundingClientRect(); return { x: r.right - 3, y: r.top + r.height / 2 }
    })()`)
    await shiftAt(box.x, box.y)
    const n = await outlines()
    if (n !== 2) fail(`P7: a Shift+click 6px from the composer was swallowed by the moat — got ${n} outlines`)
    else pass('P7 a deliberate Shift+click right beside the composer still lands')
  }

  // ---------- P8: a lasso region has no element to collect with ----------
  {
    await p.keyboard.press('Escape'); await sleep(120)
    await p.evaluate(`document.getElementById('moat').style.display = 'none'`)
    await p.evaluate(`${sr}.querySelector('.btn-draw').click()`); await sleep(150)
    await p.mouse.move(140, 140); await p.mouse.down()
    for (const [x, y] of [[300, 150], [320, 260], [160, 250], [140, 145]]) await p.mouse.move(x, y, { steps: 4 })
    await p.mouse.up(); await sleep(600)
    if (!await strokes()) fail('P8: setup — no lasso drawn')
    await shiftClick('c')
    const n = await outlines()
    if (n !== 0) fail(`P8: a Shift+click folded an element into a REGION mark — got ${n} outlines`)
    else if (!await strokes()) fail('P8: the lasso stroke was dropped by the Shift+click')
    else pass('P8 a region mark stays a region — Shift+click does not fold elements into it')
  }

  console.log(failed ? `\nSuite P — Multi-selection: ${failed} FAILED` : '\nSuite P — Multi-selection: ALL PASS')
} finally {
  try { await ctx?.close() } catch { /* already gone */ }
  try { pageSrv.close() } catch { /* already closed */ }
}
process.exit(failed ? 1 : 0)
