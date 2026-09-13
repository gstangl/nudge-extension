// Suite O — Escape always clears the marks. 2026-07-29: "when I press Escape,
// the marks should disappear again" — they didn't, on a real
// app. Same class of bug as the moat (Suite M): the page gets the event FIRST.
// Dialog/dropdown libraries (Radix, Headless UI, @roots/ui) listen for Escape on
// WINDOW capture and stopImmediatePropagation() it while their layer is open —
// a document-capture listener downstream never runs. Legs 1-3 are the clean-page
// baseline, legs 4-5 the hostile page. Hermetic: own page server on 5194, no
// bridge (the pill renders offline).
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const PAGE = 5194
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HTML = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;height:200vh;font-family:sans-serif;padding:60px}
  .box{width:220px;height:80px;background:#eee;border:1px solid #ccc;margin:14px 0;display:flex;align-items:center;justify-content:center}
</style></head><body>
  <div class="box" id="a">A</div>
  <div class="box" id="b">B</div>
  <script>
    // A dialog library's Escape handler: WINDOW capture, stops everything.
    function eat(e){ if(e.key==='Escape'){ e.stopImmediatePropagation(); window.__ate=(window.__ate||0)+1 } }
    // a focus-trapped dialog that owns the whole keyboard, not just Escape
    function eatAll(e){ e.stopImmediatePropagation(); window.__ate=(window.__ate||0)+1 }
    // Same thing one hop later: document capture, registered before the content
    // script exists (page parse < document_idle).
    function eatDoc(e){ if(e.key==='Escape'){ e.stopImmediatePropagation(); window.__ate=(window.__ate||0)+1 } }
    window.__swallowEsc=(where)=>{
      window.removeEventListener('keydown',eat,true); document.removeEventListener('keydown',eatDoc,true)
      window.removeEventListener('keydown',eatAll,true)
      if(where==='window') window.addEventListener('keydown',eat,true)
      if(where==='window-all') window.addEventListener('keydown',eatAll,true)
      if(where==='document') document.addEventListener('keydown',eatDoc,true)
      window.__ate=0
    }
  </script>
</body></html>`

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
const cleanup = () => { try { pageSrv.close() } catch { /* already closed */ } }
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
  // what is visibly marked right now
  const marks = () => p.evaluate(`(() => { const r = ${sr}; return {
    hl: r.querySelector('.hl').classList.contains('on'),
    multi: r.querySelectorAll('.hl-multi').length,
    stroke: r.querySelectorAll('.draw path').length,
    composer: getComputedStyle(r.querySelector('.composer')).display !== 'none',
    pickActive: r.querySelector('.btn-pick').classList.contains('active'),
  } })()`)
  const clickChrome = (sel) => p.evaluate(`${sr}.querySelector('${sel}').click()`)
  const at = async (id) => p.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
  const swallow = (where) => p.evaluate(`window.__swallowEsc(${JSON.stringify(where)})`)
  const clean = async (leg) => {
    const m = await marks()
    const left = Object.entries(m).filter(([, v]) => v === true || v > 0).map(([k]) => k)
    if (left.length) fail(`${leg}: Escape left marks on the page → ${left.join(', ')}`)
    return !left.length
  }

  // ---------- O1: single pick, clean page ----------
  {
    await swallow('none')
    await clickChrome('.btn-pick'); await sleep(120)
    const a = await at('a'); await p.mouse.click(a.x, a.y); await sleep(300)
    if (!(await marks()).composer) fail('O1: setup — composer did not open')
    await p.keyboard.press('Escape'); await sleep(150)
    if (await clean('O1')) pass('O1 single pick: Escape clears highlight + composer (clean page)')
  }

  // ---------- O2: Shift multi-selection, clean page ----------
  {
    await clickChrome('.btn-pick'); await sleep(120)
    const a = await at('a'), b = await at('b')
    await p.keyboard.down('Shift')
    await p.mouse.click(a.x, a.y); await sleep(200)
    await p.mouse.click(b.x, b.y); await sleep(200)
    await p.keyboard.up('Shift')
    if ((await marks()).multi !== 2) fail(`O2: setup — expected 2 outlines, got ${(await marks()).multi}`)
    await p.keyboard.press('Escape'); await sleep(150)
    if (await clean('O2')) pass('O2 Shift multi-selection: Escape clears both outlines (clean page)')
  }

  // ---------- O3: lasso stroke, clean page ----------
  {
    await clickChrome('.btn-draw'); await sleep(120)
    await p.mouse.move(140, 140); await p.mouse.down()
    for (const [x, y] of [[300, 150], [320, 260], [160, 250], [140, 145]]) await p.mouse.move(x, y, { steps: 4 })
    await p.mouse.up(); await sleep(500)
    if (!(await marks()).stroke) fail('O3: setup — no lasso path drawn')
    await p.keyboard.press('Escape'); await sleep(150)
    if (await clean('O3')) pass('O3 lasso: Escape clears the stroke (clean page)')
  }

  // ---------- O4: the page swallows Escape at WINDOW capture ----------
  {
    await swallow('window')
    await clickChrome('.btn-pick'); await sleep(120)
    const a = await at('a'); await p.mouse.click(a.x, a.y); await sleep(300)
    if (!(await marks()).composer) fail('O4: setup — composer did not open')
    await p.keyboard.press('Escape'); await sleep(150)
    if (!await p.evaluate('window.__ate')) fail('O4: setup — the page never saw Escape')
    if (await clean('O4')) pass('O4 page eats Escape at window capture: marks still clear')
  }

  // ---------- O5: the page swallows Escape at DOCUMENT capture, registered first ----------
  {
    await swallow('document')
    await clickChrome('.btn-pick'); await sleep(120)
    const b = await at('b'); await p.mouse.click(b.x, b.y); await sleep(300)
    if (!(await marks()).composer) fail('O5: setup — composer did not open')
    await p.keyboard.press('Escape'); await sleep(150)
    if (await clean('O5')) pass('O5 page eats Escape at document capture: marks still clear')
  }

  // ---------- O6: P/F ride the same listener — they must survive it too ----------
  {
    await swallow('window-all')
    await p.keyboard.press('p'); await sleep(150)
    if (!(await marks()).pickActive) fail('O6: P did not activate Pick while the page owns the keyboard')
    await p.keyboard.press('f'); await sleep(150)
    const m = await p.evaluate(`${sr}.querySelector('.btn-draw').classList.contains('active')`)
    if (!m) fail('O6: F did not switch to Freeform while the page owns the keyboard')
    await p.keyboard.press('Escape'); await sleep(150)
    if (await clean('O6')) pass('O6 P/F tool hotkeys still switch when the page owns the keyboard')
  }

  // ---------- O7: Nudge reads Escape, it never steals it ----------
  // Moving the listener to window capture must stay propagation-neutral for Esc:
  // an armed tool cancels AND the page's own dialog still closes on the same key.
  // (With the composer FOCUSED it's the other way round by design — the textarea
  // stops the key at target phase, because that keystroke was aimed at Nudge.)
  {
    await swallow('none')
    await p.evaluate(`window.__ate=0; window.addEventListener('keydown', e => { if (e.key === 'Escape') window.__ate++ })`)
    await clickChrome('.btn-pick'); await sleep(150)
    if (!(await marks()).pickActive) fail('O7: setup — Pick did not arm')
    await p.keyboard.press('Escape'); await sleep(150)
    if (!await p.evaluate('window.__ate')) fail('O7: Nudge swallowed Escape — the page\'s own dialog would no longer close')
    else if (await clean('O7')) pass('O7 Escape disarms the tool AND still reaches the page')
  }

  console.log(failed ? `\nSuite O — Escape clears marks: ${failed} FAILED` : '\nSuite O — Escape clears marks: ALL PASS')
} finally {
  try { await ctx?.close() } catch { /* already gone */ }
  cleanup()
}
process.exit(failed ? 1 : 0)
