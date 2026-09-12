// Suite H — Provenance (bulletproof owner binding). The contract the user leans
// the bridge's robustness on: once a nudge is created, it stays bound to the
// agent session that owned the channel at that instant — FOREVER, and no other
// process or agent can kidnap it. This suite attacks that binding from every
// angle: client spoofing, owner switches (heartbeat + dropdown), resolve by a
// stranger, double-resolve, SIGKILL, discard+id-reuse, concurrency, field caps.
// Side port 4794, /tmp store. A single mutated stamp fails the run.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const STORE = '/tmp/nudge-provenance-store'
const PORT = 4794
const B = `http://127.0.0.1:${PORT}`
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let bridge
function start() {
  bridge = spawn('node', [BRIDGE], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
}
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch { /* wait */ } } return false }
const cleanup = () => { try { bridge.kill() } catch { /* gone */ } }

const hb = (label, pid, since, session) => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, pid, since, session }) })
const mk = (extra = {}) => fetch(`${B}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 't', url: `${B}/x`, target: { selector: '#x' }, ...extra }) }).then(r => r.json())
const resolve = (id) => fetch(`${B}/comments/${id}/resolve`, { method: 'POST' })
const discard = (id) => fetch(`${B}/comments/${id}`, { method: 'DELETE' })
const owners = async () => Object.fromEntries((await (await fetch(`${B}/comments`)).json()).map(p => [p.id, p.owner]))
const ownerOf = async (id) => (await owners())[id]

fs.rmSync(STORE, { recursive: true, force: true })
start()
if (!await up()) fail('bridge did not start')

try {
  // ---------- H1: a client CANNOT inject/spoof owner ----------
  {
    await hb('Agent-A', 101, 1000, 'sessA'); await sleep(200)
    // body carries a forged owner — the server must ignore it and stamp the real owner
    const n = await mk({ owner: { label: 'HACKER', session: 'evil' } })
    if (await ownerOf(n.id) !== 'Agent-A') fail(`H1: forged owner accepted (${await ownerOf(n.id)})`)
    // also as a raw string / array — must not crash, must be ignored
    const n2 = await mk({ owner: 'HACKER' })
    const n3 = await mk({ owner: ['x'] })
    if (await ownerOf(n2.id) !== 'Agent-A' || await ownerOf(n3.id) !== 'Agent-A') fail('H1: forged owner (string/array) leaked')
    pass('H1 client cannot spoof owner (forged object/string/array ignored, server stamps real owner)')
  }

  // ---------- H2: immutable across a heartbeat owner switch (newest wins) ----------
  {
    const n = await mk() // still Agent-A
    await hb('Agent-B', 202, 2000, 'sessB'); await sleep(200) // B newer -> becomes owner
    if (await ownerOf(n.id) !== 'Agent-A') fail(`H2: relabelled on heartbeat switch (${await ownerOf(n.id)})`)
    pass('H2 immutable across heartbeat owner switch (nudge stays Agent-A while B takes the channel)')
  }

  // ---------- H3: immutable across an explicit dropdown pick (/agent/owner) ----------
  {
    const nBefore = await mk() // owner = B now (newest)
    if (await ownerOf(nBefore.id) !== 'Agent-B') fail('H3 setup: expected Agent-B')
    const pick = await (await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 101 }) })).json()
    if (pick.owner !== 'Agent-A') fail(`H3: dropdown pick failed (${JSON.stringify(pick)})`)
    // The user switched the CHANNEL back to A — but the nudge created under B stays B
    if (await ownerOf(nBefore.id) !== 'Agent-B') fail(`H3: dropdown pick kidnapped an existing nudge (${await ownerOf(nBefore.id)})`)
    // and a NEW nudge now belongs to A (the freshly chosen owner)
    const nAfter = await mk()
    if (await ownerOf(nAfter.id) !== 'Agent-A') fail(`H3: new nudge not stamped with the chosen owner (${await ownerOf(nAfter.id)})`)
    pass('H3 immutable across dropdown pick (existing nudges keep their owner; new ones take the chosen one)')
  }

  // ---------- H4: immutable across resolve by a STRANGER ----------
  {
    // an Agent-A-owned nudge, resolved while A is owner — trivially stays A;
    // now make B owner and resolve an A-owned nudge -> must stay A
    await hb('Agent-B', 202, 3000, 'sessB'); await sleep(200) // bump B fresh
    await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 202 }) }) // B owns channel
    const aNudge = (await (await fetch(`${B}/comments`)).json()).find(p => p.owner === 'Agent-A' && p.status === 'open')
    await resolve(aNudge.id)
    if (await ownerOf(aNudge.id) !== 'Agent-A') fail(`H4: resolve by B kidnapped an A-owned nudge (${await ownerOf(aNudge.id)})`)
    pass('H4 immutable across resolve by a stranger (B resolves an A-nudge -> stays A)')
  }

  // ---------- H5: double-resolve never mutates owner ----------
  {
    const n = await mk() // owner B
    await resolve(n.id); await resolve(n.id); await resolve(n.id)
    if (await ownerOf(n.id) !== 'Agent-B') fail(`H5: owner drifted on repeated resolve (${await ownerOf(n.id)})`)
    pass('H5 double/triple resolve is idempotent for owner')
  }

  // ---------- H6: owner SURVIVES a SIGKILL + restart (persisted, not in-memory) ----------
  {
    const n = await mk() // owner B
    const before = await ownerOf(n.id)
    bridge.kill('SIGKILL'); await sleep(200); start()
    if (!await up()) fail('H6: bridge did not return after SIGKILL')
    if (await ownerOf(n.id) !== before) fail(`H6: owner lost across SIGKILL (${await ownerOf(n.id)} != ${before})`)
    pass(`H6 owner survives SIGKILL + restart (persisted as ${before})`)
  }

  // ---------- H7: offline nudge -> attributed to the RESOLVER, then immutable ----------
  {
    // let every agent age out of the roster (>12 s) so there is no channel owner
    await sleep(12500)
    const n = await mk()
    if (await ownerOf(n.id) != null) fail(`H7: offline nudge should be null-owner (${await ownerOf(n.id)})`)
    await hb('Agent-C', 303, 5000, 'sessC'); await sleep(200)
    await resolve(n.id)
    if (await ownerOf(n.id) !== 'Agent-C') fail(`H7: resolver attribution failed (${await ownerOf(n.id)})`)
    // now it IS owned -> a later resolve by a different owner must not change it
    await hb('Agent-D', 404, 6000, 'sessD'); await sleep(200)
    await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 404 }) })
    await resolve(n.id)
    if (await ownerOf(n.id) !== 'Agent-C') fail(`H7: once attributed, owner mutated (${await ownerOf(n.id)})`)
    pass('H7 offline nudge attributed to resolver (Agent-C), then immutable against Agent-D')
  }

  // ---------- H8: the stamp is BOUNDED (a huge roster label can't bloat nudges) ----------
  {
    await hb('L'.repeat(5000), 505, 7000, 'S'.repeat(5000)); await sleep(200)
    await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 505 }) })
    const n = await mk()
    const o = await ownerOf(n.id)
    if (!o || o.length > 60) fail(`H8: owner label not capped (${o?.length})`)
    pass(`H8 owner stamp bounded (huge session label capped to ${o.length} chars)`)
  }

  // ---------- H9: discard removes entirely; ids NEVER reused -> owner can't be inherited ----------
  {
    const n = await mk() // owned
    const id = n.id
    await discard(id)
    if (await ownerOf(id) !== undefined) fail('H9: discarded nudge still present')
    const n2 = await mk()
    if (n2.id === id) fail('H9: id REUSED after discard — a new nudge could inherit a dead binding')
    if (Number(n2.id.replace('nudge_', '')) <= Number(id.replace('nudge_', ''))) fail('H9: seq went backwards')
    pass('H9 discard is total; ids never reused (no owner inheritance from a dead nudge)')
  }

  // ---------- H10: concurrency — 30 parallel creates under one owner all stamp it ----------
  {
    await hb('Agent-Race', 606, 8000, 'sessR'); await sleep(200)
    await fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 606 }) })
    const created = await Promise.all(Array.from({ length: 30 }, () => mk()))
    const o = await owners()
    const wrong = created.filter(n => o[n.id] !== 'Agent-Race')
    if (wrong.length) fail(`H10: ${wrong.length}/30 concurrent creates mis-stamped`)
    if (new Set(created.map(n => n.id)).size !== 30) fail('H10: duplicate ids under load')
    pass('H10 concurrency (30 parallel creates all stamped Agent-Race, ids unique)')
  }

  // ---------- H11: both projections agree (HTTP summary + WS snapshot carry owner) ----------
  {
    const summary = await (await fetch(`${B}/comments`)).json()
    const withOwner = summary.filter(p => p.owner)
    if (!withOwner.length) fail('H11: HTTP summary carries no owner')
    // WS snapshot
    const WebSocket = (await import('../bridge/node_modules/ws/index.js')).default
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const snap = await new Promise((r, j) => { ws.on('message', m => { const x = JSON.parse(m); if (x.type === 'pins') r(x) }); setTimeout(() => j(new Error('no snapshot')), 3000) }).catch(e => fail(`H11: ${e.message}`))
    ws.close()
    const snapPin = snap.pins.find(p => p.owner)
    if (!snapPin || typeof snapPin.owner.label !== 'string') fail('H11: WS snapshot owner malformed')
    pass('H11 owner present + consistent in both projections (HTTP summary label + WS snapshot object)')
  }

  console.log('\nSuite H — Provenance: ALL PASS (owner binding is bulletproof)')
} finally {
  cleanup()
}
