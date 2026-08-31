// Suite X — Withdrawal (queue-popover ×). Gerald pulls back a nudge the agent is
// ALREADY working on. Before 2026-07-29 the × was a pure store delete: the row
// vanished, the agent was never told and kept going, finding out only via a 404
// on resolve — after the work was done. This suite pins the whole chain:
// delivery is real (X1), the withdrawal reaches the OWNING agent and only it
// (X2/X3), the caller learns who was told (X4), the trace is durable but carries
// no prompt text (X5), the list clears (X6), the file fallback works without WS
// (X7), an undelivered nudge makes no noise (X8), the pull path surfaces it on
// the next prompt (X9), and the real extension row + toast behave (X12).
// Own bridge on side port 4791, own store — the live bridge on 4700 stays untouched.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/wrapper.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const STORE = '/tmp/nudge-cancel-store'
const PORT = 4791, PAGE = 5191, PAGE_B = 5192
fs.rmSync(STORE, { recursive: true, force: true })
const B = `http://localhost:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><h1 id="t">Cancel suite</h1>') }).listen(PAGE)
const pageSrvB = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><h1 id="t">Cancel suite B</h1>') }).listen(PAGE_B)
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 40; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch { } } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const procs = [bridge]
let ctx = null
const cleanup = () => { for (const p of procs) { try { p.kill() } catch { } } try { pageSrv.close() } catch { } try { pageSrvB.close() } catch { } try { tab.close() } catch { } try { ctx?.close() } catch { } }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

// a REAL watcher — the Agent wake channel, armed through the neutral identity
function watcher(label, session, extra = {}) {
  const w = spawn('node', [path.join(HERE, '../bridge/watch-nudges.mjs')], {
    env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: label, NUDGE_AGENT_ID: session, NUDGE_WAKE: 'push', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  w.lines = []
  w.stdout.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) w.lines.push(l.trim()) })
  w.stderr.on('data', d => { const s = String(d).trim(); if (s && !s.includes('verweigert')) console.error(`  [${label}]`, s) })
  procs.push(w)
  return w
}
const post = (p, body) => fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
const addNudge = (text, port = PAGE) => post('/comments', { text, url: `http://localhost:${port}/`, target: { selector: '#t' } }).then(r => r.json()).then(j => j.id)
const del = (id) => fetch(`${B}/comments/${id}`, { method: 'DELETE' })
const readStore = () => { try { return JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')) } catch { return { pins: [] } } }
const marker = (id) => path.join(STORE, 'inbox', `${id}.withdrawn.md`)
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(120) } fail(`timeout waiting for ${what}`) }
const stopLine = (w, id) => w.lines.find(l => l.includes(id) && l.includes('ZURÜCKGEZOGEN'))

// a WS client standing in for an open tab — records every snapshot pushed
const tab = new WebSocket(`ws://127.0.0.1:${PORT}`)
const frames = []
tab.on('open', () => tab.send(JSON.stringify({ type: 'hello', url: `http://localhost:${PAGE}/` })))
tab.on('message', m => { try { frames.push(JSON.parse(m)) } catch { } })
const listedOpen = () => { const last = [...frames].reverse().find(f => f.type === 'pins'); return (last?.pins || []).filter(p => p.status === 'open').map(p => p.id) }

try {
  const A = watcher('Agent A', 'sessAAAA')
  await until(async () => (await (await fetch(`${B}/.identity`)).json()).agentLive, 8000, 'watcher A live')
  await sleep(500) // first pass seeds silently

  // ---------- X1: delivery is real — the premise of the whole suite ----------
  {
    const id = await addNudge('Das braucht mehr Abstand.')
    await until(() => A.lines.some(l => l.includes(id) && l.includes('Neuer Pin')), 4000, 'wake line for a new nudge')
    pass('X1 a new nudge reaches the agent in ms — a × is therefore a cancel of RUNNING work, not a tidy-up')

    // ---------- X2: × tells that agent to stop ----------
    const r = await del(id)
    if (r.status !== 200) fail(`X2: DELETE returned ${r.status}`)
    await until(() => stopLine(A, id), 4000, 'ZURÜCKGEZOGEN line on the agent channel')
    const line = stopLine(A, id)
    if (!/einstellen|stoppen/i.test(line)) fail(`X2: stop line is not actionable: ${line}`)
    if (!line.includes('nicht resolven')) fail(`X2: stop line must forbid resolving: ${line}`)
    pass('X2 × reaches the working agent — actionable stop line, not just a vanished row')

    // ---------- X4: the caller learns WHO was told (honest toolbar toast) ----------
    const body = await r.json()
    if (body.notified !== true || body.agent !== 'Agent A') fail(`X4: DELETE must report the notified agent, got ${JSON.stringify(body)}`)
    if (body.wake !== 'push') fail(`X4: DELETE must report the wake mode, got ${JSON.stringify(body)}`)
    pass('X4 DELETE answers who was notified + how they wake — the toolbar can stop guessing')

    // ---------- X5: durable trace, no prompt text ----------
    if (!fs.existsSync(marker(id))) fail('X5: no withdrawal marker written')
    const md = fs.readFileSync(marker(id), 'utf8')
    if (md.includes('Das braucht mehr Abstand')) fail('X5: marker leaks the discarded prompt text — a discard must not linger')
    if (!md.includes('zurückgezogen') || !md.includes(id)) fail(`X5: marker not identifiable:\n${md}`)
    if (fs.existsSync(path.join(STORE, 'inbox', `${id}.md`))) fail('X5: the original inbox mirror must be gone')
    pass('X5 durable trace left behind (id, time, route) — prompt text deliberately gone')

    // ---------- X6: it clears the list ----------
    if (readStore().pins.some(p => p.id === id)) fail('X6: still in the store')
    await until(() => !listedOpen().includes(id), 3000, 'nudge gone from the pushed snapshot')
    pass('X6 gone from store, inbox and the tab snapshot — the row disappears')

    // ---------- X10: resolving a withdrawn nudge stays impossible ----------
    const res = await post(`/comments/${id}/resolve`)
    if (res.status !== 404) fail(`X10: resolve of a withdrawn nudge should 404, got ${res.status}`)
    pass('X10 a withdrawn nudge cannot be resolved (404) — no phantom completion')
  }

  // ---------- X3: routed to the OWNING agent only ----------
  {
    const Bw = watcher('Agent B', 'sessBBBB')
    await until(async () => (await (await fetch(`${B}/.identity`)).json()).agents.length >= 2, 8000, 'both watchers in the roster')
    await sleep(500)
    // A owns :5191, B owns :5192 — parallel dev servers, the real reason routing exists
    await post('/agent/owner', { session: 'sessAAAA', host: `localhost:${PAGE}` })
    await post('/agent/owner', { session: 'sessBBBB', host: `localhost:${PAGE_B}` })
    await sleep(300)
    const mine = await addNudge('Gehört A.', PAGE)
    await until(() => A.lines.some(l => l.includes(mine) && l.includes('Neuer Pin')), 4000, "A's wake line")
    const beforeB = Bw.lines.length
    await del(mine)
    await until(() => stopLine(A, mine), 4000, "A's stop line")
    await sleep(700) // give a wrong delivery every chance to show up
    if (Bw.lines.slice(beforeB).some(l => l.includes(mine))) fail(`X3: agent B was told about A's nudge: ${JSON.stringify(Bw.lines.slice(beforeB))}`)
    pass("X3 the withdrawal goes to the owning agent only — B never hears about A's nudge")
    try { Bw.kill() } catch { }
  }

  // ---------- X8: a nudge the agent never got makes no noise ----------
  {
    const id = await addNudge('Sofort wieder weg.', PAGE_B) // B's host, and B is dead now
    const before = A.lines.length
    await del(id)
    await sleep(900)
    if (A.lines.slice(before).some(l => l.includes(id))) fail(`X8: stop line for a nudge A never received: ${JSON.stringify(A.lines.slice(before))}`)
    if (!fs.existsSync(marker(id))) fail('X8: marker should still exist for the record')
    pass('X8 a nudge that never reached this agent produces no stop line — nothing to cancel, no noise')
  }

  // ---------- X11: discarding a RESOLVED nudge is housekeeping, not a withdrawal ----------
  {
    const id = await addNudge('Schon erledigt.')
    await until(() => A.lines.some(l => l.includes(id) && l.includes('Neuer Pin')), 4000, 'wake line')
    await post(`/comments/${id}/resolve`)
    await sleep(300)
    const before = A.lines.length
    const r = await del(id)
    await sleep(700)
    if (fs.existsSync(marker(id))) fail('X11: a resolved nudge must not leave a withdrawal marker')
    if (A.lines.slice(before).some(l => l.includes('ZURÜCKGEZOGEN'))) fail('X11: no stop line for work that was already done')
    if ((await r.json()).notified !== false) fail('X11: DELETE of a resolved nudge must not claim a notification')
    pass('X11 discarding a DONE nudge is housekeeping — no stop line, no marker, no false claim')
  }

  // ---------- X9: the pull path (CLI) learns it on the next prompt ----------
  {
    const id = await addNudge('Pull-Pfad.')
    await until(() => A.lines.some(l => l.includes(id)), 4000, 'wake line')
    await del(id)
    await sleep(400)
    const hook = spawn('node', [path.join(HERE, '../agent/nudge-context.mjs')], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_ID: 'sessAAAA' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    hook.stdin.end(JSON.stringify({ prompt: 'weiter bitte' }))
    let out = ''
    hook.stdout.on('data', d => { out += d })
    await new Promise(r => hook.on('close', r))
    const ctxText = JSON.parse(out || '{}').hookSpecificOutput?.additionalContext || ''
    if (!ctxText.includes('ZURÜCKGEZOGEN') || !ctxText.includes(id)) fail(`X9: withdrawal not surfaced to a pull session:\n${ctxText}`)
    pass('X9 a CLI session sees the withdrawal in its next prompt context — as close to a stop as pull can get')

    // and naming the number afterwards answers precisely, not "nie existiert"
    const hook2 = spawn('node', [path.join(HERE, '../agent/nudge-context.mjs')], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_ID: 'sessAAAA' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    hook2.stdin.end(JSON.stringify({ prompt: `was ist mit ${id} passiert?` }))
    let out2 = ''
    hook2.stdout.on('data', d => { out2 += d })
    await new Promise(r => hook2.on('close', r))
    const ctx2 = JSON.parse(out2 || '{}').hookSpecificOutput?.additionalContext || ''
    if (!/ZURÜCKGEZOGEN/.test(ctx2)) fail(`X9b: a named withdrawn nudge must answer "zurückgezogen", not "nie existiert":\n${ctx2}`)
    pass('X9b naming a withdrawn nudge answers „zurückgezogen", not „nie existiert" — the ambiguity is gone')
  }

  // ---------- X7: file fallback — no WS, still told ----------
  {
    const C = watcher('Agent C', 'sessCCCC', { NUDGE_NO_WS: '1' })
    await until(async () => (await (await fetch(`${B}/.identity`)).json()).agents.some(a => a.session === 'sessCCCC'), 8000, 'watcher C live')
    await post('/agent/owner', { session: 'sessCCCC', host: `localhost:${PAGE}` })
    await sleep(500)
    const id = await addNudge('Ohne WS.')
    await until(() => C.lines.some(l => l.includes(id) && l.includes('Neuer Pin')), 8000, "C's wake line (poll path)")
    await del(id)
    await until(() => stopLine(C, id), 9000, "C's stop line from the marker file")
    pass('X7 file fallback carries the withdrawal too — a WS-less / restarted watcher still stops')
    try { C.kill() } catch { }
    // restore A as the owner for the browser leg
    await post('/agent/owner', { session: 'sessAAAA', host: `localhost:${PORT}` })
  }

  // ---------- X12: the real extension — row disappears, toast is honest ----------
  {
    ctx = await chromium.launchPersistentContext('', {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    })
    let sw = ctx.serviceWorkers()[0]
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 })
    await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), PORT)
    const page = ctx.pages()[0] || await ctx.newPage()
    await page.goto(`${B}/demo`)
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })

    // TWO nudges, withdraw ONE: the popover stays open, so this asserts the row
    // really leaves the LIST — not just that the popover closed because the page
    // ran out of open nudges (which is what a single-nudge check would prove)
    const keep = (await (await post('/comments', { text: 'Der bleibt.', url: `${B}/demo`, target: { selector: 'h1' } })).json()).id
    const id = (await (await post('/comments', { text: 'Weg damit.', url: `${B}/demo`, target: { selector: 'h1' } })).json()).id
    await until(() => A.lines.some(l => l.includes(id) && l.includes('Neuer Pin')), 5000, 'wake line for the browser nudge')
    await page.locator('.pill .count').click()
    const row = page.locator('.q-row', { hasText: id })
    await row.waitFor({ timeout: 5000 })
    await row.locator('.q-x').click()

    await until(async () => !(await page.locator('.q-row', { hasText: id }).isVisible().catch(() => false)), 5000, 'row to leave the open list')
    if (!await page.locator('.q-row', { hasText: keep }).isVisible()) fail('X12: withdrawing one nudge must not disturb the others')
    if ((await page.locator('.pill .count').textContent()) !== '1') fail('X12: badge count did not follow the withdrawal')
    const toast = (await page.locator('.feed .item .feed-text').last().textContent()) || ''
    if (!/zurückgezogen/i.test(toast)) fail(`X12: toast must say the nudge was withdrawn, got „${toast}"`)
    if (!toast.includes('Agent A')) fail(`X12: toast must name the notified agent, got „${toast}"`)
    await until(() => stopLine(A, id), 5000, 'stop line from a REAL × click')
    pass('X12 real × click: row leaves the list, neighbours untouched, toast names the informed agent, agent stops')

    // and the last one out closes the popover — 0 open nudges, nothing to show.
    // Closed = the `on` class gone: the popover fades via opacity, which
    // Playwright still counts as "visible" (cost me a red run, 2026-07-29)
    await page.locator('.q-row', { hasText: keep }).locator('.q-x').click()
    await until(async () => await page.locator('.queue.on').count() === 0, 5000, 'popover to close on the last withdrawal')
    await until(async () => await page.locator('.pill .count.show').count() === 0, 3000, 'badge to clear')
    pass('X12b withdrawing the last nudge closes the popover and clears the badge')
  }

  console.log('\nSuite X green — the × is a withdrawal now, not a silent delete.')
} finally { cleanup() }
