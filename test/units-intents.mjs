// Suite U — Declared send. A page that renders its own choice among its own
// things (variants, records) marks them as UNITS (data-nudge-unit + id + label,
// data-nudge-unit-selected for the chosen ones) and marks a send control
// (data-nudge-send="<intent>"); Nudge only carries the choice to the agent.
// The fixture imitates the sandbox variant bar: round tabs that RE-RENDER the
// rows, a selection that spans rounds and is listed in a footer, a text field,
// one row marked as the variant on screen, presses shielded at window capture
// and clicks stopped at the bar's root, as the real bar does. Proves: a
// trusted click sends the selected units with the intent, the text and the
// page context, and reports back on the button; a script's click sends
// nothing; an empty choice sends nothing; Nudge switched off sends nothing and
// withdraws its ready mark; an element nudge on the result names the unit on
// screen; a quiet page keeps Nudge's toolbar out of sight while the send works
// and the toolbar icon only shows or hides it there; the page hears what became
// of its nudges (waiting, done) and can pull an open one back. Own bridge on
// side port 4796, page server 5197.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const STORE = '/tmp/nudge-units-store'
const PORT = 4796, PAGE = 5197
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HTML = `<!doctype html><html><head><meta charset=utf8><style>
  body{margin:0;font-family:sans-serif;display:flex}
  aside{width:340px;height:100vh;background:#1a1f26;color:#eee;padding:12px;box-sizing:border-box}
  .row{display:flex;gap:10px;padding:10px;margin:8px 0;border-radius:10px}
  .row[data-nudge-unit-selected]{outline:2px solid orange}
  .row a{color:inherit;text-decoration:none}
  main{padding:60px;flex:1}
</style></head><body>
<aside id="bar">
  <div class="tabs"><button id="r2" type="button">Runde 2</button><button id="r1" type="button">1</button></div>
  <div class="list"></div>
  <footer data-nudge-scope>
    <div class="chips"></div>
    <textarea id="say" data-nudge-text></textarea>
    <button id="go" type="button" data-nudge-send="round">Weiterentwickeln</button>
    <button id="final" type="button" data-nudge-send="final" data-nudge-send-label="Final">Final ✓</button>
  </footer>
  <button id="back" type="button">Ändern</button>
</aside>
<main data-nudge-unit="sandbox-variant" data-nudge-unit-id="sbx:demo/d" data-nudge-unit-label="D · Probierblatt · Runde 2" data-nudge-unit-current><h1 id="title">Formeln mit Beispielwerten</h1></main>
<script>
  const V = { 1: [['a', 'Landkarte'], ['b', 'Rechenfluss']], 2: [['c', 'Quellenregal'], ['d', 'Probierblatt'], ['e', 'Zitieren']] }
  const label = (k) => { for (const r in V) for (const [kk, n] of V[r]) if (kk === k) return k.toUpperCase() + ' · ' + n + ' · Runde ' + r }
  const chosen = new Set()
  const unit = (k) => 'data-nudge-unit="sandbox-variant" data-nudge-unit-id="sbx:demo/' + k + '" data-nudge-unit-label="' + label(k) + '"'
  const list = document.querySelector('.list'), chips = document.querySelector('.chips')
  let round = 2
  function paint() {
    list.innerHTML = V[round].map(([k, n]) => '<div class="row" id="row-' + k + '" ' + unit(k) + (k === 'd' ? ' data-nudge-unit-current' : '') + (chosen.has(k) ? ' data-nudge-unit-selected' : '')
      + '><button type="button" class="pick" id="pick-' + k + '">☐</button><a href="?variante=' + k + '" id="name-' + k + '">' + n + '</a></div>').join('')
    chips.innerHTML = [...chosen].map(k => '<span class="chip" ' + unit(k) + ' data-nudge-unit-selected>' + k.toUpperCase() + '</span>').join('')
  }
  const bar = document.getElementById('bar')
  for (const t of ['pointerdown', 'mousedown']) addEventListener(t, (e) => { if (bar.contains(e.target)) e.stopPropagation() }, true)
  bar.addEventListener('click', (e) => {
    const t = e.target
    if (t.id === 'r1' || t.id === 'r2') { round = Number(t.id.slice(1)); paint() }
    const p = t.closest('.pick'); if (p) { const k = p.id.slice(5); chosen.has(k) ? chosen.delete(k) : chosen.add(k); paint() }
  })
  for (const t of ['click', 'pointerdown', 'mousedown']) bar.addEventListener(t, (e) => e.stopPropagation())
  window.__events = []
  bar.addEventListener('groundworks-nudge:sent', (e) => window.__events.push(JSON.parse(e.detail)), true)
  window.__status = null; window.__withdrawn = []
  document.addEventListener('groundworks-nudge:status', (e) => { window.__status = JSON.parse(e.detail) })
  document.addEventListener('groundworks-nudge:withdrawn', (e) => window.__withdrawn.push(JSON.parse(e.detail)))
  paint()
</script></body></html>`

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
let ctx, sw
const cleanup = async () => { try { await ctx?.close() } catch {} try { bridge.kill() } catch {} try { pageSrv.close() } catch {} }
let failed = 0
const fail = (m) => { console.error('FAIL:', m); failed++ }
const pass = (m) => console.log('PASS', m)
const readPins = () => { try { return JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins } catch { return [] } }
async function nextPin(count) {
  for (let i = 0; i < 60; i++) { const pins = readPins(); if (pins.length >= count) return pins[count - 1]; await sleep(100) }
  return null
}

try {
  if (!await up()) throw new Error('bridge did not start')
  ctx = await chromium.launchPersistentContext('', { headless: process.env.NUDGE_HEADLESS === '1', channel: 'chromium', viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate(p => chrome.storage.local.set({ nudgePort: p }), PORT)
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await p.locator('.pill .status').waitFor({ timeout: 15000 }); await sleep(700)

  const sr = 'document.getElementById("__groundworks-nudge-host").shadowRoot'
  const q = (expr) => p.evaluate(expr)
  const center = (id) => q(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const click = async (id) => { const c = await center(id); await p.mouse.click(c.x, c.y); await sleep(250) }
  const events = () => q('window.__events')
  const waitEvent = async (n, state) => { for (let i = 0; i < 80; i++) { const ev = await events(); if (ev.length >= n && (!state || ev.at(-1).state !== 'sending')) return ev.at(-1); await sleep(100) } return null }
  const settledEvent = async (n) => { for (let i = 0; i < 80; i++) { const ev = (await events()).filter(x => x.state !== 'sending'); if (ev.length >= n) return ev.at(-1); await sleep(100) } return null }
  const ready = () => q('document.documentElement.hasAttribute("data-nudge-send-ready")')
  const toggle = () => sw.evaluate(async (port) => { const [t] = await chrome.tabs.query({ url: [`http://localhost:${port}/*`] }); await chrome.tabs.sendMessage(t.id, { type: 'nudge-toggle' }) }, PAGE)

  // ---------- U1: a trusted click sends the choice across rounds ----------
  {
    if (!await ready()) fail('U1: the page must see Nudge ready while it is on')
    await click('pick-c')
    await click('r1'); await click('pick-a')
    await click('say'); await p.keyboard.type('beide verbinden')
    await click('go')
    const ev = await settledEvent(1)
    const pin = await nextPin(1)
    const state = await q(`document.getElementById('go').getAttribute('data-nudge-state')`)
    if (!pin) fail('U1: no nudge stored')
    else if (pin.units?.map(u => u.id).join() !== 'sbx:demo/c,sbx:demo/a') fail(`U1: units ${JSON.stringify(pin.units)}`)
    else if (pin.units[0].label !== 'C · Quellenregal · Runde 2') fail(`U1: unit label ${pin.units[0].label}`)
    else if (pin.intent?.id !== 'round' || pin.intent?.label !== 'Weiterentwickeln') fail(`U1: intent ${JSON.stringify(pin.intent)}`)
    else if (pin.text !== 'beide verbinden') fail(`U1: text "${pin.text}"`)
    else if (pin.context?.map(u => u.id).join() !== 'sbx:demo/d') fail(`U1: context ${JSON.stringify(pin.context)}`)
    else if (!ev || ev.id !== pin.id || !['sent', 'queued'].includes(ev.state) || ev.state !== state) fail(`U1: page report ${JSON.stringify(ev)} / ${state}`)
    else pass('U1 a trusted click sends the units chosen across rounds, the intent, the text and the unit on screen, and reports back')
    const md = fs.readdirSync(path.join(STORE, 'inbox')).map(f => fs.readFileSync(path.join(STORE, 'inbox', f), 'utf8')).join('\n')
    if (!md.includes('`round` — Weiterentwickeln') || !md.includes('`sbx:demo/a` — A · Landkarte · Runde 1')) fail('U1: inbox mirror must name intent and units')
  }

  // ---------- U2: the label attribute names the intent; a page script's click sends nothing ----------
  {
    await click('final')
    await settledEvent(2)
    const pin = await nextPin(2)
    if (pin?.intent?.id !== 'final' || pin.intent.label !== 'Final') fail(`U2: intent ${JSON.stringify(pin?.intent)}`)
    await q(`document.getElementById('go').click()`); await sleep(1200)
    if (readPins().length !== 2) fail(`U2: a scripted click must not send, store has ${readPins().length}`)
    else pass('U2 data-nudge-send-label names the intent; a scripted click sends nothing')
  }

  // ---------- U3: an empty choice sends nothing ----------
  {
    await click('r2'); await click('pick-c'); await click('r1'); await click('pick-a')
    const before = (await events()).length
    await click('go'); await sleep(600)
    const ev = (await events()).slice(before).at(-1)
    if (readPins().length !== 2) fail('U3: nothing selected must send nothing')
    else if (ev?.state !== 'failed' || ev.reason !== 'nothing_selected') fail(`U3: report ${JSON.stringify(ev)}`)
    else pass('U3 an empty choice sends nothing and says why')
  }

  // ---------- U4: off means off for the declared send too ----------
  {
    await click('pick-b')
    await toggle(); await sleep(500)
    const off = await ready()
    await click('go'); await sleep(900)
    const n = readPins().length
    await toggle(); await sleep(500)
    if (off) fail('U4: the ready mark must go while Nudge is off')
    else if (n !== 2) fail('U4: a click while off must not send')
    else if (!await ready()) fail('U4: the ready mark must return when Nudge is on again')
    else pass('U4 switched off, Nudge neither sends nor claims to be ready')
  }

  // ---------- U5: an element nudge on the result names the unit on screen ----------
  {
    await p.keyboard.press('p'); await sleep(200)
    await click('title')
    await p.keyboard.type('tighter heading')
    await p.keyboard.press('Enter')
    const pin = await nextPin(3)
    if (pin?.units !== null || pin?.intent !== null) fail(`U5: an element nudge has no units/intent: ${JSON.stringify(pin && { units: pin.units, intent: pin.intent })}`)
    else if (pin?.context?.map(u => u.id).join() !== 'sbx:demo/d') fail(`U5: context ${JSON.stringify(pin?.context)}`)
    else pass('U5 an element nudge on the result carries the unit on screen as context')
  }

  // ---------- U6: the page hears what became of its nudges ----------
  {
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('groundworks-nudge:status-request'))); await sleep(300)
    const st = await q('window.__status')
    const mine = st?.nudges?.map(n => `${n.id}:${n.state}:${n.intent?.id}`).join()
    if (!st?.ready || st.agent !== null) fail(`U6: status header ${JSON.stringify(st && { ready: st.ready, agent: st.agent })}`)
    else if (mine !== 'nudge_1:waiting:round,nudge_2:waiting:final') fail(`U6: page nudges ${mine}`)
    else {
      await fetch(`${B}/comments/nudge_1/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      let done = ''
      for (let i = 0; i < 40 && !done.includes('nudge_1:done'); i++) { await sleep(100); done = ((await q('window.__status'))?.nudges || []).map(n => `${n.id}:${n.state}`).join() }
      if (!done.includes('nudge_1:done')) fail(`U6: a resolve must reach the page, got ${done}`)
      else pass('U6 the page hears its own nudges (no element nudges) and their state, waiting then done')
    }
  }

  // ---------- U7: a trusted click pulls an open nudge back; a scripted one does not ----------
  {
    await q(`document.getElementById('back').setAttribute('data-nudge-withdraw', 'nudge_2')`)
    await q(`document.getElementById('back').click()`); await sleep(700)
    const still = readPins().some(x => x.id === 'nudge_2')
    await click('back'); await sleep(900)
    const w = await q('window.__withdrawn')
    const gone = !readPins().some(x => x.id === 'nudge_2')
    await q(`document.getElementById('back').setAttribute('data-nudge-withdraw', 'nudge_1')`)
    await click('back'); await sleep(700)
    const w2 = (await q('window.__withdrawn')).at(-1)
    if (!still) fail('U7: a scripted click must not withdraw')
    else if (!gone || !w.some(x => x.id === 'nudge_2' && x.ok)) fail(`U7: withdrawal ${JSON.stringify(w)} gone=${gone}`)
    else if (w2?.ok !== false || w2.reason !== 'not_open') fail(`U7: a done nudge cannot be pulled back, got ${JSON.stringify(w2)}`)
    else pass('U7 a trusted click withdraws an open nudge and reports it; a scripted click and a done nudge do not')
  }

  // ---------- U8: a quiet page hides Nudge's toolbar; the icon shows it without switching off ----------
  {
    const pillShown = () => q(`getComputedStyle(${sr}.querySelector('.pill')).display !== 'none'`)
    await q(`document.documentElement.setAttribute('data-nudge-chrome', 'quiet')`); await sleep(300)
    const hidden = !await pillShown() && await ready()
    await toggle(); await sleep(400)
    const shown = await pillShown() && await ready()
    await toggle(); await sleep(400)
    const again = !await pillShown() && await ready()
    await click('go') // B is still chosen from U4
    const ev = await settledEvent(3)
    const feed = await q(`${sr}.querySelector('.feed')?.textContent || ''`)
    await p.keyboard.press('p'); await sleep(300)
    const byKey = await pillShown()
    await p.keyboard.press('Escape')
    await q(`document.documentElement.removeAttribute('data-nudge-chrome'); sessionStorage.removeItem('groundworks-nudge-shown')`)
    if (!hidden) fail('U8: a quiet page must hide the toolbar while Nudge stays ready')
    else if (!shown) fail('U8: the icon must show the toolbar on a quiet page, not switch Nudge off')
    else if (!again) fail('U8: the icon again must hide it, Nudge still on')
    else if (!ev || !['sent', 'queued'].includes(ev.state)) fail(`U8: the send must work on a quiet page, got ${JSON.stringify(ev)}`)
    else if (feed.includes(ev.id)) fail(`U8: a quiet page gets no Nudge toast, feed "${feed}"`)
    else if (!byKey) fail('U8: P must bring the toolbar up with its tool')
    else pass('U8 a quiet page keeps the toolbar and toasts out of sight, sends all the same, and the icon or P show it')
  }
} catch (e) {
  fail(e.stack || String(e))
} finally {
  await cleanup()
}
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('\nSuite U: all legs passed')
process.exit(0)
