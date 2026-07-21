// Suite W — Wake mode (push vs pull). Two agent hosts, two wake models: Zed pushes
// (a new nudge starts the agent itself), the Claude-CLI pulls (a nudge waits for the
// next prompt). The green icon must NOT imply „kommt automatisch" for a pull owner —
// so the wake mode has to travel: watcher IDENTITY → roster → /.identity + WS snapshot,
// and the extension renders it. This suite proves the DATA path end-to-end (the render
// is asserted in the extension e2e). Side port 4788, /tmp store, no browser.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const WATCHER = path.join(HERE, '../bridge/watch-nudges.mjs')
const STORE = '/tmp/nudge-wake-store'
const PORT = 4788
const B = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)

fs.rmSync(STORE, { recursive: true, force: true })
const bridge = spawn('node', [BRIDGE], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
const kids = []
const timers = []
const cleanup = () => { for (const t of timers) clearInterval(t); try { bridge.kill() } catch {} ; for (const k of kids) { try { k.kill() } catch {} } }
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch {} } return false }
if (!await up()) fail('bridge did not start')

// heartbeat with an explicit wake + host; `wake`/`host` optional to test defaults
const hb = (o) => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).catch(() => {})
const assign = (o) => fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json())
const identity = (host) => fetch(`${B}/.identity${host ? `?host=${encodeURIComponent(host)}` : ''}`).then(r => r.json())
const agentBy = (j, se) => (j.agents || []).find(a => a.session === se)

try {
  // two armed sessions: a Zed pusher and a CLI puller, each on its own localhost
  const push = { label: 'Zed-Sess', pid: 101, since: 1000, session: 'sessPush', host: 'Zed', wake: 'push' }
  const pull = { label: 'CLI-Sess', pid: 202, since: 2000, session: 'sessPull', host: 'CLI', wake: 'pull' }
  timers.push(setInterval(() => hb(push), 1000))
  timers.push(setInterval(() => hb(pull), 1000))
  await hb(push); await hb(pull); await sleep(300)
  await assign({ session: 'sessPush', host: 'localhost:5185' })
  await assign({ session: 'sessPull', host: 'localhost:5186' }); await sleep(150)

  // ---------- W1: the wake mode reaches /.identity per agent ----------
  {
    const j = await identity()
    if (agentBy(j, 'sessPush')?.wake !== 'push') fail(`push agent wake = ${agentBy(j, 'sessPush')?.wake}`)
    if (agentBy(j, 'sessPull')?.wake !== 'pull') fail(`pull agent wake = ${agentBy(j, 'sessPull')?.wake}`)
    pass('W1 /.identity agents[] carry wake (push + pull)')
  }

  // ---------- W2: global agentWake reflects the queried host's owner ----------
  {
    const jP = await identity('localhost:5185')
    const jC = await identity('localhost:5186')
    if (jP.agentWake !== 'push') fail(`host 5185 agentWake = ${jP.agentWake} (want push)`)
    if (jC.agentWake !== 'pull') fail(`host 5186 agentWake = ${jC.agentWake} (want pull)`)
    pass('W2 /.identity agentWake follows the per-host owner')
  }

  // ---------- W3: routes[] + WS snapshot expose the owner's wake to a tab ----------
  {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    kids.push({ kill: () => ws.close() })
    const snap = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no scoped snapshot')), 4000)
      let sawHello = false
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', url: 'http://localhost:5186/app' })))
      ws.on('message', (m) => {
        const j = JSON.parse(m)
        // first snapshot is the pre-hello default; take the one after our hello
        if (!sawHello) { sawHello = true; return }
        clearTimeout(timer); resolve(j)
      })
      ws.on('error', reject)
    })
    if (snap.agentWake !== 'pull') fail(`scoped snapshot agentWake = ${snap.agentWake} (tab on the CLI host → pull)`)
    const j = await identity()
    const route = (j.routes || []).find(r => r.host === 'localhost:5186')
    if (route?.owner?.wake !== 'pull') fail(`route 5186 owner.wake = ${route?.owner?.wake}`)
    pass('W3 WS snapshot + /.identity routes[] carry the owner wake to the tab')
  }

  // ---------- W4: missing/invalid wake DEFAULTS from host (never a false push) ----------
  {
    // an old skill / hand-start sends no wake — the bridge must derive, not assume push
    await hb({ label: 'Old-Zed', pid: 303, since: 3000, session: 'sessOldZ', host: 'Zed' })
    await hb({ label: 'Old-CLI', pid: 404, since: 4000, session: 'sessOldC', host: 'CLI' })
    await hb({ label: 'Junk', pid: 505, since: 5000, session: 'sessJunk', host: 'CLI', wake: 'garbage' })
    await sleep(150)
    const j = await identity()
    if (agentBy(j, 'sessOldZ')?.wake !== 'push') fail(`old Zed default = ${agentBy(j, 'sessOldZ')?.wake} (want push)`)
    if (agentBy(j, 'sessOldC')?.wake !== 'pull') fail(`old CLI default = ${agentBy(j, 'sessOldC')?.wake} (want pull)`)
    if (agentBy(j, 'sessJunk')?.wake !== 'pull') fail(`invalid wake not clamped: ${agentBy(j, 'sessJunk')?.wake}`)
    pass('W4 missing/invalid wake derives from host (no false auto-wake)')
  }

  // ---------- W5: the REAL watcher propagates NUDGE_WAKE end-to-end ----------
  {
    const w = spawn('node', [WATCHER], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'Real-Pull', NUDGE_WAKE: 'pull', CLAUDE_CODE_SESSION_ID: 'realpull0-xyz' },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    kids.push(w)
    let ok = false
    for (let i = 0; i < 20 && !ok; i++) { await sleep(300); const a = agentBy(await identity(), 'realpull'); if (a) ok = a.wake === 'pull' }
    if (!ok) fail('real watcher did not register with wake=pull')
    pass('W5 real watch-nudges.mjs carries NUDGE_WAKE=pull into the roster')
  }

  console.log('\nSuite W — Wake mode: ALL PASS')
} catch (e) {
  fail(e.message || String(e))
} finally {
  cleanup()
}
process.exit(0) // intervals + WS keep the loop alive otherwise
