// Suite K — Origin routing (parallel localhosts → per-agent). Gerald opens many
// worktrees, each with its own dev server (localhost:5185, :5186, …); a nudge on
// a given localhost must reach the AGENT working on THAT worktree, not a single
// global owner. Proves: per-host ownership + stamping, per-client snapshot, the
// reassign-is-immutable rule, and — the payoff — REAL watchers each wake ONLY for
// their own host's nudges. Side port 4783, /tmp store, no browser.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const WATCHER = path.join(HERE, '../bridge/watch-nudges.mjs')
const STORE = '/tmp/nudge-origin-store'
const PORT = 4783
const B = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

fs.rmSync(STORE, { recursive: true, force: true })
const bridge = spawn('node', [BRIDGE], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
const kids = []
const cleanup = () => { try { bridge.kill() } catch {} ; for (const k of kids) { try { k.kill() } catch {} } }
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
if (!await up()) fail('bridge did not start')

const hb = (l, p, s, se) => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: l, pid: p, since: s, session: se }) }).catch(() => {})
const assign = (o) => fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json())
const mk = (url) => fetch(`${B}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 't', url, target: { selector: '#x' } }) }).then(r => r.json())
const ownerOf = async (id) => ((await (await fetch(`${B}/comments`)).json()).find(p => p.id === id))?.owner

try {
  // two agents, each keeps heartbeating (simulating two armed sessions)
  const beatA = setInterval(() => hb('Agent-A', 101, 1000, 'sessA'), 1000)
  const beatB = setInterval(() => hb('Agent-B', 202, 2000, 'sessB'), 1000)
  await hb('Agent-A', 101, 1000, 'sessA'); await hb('Agent-B', 202, 2000, 'sessB'); await sleep(300)

  // ---------- K1: per-host routing — a nudge routes to its localhost's agent ----------
  {
    await assign({ session: 'sessA', host: 'localhost:5185' })
    await assign({ session: 'sessB', host: 'localhost:5186' }); await sleep(150)
    const n85 = await mk('http://localhost:5185/foo')
    const n86 = await mk('http://localhost:5186/bar')
    const n99 = await mk('http://localhost:9999/baz') // un-assigned -> newest fallback (B)
    if (await ownerOf(n85.id) !== 'Agent-A') fail(`5185 -> ${await ownerOf(n85.id)} (want Agent-A)`)
    if (await ownerOf(n86.id) !== 'Agent-B') fail(`5186 -> ${await ownerOf(n86.id)} (want Agent-B)`)
    if (await ownerOf(n99.id) !== 'Agent-B') fail(`unassigned -> ${await ownerOf(n99.id)} (want newest Agent-B)`)
    pass('K1 per-host routing (5185→A, 5186→B, unassigned→newest fallback)')
  }

  // ---------- K2: per-client snapshot — each tab sees ITS host's owner ----------
  {
    const seen = (url) => new Promise((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); let last = null
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', url })))
      ws.on('message', m => { const j = JSON.parse(m); if (j.type === 'pins') last = j.agentLabel })
      setTimeout(() => { ws.close(); res(last) }, 500)
    })
    const [a, b] = await Promise.all([seen('http://localhost:5185/x'), seen('http://localhost:5186/x')])
    if (a !== 'Agent-A' || b !== 'Agent-B') fail(`snapshot owners: 5185=${a} 5186=${b}`)
    pass('K2 per-client snapshot (5185 tab sees Agent-A, 5186 tab sees Agent-B)')
  }

  // ---------- K3: reassign is immutable for existing nudges ----------
  {
    const existing = (await (await fetch(`${B}/comments`)).json()).find(p => p.owner === 'Agent-A' && p.url.includes('5185'))
    await assign({ session: 'sessB', host: 'localhost:5185' }); await sleep(150)
    if (await ownerOf(existing.id) !== 'Agent-A') fail(`reassign relabeled an existing nudge: ${await ownerOf(existing.id)}`)
    const fresh = await mk('http://localhost:5185/new')
    if (await ownerOf(fresh.id) !== 'Agent-B') fail(`new 5185 nudge should be Agent-B, got ${await ownerOf(fresh.id)}`)
    await assign({ session: 'sessA', host: 'localhost:5185' }); await sleep(150) // put it back for K4
    pass('K3 reassign immutable for existing nudges, applies to new ones')
  }

  // ---------- K5: /.identity routes — the who-owns-what map behind the arm report ----------
  {
    await assign({ session: 'sessA', host: 'localhost:5185' }); await sleep(150)
    // two "tabs" register their hosts so routes has entries
    const openTab = (url) => new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}`); kids.push({ kill: () => { try { w.close() } catch {} } }); w.on('open', () => { w.send(JSON.stringify({ type: 'hello', url })); setTimeout(res, 150) }) })
    await openTab('http://localhost:5185/estimate/')
    await openTab('http://127.0.0.1:5185/estimate/') // SAME server, other spelling — must merge, not fork
    await openTab('http://localhost:5188/other') // never assigned → fallback to newest (sessB, since 2000)
    await sleep(300)
    const id = await (await fetch(`${B}/.identity`)).json()
    const r85s = (id.routes || []).filter(r => r.host === 'localhost:5185')
    const r85 = r85s[0]
    const r88 = (id.routes || []).find(r => r.host === 'localhost:5188')
    if (r85s.length !== 1 || (id.routes || []).some(r => r.host.startsWith('127.'))) fail(`K5: 127.0.0.1 must normalize into localhost (one route), got ${JSON.stringify(id.routes)}`)
    if (r85?.owner?.session !== 'sessA' || r85.viaFallback) fail(`K5: 5185 should be sessA explicit, got ${JSON.stringify(r85)}`)
    if (r88?.owner?.session !== 'sessB' || !r88.viaFallback) fail(`K5: 5188 should be sessB via newest-wins fallback, got ${JSON.stringify(r88)}`)
    pass('K5 /.identity routes maps each open localhost to its owner + flags fallback; 127.0.0.1 folds into localhost')
  }

  // ---------- K6: viaFallback tells the truth when the picked agent DIES ----------
  // sessA is the explicit pick for 5185. Stop its heartbeat: after the 12 s fresh
  // window ownerForHost falls back to newest (sessB) — the flag must say fallback
  // IMMEDIATELY, not only after the 5 s sweep clears the stale pick (a has(h)
  // check lied in that window).
  {
    clearInterval(beatA)
    await sleep(13_500) // sessA leaves the fresh window (12 s)
    const id = await (await fetch(`${B}/.identity`)).json()
    const r85 = (id.routes || []).find(r => r.host === 'localhost:5185')
    if (r85?.owner?.session !== 'sessB') fail(`K6: 5185 should fall back to sessB after sessA died, got ${JSON.stringify(r85)}`)
    if (!r85.viaFallback) fail('K6: viaFallback must be true the moment the picked agent is no longer fresh')
    pass('K6 a dead pick reports viaFallback immediately (flag derived from actual resolution, not pick history)')
  }

  clearInterval(beatA); clearInterval(beatB)

  // ---------- K4: REAL watchers each wake ONLY for their own host's nudges ----------
  {
    fs.rmSync(STORE, { recursive: true, force: true }); bridge.kill(); await sleep(200)
    const b2 = spawn('node', [BRIDGE], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
    kids.push(b2)
    if (!await up()) fail('K4: bridge restart failed')
    // two REAL watcher processes, distinct sessions; capture their stdout
    const outA = [], outB = []
    const wA = spawn('node', [WATCHER], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'Agent-A', CLAUDE_CODE_SESSION_ID: 'sessAxxx' }, stdio: ['ignore', 'pipe', 'ignore'] })
    const wB = spawn('node', [WATCHER], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'Agent-B', CLAUDE_CODE_SESSION_ID: 'sessBxxx' }, stdio: ['ignore', 'pipe', 'ignore'] })
    kids.push(wA, wB)
    wA.stdout.on('data', c => outA.push(c.toString()))
    wB.stdout.on('data', c => outB.push(c.toString()))
    await sleep(1500) // watchers connect + heartbeat (session 'sessAxxx' / 'sessBxxx')
    await assign({ session: 'sessAxxx', host: 'localhost:5185' })
    await assign({ session: 'sessBxxx', host: 'localhost:5186' }); await sleep(400)
    const nA = await mk('http://localhost:5185/only-A')
    const nB = await mk('http://localhost:5186/only-B')
    await sleep(1500) // let the wakes propagate (WS push + scan)
    const aStr = outA.join(''), bStr = outB.join('')
    if (!aStr.includes(nA.id)) fail(`K4: Agent-A watcher did NOT wake for its own ${nA.id}`)
    if (aStr.includes(nB.id)) fail(`K4: Agent-A watcher wrongly woke for Agent-B's ${nB.id}`)
    if (!bStr.includes(nB.id)) fail(`K4: Agent-B watcher did NOT wake for its own ${nB.id}`)
    if (bStr.includes(nA.id)) fail(`K4: Agent-B watcher wrongly woke for Agent-A's ${nA.id}`)
    pass('K4 real watchers wake ONLY for their own host (A←5185, B←5186, no cross-wake)')
  }

  console.log('\nSuite K — Origin routing: ALL PASS (parallel localhosts route to their own agents)')
} finally {
  cleanup()
}
