// Bridge hardening checks (no browser): corrupt-store recovery incl. id-reuse
// guard, owner-change broadcast without a pin event, 413 on oversize bodies.
// Wins port 4700 like e2e (kill -> spawn -> verify workspace).
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE = '/tmp/nudge-hardening-store'
const PORT = 4799 // side port — never fights the live bridge
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }

// seed: corrupt store + an inbox mirror proving nudge_7 once existed
fs.rmSync(STORE, { recursive: true, force: true })
fs.mkdirSync(path.join(STORE, 'inbox'), { recursive: true })
fs.writeFileSync(path.join(STORE, 'store.json'), '{ this is not json')
fs.writeFileSync(path.join(STORE, 'inbox', 'nudge_7.md'), '# nudge_7 - open\n')

const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], {
  env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_MAX_BODY: '1000' },
  stdio: ['ignore', 'ignore', 'inherit'],
})
{
  let up = false
  for (let i = 0; i < 20 && !up; i++) {
    await new Promise(r => setTimeout(r, 200))
    try { up = (await (await fetch(`http://localhost:${PORT}/.identity`)).json()).store === STORE } catch { /* not up */ }
  }
  if (!up) fail('bridge did not come up on side port')
}
const done = (msg) => { console.log('PASS', msg) }

try {
  // --- H1: corrupt store -> backup exists, store empty, NO id reuse (seq floor) ---
  const bak = fs.readdirSync(STORE).find(f => f.startsWith('store.json.corrupt-'))
  const list = await (await fetch('http://localhost:4799/comments')).json()
  if (list.length !== 0) fail(`corrupt store should serve empty, got ${list.length}`)
  const created = await (await fetch('http://localhost:4799/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'nach dem Crash', url: 'http://localhost:4799/demo', target: { selector: '#x' } }),
  })).json()
  if (!bak && !fs.readdirSync(STORE).find(f => f.startsWith('store.json.corrupt-'))) fail('corrupt backup missing')
  if (Number(created.id.replace('nudge_', '')) <= 7) fail(`id reuse! got ${created.id} despite inbox floor nudge_7`)
  done(`corrupt-store recovery (backup + empty + seq floor: new id ${created.id})`)

  // --- H2: owner change broadcasts WITHOUT a pin event ---
  const ws = new WebSocket('ws://127.0.0.1:4799')
  const labels = []
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'pins') labels.push(j.agentLabel) })
  await new Promise(r => ws.on('open', r))
  const hb = (label, since) => fetch('http://localhost:4799/agent/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, pid: since, since }),
  })
  await hb('session-A', 1000)
  await new Promise(r => setTimeout(r, 150))
  await hb('session-B', 2000) // newer -> takes over
  await new Promise(r => setTimeout(r, 300))
  if (!labels.includes('session-A')) fail(`A never broadcast: ${JSON.stringify(labels)}`)
  if (!labels.includes('session-B')) fail(`owner change B not broadcast without pin event: ${JSON.stringify(labels)}`)
  const loser = await (await hb('session-A', 1000)).json()
  if (loser.owner !== false) fail('older session must be told it lost')
  ws.close()
  done('owner-change broadcast (A -> B live, loser told owner:false)')

  // --- H5: roster + manual owner choice (sticky, standby stays alive) ---
  const idn = await (await fetch('http://localhost:4799/.identity')).json()
  if ((idn.agents || []).length !== 2) fail(`roster should list 2 sessions, got ${JSON.stringify(idn.agents?.map(a=>a.label))}`)
  const pick = await (await fetch('http://localhost:4799/agent/owner', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 1000 }),
  })).json()
  if (pick.owner !== 'session-A') fail(`choice should install session-A, got ${JSON.stringify(pick)}`)
  const aAgain = await (await hb('session-A', 1000)).json()
  const bAgain = await (await hb('session-B', 2000)).json()
  if (aAgain.owner !== true || bAgain.owner !== false) fail(`sticky choice violated: A=${aAgain.owner} B=${bAgain.owner}`)
  done('roster + manual owner choice (sticky against newer B)')

  // --- H6: one roster entry per SESSION; older watcher of the same session
  //     is told it was replaced (Gerald: no stale names, ever) ---
  const hbS = (pid, since) => fetch('http://localhost:4799/agent/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'thread-X', pid, since, session: 'abc12345' }),
  })
  await hbS(10, 5000)
  await hbS(11, 6000) // same session re-armed with a newer watcher
  const idn2 = await (await fetch('http://localhost:4799/.identity')).json()
  const xEntries = idn2.agents.filter(a => a.session === 'abc12345')
  if (xEntries.length !== 1 || xEntries[0].pid !== 11) fail(`session dedupe: ${JSON.stringify(xEntries)}`)
  const old = await (await hbS(10, 5000)).json()
  if (old.replaced !== true) fail('older same-session watcher must be told replaced')
  done('session-keyed roster (dedupe + replaced signal to the old watcher)')

  // --- H7: opt-in fence — a watcher without a deliberate label refuses to run ---
  const { spawn: sp } = await import('node:child_process')
  const noLabel = sp('node', [path.join(HERE, '../bridge/watch-nudges.mjs')], {
    env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
  })
  let errOut = ''
  noLabel.stderr.on('data', c => { errOut += c })
  const code = await new Promise(r => { noLabel.on('exit', r); setTimeout(() => { noLabel.kill(); r(-1) }, 3000) })
  if (code !== 1 || !errOut.includes('Opt-in')) fail(`fence: watcher without label must refuse (exit ${code}, err: ${errOut.slice(0, 80)})`)
  const withLabel = sp('node', [path.join(HERE, '../bridge/watch-nudges.mjs')], {
    env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'fence-ok' }, stdio: 'ignore',
  })
  await new Promise(r => setTimeout(r, 2500))
  const idn3 = await (await fetch(`http://localhost:${PORT}/.identity`)).json()
  withLabel.kill()
  if (!idn3.agents.some(a => a.label === 'fence-ok')) fail('fence: labeled watcher must register')
  done('opt-in fence (no label -> refuses; labeled -> registers)')

  // --- H3: oversize body -> 413, connection answered (no hanging socket) ---
  const big = await fetch('http://localhost:4799/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(5000) }),
    signal: AbortSignal.timeout(3000), // a hang would trip this
  })
  if (big.status !== 413) fail(`oversize body: expected 413, got ${big.status}`)
  done('oversize body answers 413 (no socket hang)')

  // --- H4: atomic persist left no tmp residue ---
  if (fs.existsSync(path.join(STORE, 'store.json.tmp'))) fail('tmp residue after persist')
  JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')) // parses = intact
  done('atomic persist (no tmp residue, store parses)')
} finally {
  bridge.kill()
}
