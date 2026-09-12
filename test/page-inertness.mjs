// Suite M — Page inertness. Reaching for the Nudge toolbar must not dismiss the
// page's own UI. Models the roots RequestPopover dismiss (a full-screen backdrop
// that hides on any outside click) and proves the "moat": a near-miss click
// around the toolbar is absorbed (page state survives), while a genuine outside
// click farther away still dismisses (the moat is tight, it doesn't hijack the
// page), and clicking a Nudge widget never leaks to the page. Hermetic: own page
// server on 5192, no bridge needed (the pill renders offline).
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const PAGE = 5192
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HTML = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;height:200vh;font-family:sans-serif}
  .trigger{position:fixed;top:120px;left:120px;padding:12px 18px}
  .ap-overlay{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.3);pointer-events:none;opacity:0}
  .ap-overlay[aria-hidden=false]{pointer-events:auto;opacity:1}
  .ap{position:fixed;top:180px;left:120px;z-index:101;width:340px;height:200px;background:#fff;border:1px solid #ccc;padding:16px;opacity:0;pointer-events:none}
  .ap[aria-hidden=false]{opacity:1;pointer-events:auto}
</style></head><body>
  <button class="trigger" data-ap-trigger>Request analysis</button>
  <div class="ap-overlay" data-ap-overlay aria-hidden="true"></div>
  <div class="ap" data-ap aria-hidden="true"><h3>Request</h3><input id="apname" placeholder="Name"></div>
  <button class="sortanchor" style="position:fixed;top:120px;left:700px;padding:10px 16px">Last modified ▾</button>
  <div class="sortmenu" hidden style="position:fixed;top:160px;left:700px;background:#fff;border:1px solid #ccc;padding:8px;min-width:160px"><button>Last modified</button><button>Title A–Z</button></div>
  <script>
    const overlay=document.querySelector('[data-ap-overlay]'),pop=document.querySelector('[data-ap]'),trig=document.querySelector('[data-ap-trigger]')
    function show(){overlay.setAttribute('aria-hidden','false');pop.setAttribute('aria-hidden','false');document.addEventListener('keydown',onKey)}
    function hide(){overlay.setAttribute('aria-hidden','true');pop.setAttribute('aria-hidden','true');document.removeEventListener('keydown',onKey)}
    window.__show=show
    function onKey(e){if(e.key==='Escape')hide()}
    trig.addEventListener('click',()=>pop.getAttribute('aria-hidden')==='false'?hide():show())
    overlay.addEventListener('click',hide)
    // dropdown that dismisses exactly like @roots/ui actionMenu: document CAPTURE-phase pointerdown
    const sa=document.querySelector('.sortanchor'),sm=document.querySelector('.sortmenu')
    function sOut(e){const t=e.composedPath?e.composedPath()[0]:e.target;if(!sm.contains(t)&&!sa.contains(t))sClose()}
    function sClose(){sm.hidden=true;document.removeEventListener('pointerdown',sOut,true)}
    function sOpen(){sm.hidden=false;setTimeout(()=>document.addEventListener('pointerdown',sOut,true),0)}
    window.__menuOpen=()=>!sm.hidden
    sa.addEventListener('click',()=>sm.hidden?sOpen():sClose())
  <\/script>
</body></html>`

const srv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
const cleanup = () => { try { srv.close() } catch {} }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate(() => chrome.storage.local.set({ nudgePort: 4999 })) // dead port: pill shows, no bridge noise
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await p.locator('.pill').waitFor({ timeout: 15000 }); await sleep(400)
  // move the pill to a clear area (its default corner may overlap page chrome)
  { const g = await p.evaluate(() => { const r = document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.grip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }); await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(560, 480, { steps: 6 }); await p.mouse.up(); await sleep(150) }

  const open = () => p.evaluate(() => document.querySelector('[data-ap]').getAttribute('aria-hidden') === 'false')
  const reopen = async () => { await p.evaluate(() => window.__show()); await sleep(120) }
  const pillRect = () => p.evaluate(() => { const r = document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.pill').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })

  // ---------- M1: near-miss around the toolbar is absorbed ----------
  {
    await reopen(); if (!await open()) fail('M1: setup — popover did not open')
    const pb = await pillRect()
    for (const [dx, dy] of [[pb.w + 8, pb.h / 2], [pb.w / 2, -8], [-8, pb.h / 2]]) {
      await reopen()
      await p.mouse.click(pb.x + dx, pb.y + dy); await sleep(150)
      if (!await open()) fail(`M1: a near-miss at offset (${Math.round(dx)},${Math.round(dy)}) dismissed the page modal`)
    }
    pass('M1 near-miss clicks around the toolbar are absorbed — the page modal survives')
  }

  // ---------- M2: a genuine outside click still dismisses (moat is tight) ----------
  {
    await reopen(); if (!await open()) fail('M2: setup')
    const pb = await pillRect()
    await p.mouse.click(pb.x - 250, pb.y + pb.h / 2); await sleep(150)
    if (await open()) fail('M2: a far outside click did NOT dismiss — the moat is hijacking the page')
    pass('M2 a genuine outside click (far from the toolbar) still dismisses the modal — moat stays tight')
  }

  // ---------- M3: clicking a Nudge widget never leaks to the page ----------
  {
    await reopen(); if (!await open()) fail('M3: setup')
    await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.btn-pick').click())
    await sleep(150)
    if (!await open()) fail('M3: clicking the Pick widget dismissed the page modal')
    // reset pick mode so the run ends clean
    await p.keyboard.press('Escape')
    pass('M3 clicking a Nudge widget (Pick) does not touch the page modal')
  }

  // ---------- M4: a document-capture-pointerdown dropdown survives a widget click ----------
  {
    const menuOpen = () => p.evaluate(() => window.__menuOpen())
    const pickActive = () => p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.btn-pick').classList.contains('active'))
    await p.locator('.sortanchor').click(); await sleep(150)
    if (!await menuOpen()) fail('M4: setup — dropdown did not open')
    const bp = await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.btn-pick').getBoundingClientRect())
    await p.mouse.click(bp.x + bp.width / 2, bp.y + bp.height / 2); await sleep(200)
    if (!await menuOpen()) fail('M4: clicking Nudge Pick closed the dropdown (page capture-phase outside-click leaked)')
    if (!await pickActive()) fail('M4: Pick did not activate — the widget click was swallowed too')
    await p.keyboard.press('Escape'); await sleep(80)
    pass('M4 a document capture-phase pointerdown dropdown (à la @roots/ui) stays open when reaching for the toolbar, and Pick still activates')
  }

  // ---------- M5: swallowing the widget pointerdown didn't break our own controls ----------
  {
    // pick an element → composer opens → type; then drag the grip
    await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.btn-pick').click()); await sleep(120)
    const a = await p.evaluate(() => { const r = document.querySelector('.trigger').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await p.mouse.click(a.x, a.y); await sleep(300)
    await p.keyboard.type('make this green')
    const typed = await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.composer textarea').value)
    if (typed !== 'make this green') fail(`M5: composer textarea broken, got "${typed}"`)
    await p.keyboard.press('Escape'); await sleep(80)
    const before = await pillRect()
    const g = await p.evaluate(() => { const r = document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.grip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(720, 300, { steps: 6 }); await p.mouse.up(); await sleep(150)
    const after = await pillRect()
    if (Math.abs(after.x - before.x) < 50) fail('M5: grip drag broken by the pointerdown swallow')
    pass('M5 the pointerdown swallow left our own controls intact (composer typing + grip drag)')
  }

  console.log('\nSuite M — Page inertness: ALL PASS')
} finally {
  try { await ctx?.close() } catch {}
  cleanup()
}
