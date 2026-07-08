// Suite N — Amend (append-only follow-ups). Gerald sends a nudge, then realises
// he wants to add one more thought to the SAME nudge. Proves: an OPEN nudge takes
// appended follow-ups (original text immutable, order preserved, inbox mirror
// carries them); a RESOLVED nudge refuses (no zombie re-open); and — the payoff —
// a REAL watcher re-wakes on an amendment (not just on the first send). Plus the
// History "+ ergänzen" UI round-trips. Own bridge on side port 4788, own store.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/nudge-amend-store'
const PORT = 4788, PAGE = 5188
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><h1 id="t">Amend suite</h1>') }).listen(PAGE)
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const watchers = []
const cleanup = () => { try { bridge.kill() } catch {} try { pageSrv.close() } catch {} for (const w of watchers) { try { w.kill() } catch {} } }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

const post = (p, body) => fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const addNudge = async (text) => (await (await post('/comments', { text, url: `http://localhost:${PAGE}/`, target: { selector: '#t' } })).json()).id
const readStore = () => JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8'))
const inbox = (id) => fs.readFileSync(path.join(STORE, 'inbox', `${id}.md`), 'utf8')

try {
  // ---------- N1: an open nudge takes a follow-up; original immutable; inbox mirrors it ----------
  {
    const id = await addNudge('Die Karte braucht mehr Abstand.')
    const r = await post(`/comments/${id}/amend`, { text: 'und der Titel eine Nummer kleiner' })
    if (r.status !== 200) fail(`N1: amend returned ${r.status}`)
    const pin = readStore().pins.find(p => p.id === id)
    if (pin.text !== 'Die Karte braucht mehr Abstand.') fail('N1: original text was mutated')
    if (pin.amendments?.length !== 1 || pin.amendments[0].text !== 'und der Titel eine Nummer kleiner') fail(`N1: amendment not stored: ${JSON.stringify(pin.amendments)}`)
    if (!pin.amendments[0].at) fail('N1: amendment missing timestamp')
    const md = inbox(id)
    if (!md.includes('Die Karte braucht mehr Abstand.') || !md.includes('Nachtrag') || !md.includes('und der Titel eine Nummer kleiner')) fail(`N1: inbox mirror missing original+nachtrag:\n${md}`)
    pass('N1 open nudge takes a follow-up — original immutable, stored with timestamp, inbox mirror carries both')
  }

  // ---------- N2: order preserved over multiple follow-ups; empty is rejected ----------
  {
    const id = await addNudge('Erster Gedanke.')
    await post(`/comments/${id}/amend`, { text: 'zweiter' })
    await post(`/comments/${id}/amend`, { text: 'dritter' })
    const empty = await post(`/comments/${id}/amend`, { text: '   ' })
    if (empty.status !== 400) fail(`N2: empty amend should be 400, got ${empty.status}`)
    const pin = readStore().pins.find(p => p.id === id)
    if (pin.amendments.map(a => a.text).join(',') !== 'zweiter,dritter') fail(`N2: order/content wrong: ${JSON.stringify(pin.amendments)}`)
    pass('N2 multiple follow-ups accrue in order; an empty follow-up is rejected (400)')
  }

  // ---------- N3: a resolved nudge refuses amendment (no zombie re-open) ----------
  {
    const id = await addNudge('Schon fast fertig.')
    await post(`/comments/${id}/resolve`)
    const r = await post(`/comments/${id}/amend`, { text: 'zu spät' })
    if (r.status !== 409) fail(`N3: amend on resolved should be 409, got ${r.status}`)
    const pin = readStore().pins.find(p => p.id === id)
    if (pin.amendments) fail('N3: a resolved nudge must not gain amendments')
    if (pin.status !== 'resolved') fail('N3: the nudge must stay resolved (no re-open)')
    const missing = await post(`/comments/nudge_9999/amend`, { text: 'x' })
    if (missing.status !== 404) fail(`N3: amend on unknown id should be 404, got ${missing.status}`)
    pass('N3 a resolved nudge refuses a follow-up (409, no re-open); unknown id is 404')
  }

  // ---------- N4: a REAL watcher re-wakes on an amendment (the payoff) ----------
  {
    let out = ''
    const w = spawn('node', [path.join(HERE, '../bridge/watch-nudges.mjs')], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'Amend-Agent', CLAUDE_CODE_SESSION_ID: 'sessAmnd' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    watchers.push(w)
    w.stdout.on('data', d => { out += d.toString() })
    await sleep(1200) // let it arm + become owner (single watcher = owner via fallback), seed silently
    const id = await addNudge('Bitte den Banner breiter.')
    for (let i = 0; i < 30 && !out.includes(`Neuer Pin ${id}`); i++) await sleep(100)
    if (!out.includes(`Neuer Pin ${id}`)) fail(`N4: watcher did not wake on the fresh nudge:\n${out}`)
    await post(`/comments/${id}/amend`, { text: 'und mit mehr Präsenz' })
    for (let i = 0; i < 30 && !out.includes(`Nudge ${id} ergänzt`); i++) await sleep(100)
    if (!out.includes(`Nudge ${id} ergänzt: und mit mehr Präsenz`)) fail(`N4: watcher did not re-wake on the amendment:\n${out}`)
    pass('N4 a REAL watcher wakes on the fresh nudge AND re-wakes on the amendment (owning agent sees the follow-up)')
  }

  // ---------- N5: the History "+ ergänzen" UI round-trips ----------
  {
    const id = await addNudge('UI-Nudge zum Ergänzen.')
    const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
    await sw.evaluate(p => chrome.storage.local.set({ nudgePort: p }), PORT)
    const p = await ctx.newPage()
    await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
    await p.locator('.pill .status').waitFor({ timeout: 15000 }); await sleep(600)
    // open History, open the amend panel on the row, type + ⌘↩
    await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.pill .count').click())
    await p.locator('.queue.on').waitFor({ timeout: 3000 })
    await p.evaluate((nid) => { const r = document.getElementById('__roots-nudge-host').shadowRoot; const rows = [...r.querySelectorAll('.q-row')]; const row = rows.find(x => x.querySelector('.q-id')?.textContent === nid); row.querySelector('.q-add').click() }, id)
    await sleep(150)
    await p.evaluate(() => { const ta = document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.q-row.amending .q-amend-input'); ta.focus(); ta.value = 'noch ein Detail'; ta.dispatchEvent(new Event('input', { bubbles: true })) })
    // the subtle send button right of the input (the affordance Gerald asked for)
    await p.evaluate(() => document.getElementById('__roots-nudge-host').shadowRoot.querySelector('.q-row.amending .q-amend-send').click())
    for (let i = 0; i < 30; i++) { await sleep(100); const pin = readStore().pins.find(x => x.id === id); if (pin?.amendments?.length) break }
    const pin = readStore().pins.find(x => x.id === id)
    if (pin.amendments?.[0]?.text !== 'noch ein Detail') fail(`N5: UI amend did not reach the store: ${JSON.stringify(pin.amendments)}`)
    const badgeOf = (nid) => p.evaluate((n) => { const r = document.getElementById('__roots-nudge-host').shadowRoot; const row = [...r.querySelectorAll('.q-row')].find(x => x.querySelector('.q-id')?.textContent === n); return row?.querySelector('.q-amc')?.textContent || null }, nid)
    let badge = null
    for (let i = 0; i < 30; i++) { await sleep(100); badge = await badgeOf(id); if (badge === '+1') break } // poll the WS re-render (no fixed sleep)
    if (badge !== '+1') fail(`N5: the "+1" follow-up badge did not appear, got ${JSON.stringify(badge)}`)
    // and the follow-up TEXT must be readable in the expanded row (not just the badge)
    const shown = await p.evaluate((nid) => { const r = document.getElementById('__roots-nudge-host').shadowRoot; const row = [...r.querySelectorAll('.q-row')].find(x => x.querySelector('.q-id')?.textContent === nid); const items = [...row.querySelectorAll('.q-amend-item')]; return { open: row.classList.contains('open'), texts: items.map(i => i.textContent), visible: items.some(i => i.offsetParent !== null) } }, id)
    if (!shown.texts.includes('noch ein Detail') || !shown.visible) fail(`N5: the follow-up text is not readable under the row: ${JSON.stringify(shown)}`)
    pass('N5 History "+ ergänzen" round-trips: follow-up reaches the store, the "+1" badge shows, and its TEXT is readable under the expanded row')

    // ---------- N6: submit contract — Enter sends, Shift+Enter is a newline, field clears ----------
    // (N5 alone was green while the feature was UNUSABLE: it only tried the send
    // button. Assert every submit path a human reaches for, the negative, and the
    // post-submit state — a green happy-path can hide a dead-end input.)
    {
      const id2 = await addNudge('Zweiter UI-Nudge.')
      await sleep(300) // WS refresh brings the new row into the open History
      const openPanel = () => p.evaluate((nid) => { const r = document.getElementById('__roots-nudge-host').shadowRoot; const row = [...r.querySelectorAll('.q-row')].find(x => x.querySelector('.q-id')?.textContent === nid); row.querySelector('.q-add').click() }, id2)
      const amInput = '.q-row.amending .q-amend-input'
      await openPanel(); await sleep(150)
      await p.evaluate((s) => document.getElementById('__roots-nudge-host').shadowRoot.querySelector(s).focus(), amInput)
      await p.keyboard.type('erste Zeile')
      await p.keyboard.press('Shift+Enter') // must NOT submit — inserts a newline
      await sleep(250)
      let pin2 = readStore().pins.find(x => x.id === id2)
      if (pin2.amendments) fail('N6: Shift+Enter submitted — it must only insert a newline')
      const val = await p.evaluate((s) => document.getElementById('__roots-nudge-host').shadowRoot.querySelector(s)?.value, amInput)
      if (!val || !val.includes('\n')) fail(`N6: Shift+Enter did not insert a newline, value=${JSON.stringify(val)}`)
      await p.keyboard.type('zweite Zeile')
      await p.keyboard.press('Enter') // plain Enter sends
      for (let i = 0; i < 30; i++) { await sleep(100); if (readStore().pins.find(x => x.id === id2)?.amendments?.length) break }
      pin2 = readStore().pins.find(x => x.id === id2)
      if (pin2.amendments?.[0]?.text !== 'erste Zeile\nzweite Zeile') fail(`N6: Enter did not send the full follow-up, got ${JSON.stringify(pin2.amendments)}`)
      // poll for the WS re-render to close the panel (fixed sleeps flake here)
      const amendingNow = (nid) => p.evaluate((n) => { const r = document.getElementById('__roots-nudge-host').shadowRoot; const row = [...r.querySelectorAll('.q-row')].find(x => x.querySelector('.q-id')?.textContent === n); return row?.classList.contains('amending') || false }, nid)
      let stillAmending = true
      for (let i = 0; i < 30; i++) { await sleep(100); stillAmending = await amendingNow(id2); if (!stillAmending) break }
      if (stillAmending) fail('N6: the field did not clear/close after a successful send')
      // and NO amend input anywhere may still hold the just-sent text (the WS
      // re-render must not restore the field mid-send — 2026-07-07 race)
      const lingering = await p.evaluate((t) => [...document.getElementById('__roots-nudge-host').shadowRoot.querySelectorAll('.q-amend-input')].some(i => i.value.includes(t)), 'zweite Zeile')
      if (lingering) fail('N6: the sent follow-up text still lingers in an amend input after send')
      pass('N6 submit contract: Enter sends, Shift+Enter is a newline (not send), the field clears after a successful send')
    }
    await ctx.close()
  }

  console.log('\nSuite N — Amend: ALL PASS')
} finally {
  cleanup()
}
