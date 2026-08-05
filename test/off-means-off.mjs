// Suite Z — „Aus" bleibt aus, und das Icon lügt nicht.
// Zwei Anzeigen behaupten dasselbe: das Toolbar-Icon im Browser-Chrome und die
// Pill-Leiste in der Seite. Sie liefen auseinander (Gerald 2026-08-05: „wenn die
// Nudge App nicht aktiv ist oder wenn ich draufgeklickt habe, damit sie inaktiv
// ist, dann hätte ich gern, dass sich auch die Toolbar ausblendet. Momentan ist
// sie immer sichtbar"): der Toggle lebte nur im Tab, und Chrome warf den
// Icon-Zustand bei jeder SPA-Navigation weg. Diese Suite nagelt beides fest.
// Eigene Bridge auf Seitenport 4786, eigener Seitenserver 5201 — Geralds echtes
// Chrome auf 4700 bleibt unangetastet.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/nudge-offsuite-store'
const PORT = 4786, PAGE = 5201
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

// eine Seite, die wie Geralds estimate per History-Navigation die Route wechselt
const pageSrv = http.createServer((_, res) => {
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><h1 id="t">Off suite</h1><button id="route" onclick="history.pushState({},\'\',\'#/varianten\')">route</button>')
}).listen(PAGE)
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const cleanup = () => { try { bridge.kill() } catch {} try { pageSrv.close() } catch {} }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

const now = Date.now()
const hb = o => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) })
const A = { label: 'Off Suite :5201', pid: 786, session: 'offSuite', since: now - 60000, project: 'nudge', branch: 'main', host: 'Zed' }
const beat = setInterval(() => hb(A), 1000)
await hb(A); await sleep(200)
await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: A.pid, session: A.session, host: `localhost:${PAGE}` }) })
await sleep(300)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate(p => chrome.storage.local.set({ nudgePort: p }), PORT)

  // jede Zustandsmeldung mitzählen — daraus liest sich, ob das Icon nachgeführt wird
  await sw.evaluate(() => {
    globalThis.__states = []
    chrome.runtime.onMessage.addListener((m) => { if (m.type === 'nudge-state') globalThis.__states.push(m.active) })
  })
  const states = () => sw.evaluate(() => globalThis.__states)
  // der Klick aufs Toolbar-Icon, exakt wie sw.js ihn zustellt
  const clickIcon = () => sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ['http://localhost/*'] })
    const t = tabs.find(x => x.active) || tabs[0]
    await chrome.tabs.sendMessage(t.id, { type: 'nudge-toggle' })
  })
  const bar = (pg) => pg.evaluate(() => {
    const sr = document.getElementById('__roots-nudge-host')?.shadowRoot
    if (!sr) return 'no-host'
    return getComputedStyle(sr.querySelector('.pill')).display === 'none' ? 'hidden' : 'visible'
  })
  const open = async (url) => { const pg = await ctx.newPage(); await pg.goto(url, { waitUntil: 'domcontentloaded' }); return pg }

  const p1 = await open(`http://localhost:${PAGE}/`)
  await p1.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  await sleep(500)

  // ---------- Z1: der Toggle blendet die Leiste aus und meldet „inaktiv" ----------
  {
    if (await bar(p1) !== 'visible') fail('Z1: setup — the toolbar must be up before the toggle')
    await sw.evaluate(() => { globalThis.__states = [] })
    await clickIcon(); await sleep(400)
    if (await bar(p1) !== 'hidden') fail('Z1: clicking the icon must hide the toolbar')
    const seen = await states()
    if (!seen.length || seen.at(-1) !== false) fail(`Z1: the icon must be told „inaktiv", got ${JSON.stringify(seen)}`)
    pass('Z1 icon click hides the toolbar AND reports inactive — both displays agree')
  }

  // ---------- Z2: aus überlebt den Reload UND einen frischen Tab ----------
  // Der Kern des Berichts: abschalten, neuer Tab, Leiste war wieder da.
  {
    await p1.reload({ waitUntil: 'domcontentloaded' }); await sleep(1200)
    if (await bar(p1) !== 'hidden') fail('Z2: off must survive a reload of the same tab')
    const p2 = await open(`http://localhost:${PAGE}/`)
    await sleep(1500)
    if (await bar(p2) !== 'hidden') fail('Z2: off must survive into a NEW tab — this was the bug')
    // und über den Origin hinweg: 127.0.0.1 ist ein anderer localStorage
    const p3 = await open(`http://127.0.0.1:${PAGE}/`)
    await sleep(1500)
    if (await bar(p3) !== 'hidden') fail('Z2: off must hold on a second origin (127.0.0.1) too')
    await p2.close(); await p3.close()
    pass('Z2 off survives reload, a new tab, and a second localhost origin')
  }

  // ---------- Z3: ein Toggle schaltet ALLE offenen Tabs mit ----------
  {
    const p2 = await open(`http://localhost:${PAGE}/`)
    await sleep(1200)
    await p1.bringToFront(); await sleep(200)
    await clickIcon(); await sleep(600) // wieder an
    if (await bar(p1) !== 'visible') fail('Z3: toggling back on must show the toolbar in the clicked tab')
    if (await bar(p2) !== 'visible') fail('Z3: the OTHER open tab must follow live, without a reload')
    await clickIcon(); await sleep(600) // und wieder aus
    if (await bar(p1) !== 'hidden' || await bar(p2) !== 'hidden') fail('Z3: switching off must reach every open tab')
    await clickIcon(); await sleep(600) // an lassen für Z4
    await p2.close()
    pass('Z3 one toggle reaches every open tab live — no reload needed')
  }

  // ---------- Z4: das Icon überlebt die SPA-Navigation ----------
  // Chrome setzt Icon und Badge bei JEDER Navigation auf den grauen Default
  // zurück — auch bei history.pushState ohne Reload und ohne hashchange.
  {
    if (await bar(p1) !== 'visible') fail('Z4: setup — the toolbar must be up')
    await sw.evaluate(() => { globalThis.__states = [] })
    await p1.click('#route') // pushState: kein Reload, kein hashchange
    await sleep(900)
    const seen = await states()
    if (!seen.length) fail('Z4: a SPA route change must re-announce the state — the icon fell back to grey while the toolbar ran')
    if (seen.at(-1) !== true) fail(`Z4: the re-announcement must say active, got ${JSON.stringify(seen)}`)
    if (await bar(p1) !== 'visible') fail('Z4: the route change must not disturb the toolbar itself')
    pass('Z4 a pushState route change re-announces the state — the icon stays honest')
  }

  console.log('\nSuite Z — Off means off: ALL PASS')
} finally {
  clearInterval(beat)
  try { await ctx?.close() } catch {}
  cleanup()
}
