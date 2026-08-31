// Suite G — Hook Opt-in Gate. The UserPromptSubmit hook (nudge-context.mjs)
// runs in EVERY session on the machine. This proves the immanent guarantee:
// ONLY a session that armed via /groundworks-nudge (its id is in the bridge roster)
// ever sees Nudge context; every foreign session gets TOTAL SILENCE — even with
// a full global store and a live owner. Side port 4797, /tmp store. No browser.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(HERE, '../agent/nudge-context.mjs')
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const STORE = '/tmp/nudge-hookgate-store'
const PORT = 4797
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

fs.rmSync(STORE, { recursive: true, force: true })
const bridge = spawn('node', [BRIDGE], {
  env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'],
})
{
  let up = false
  for (let i = 0; i < 25 && !up; i++) {
    await sleep(200)
    try { up = (await (await fetch(`http://localhost:${PORT}/.identity`)).json()).store === STORE } catch { /* not yet */ }
  }
  if (!up) fail('bridge did not start')
}

// run the hook exactly as the harness does: feed it env, capture stdout.
// A UserPromptSubmit hook that stays silent prints NOTHING (exit 0).
function runHook(sessionId, prompt) {
  try {
    return execFileSync('node', [HOOK], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_ID: sessionId || '', CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' },
      input: prompt ? JSON.stringify({ prompt }) : '', // harness stdin: UserPromptSubmit JSON
      encoding: 'utf8', timeout: 5000,
    }).trim()
  } catch (e) { return `THREW: ${e.message}` }
}
const ctx = (out) => { try { return JSON.parse(out).hookSpecificOutput?.additionalContext || '' } catch { return '' } }

try {
  // seed the global store with an open pin + a fresh selection: the OLD hook
  // would have leaked all of this into every session
  await fetch(`http://localhost:${PORT}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'existing mark', url: `http://localhost:${PORT}/x`, target: { selector: '#x' } }),
  })
  await fetch(`http://localhost:${PORT}/selection`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `http://localhost:${PORT}/x`, target: { selector: '#y', innerText: 'marked now' } }),
  })

  // an armed owner session heartbeats (session id abcd1234 → roster key)
  const OWNER = 'abcd1234'
  const beat = setInterval(() => {
    fetch(`http://localhost:${PORT}/agent/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'armed-owner', pid: 4242, since: 1000, session: OWNER }),
    }).catch(() => {})
  }, 800)
  await fetch(`http://localhost:${PORT}/agent/heartbeat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'armed-owner', pid: 4242, since: 1000, session: OWNER }),
  })
  await sleep(300)

  // --- G1: a FOREIGN session (never armed) gets TOTAL SILENCE — even when its
  //     prompt REFERENCES a nudge (the reference pull must not pierce the gate) ---
  {
    const out = runHook('ffff9999', 'Nudge 1 bitte fixen') // not in the roster
    if (out !== '') fail(`G1: foreign session got output: ${out.slice(0, 160)}`)
    pass('G1 foreign session → total silence (full store + live owner + reference ignored)')
  }

  // --- G2: NO session id at all → silence ---
  {
    const out = runHook('')
    if (out !== '') fail(`G2: session without id got output: ${out.slice(0, 160)}`)
    pass('G2 missing session id → silence')
  }

  // --- G3: the ARMED session sees status + mark + queue ---
  {
    const out = runHook(OWNER)
    const c = ctx(out)
    if (!c) fail('G3: armed session got NO context')
    if (!c.includes('armed-owner')) fail(`G3: armed session missing owner label: ${c.slice(0, 120)}`)
    if (!c.includes('MARKIERUNG')) fail('G3: armed session missing current mark')
    if (!c.includes('Offene Nudges')) fail('G3: armed session missing queue list')
    pass('G3 armed session → full context (status + mark + queue)')
  }

  // --- G3b: reference pull (0.20.0) — „Nudge 1" in the prompt injects that
  //     nudge's full context; unknown ids are named as missing, not invented ---
  {
    const c = ctx(runHook(OWNER, 'Nudge 1 bitte fixen, und was war #7?'))
    if (!c.includes('REFERENZIERT nudge_1')) fail(`G3b: reference injection missing: ${c.slice(0, 200)}`)
    if (!c.includes('„existing mark"')) fail('G3b: referenced nudge text missing')
    if (!c.includes('Nudge 7: nicht im Store')) fail('G3b: unknown id must be named as missing')
    pass('G3b armed session + „Nudge 1" → referenced context injected (unknown id flagged)')
  }

  // --- G4: owner dies → its session leaves the roster → even the SAME id goes silent
  clearInterval(beat)
  {
    // wait past the 12 s freshness window so the roster drops the owner
    let silent = false
    for (let i = 0; i < 40 && !silent; i++) {
      await sleep(500)
      silent = runHook(OWNER) === ''
    }
    if (!silent) fail('G4: session stayed vocal after its watcher stopped (roster leak)')
    pass('G4 disarmed session (watcher stopped) → silence returns')
  }

  console.log('\nSuite G — Hook Opt-in Gate: ALL PASS')
} finally {
  bridge.kill()
}

function pass(m) { console.log('PASS', m) }
