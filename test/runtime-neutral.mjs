import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const CLI = path.join(HERE, '../agent/groundworks-nudge.mjs')
const HOOK = path.join(HERE, '../agent/nudge-context.mjs')
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-runtime-integration-'))
const PORT = 4817
const BASE = `http://127.0.0.1:${PORT}`
const AGENT_ID = '123e4567-e89b-12d3-a456-426614174000'
const ENV = { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }
const children = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => { throw new Error(message) }
const pass = (message) => console.log(`PASS ${message}`)

function run(args, extraEnv = {}) {
  return execFileSync('node', [CLI, ...args], { env: { ...ENV, ...extraEnv }, encoding: 'utf8', timeout: 8000 }).trim()
}

async function waitFor(test, message) {
  for (let i = 0; i < 40; i++) {
    try { if (await test()) return } catch { /* retry */ }
    await sleep(150)
  }
  fail(message)
}

const bridge = spawn('node', [BRIDGE], { env: ENV, stdio: ['ignore', 'ignore', 'inherit'] })
children.push(bridge)

try {
  await waitFor(async () => (await (await fetch(`${BASE}/.identity`)).json()).store === STORE, 'bridge did not start')

  const watcher = spawn('node', [CLI, 'watch', '--label', 'Runtime parity', '--agent-id', AGENT_ID, '--runtime', 'Codex', '--surface', 'CLI', '--wake', 'pull'], {
    env: ENV,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  children.push(watcher)
  await waitFor(async () => {
    const live = await (await fetch(`${BASE}/.identity`)).json()
    const agent = live.agents?.find((item) => item.session === AGENT_ID)
    return agent?.runtime === 'Codex' && agent?.surface === 'CLI' && agent?.wake === 'pull'
  }, 'Codex watcher did not register with a stable runtime-neutral identity')
  pass('Codex identity reaches the shared roster with runtime, surface, and pull capability')

  for (const command of ['status', 'identity']) {
    const status = JSON.parse(run([command]))
    if (status.app !== 'groundworks-nudge' || status.store !== STORE || status.kind !== undefined
        || !status.agents?.some(agent => agent.session === AGENT_ID)) fail(`${command} changed its bridge-identity response`)
  }
  pass('status without checks and identity retain the existing bridge response')

  const readiness = JSON.parse(run(['status', '--check', '--runtime', 'Agent', '--agent-id', AGENT_ID]))
  if (readiness.kind !== 'groundworks-nudge-readiness' || readiness.schemaVersion !== 1
      || readiness.state !== 'browser_required' || readiness.checks.bridge.state !== 'connected'
      || readiness.checks.session.state !== 'armed' || readiness.checks.session.wake !== 'pull') {
    fail('status check confused a live bridge and armed session with a connected browser')
  }
  pass('status check observes the real bridge and current session without asserting a browser installation')

  const created = await (await fetch(`${BASE}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Tighten this spacing', url: 'http://localhost:5175/card', target: { selector: '.card', innerText: 'Card' } }),
  })).json()
  if (created.id !== 'nudge_1') fail(`unexpected id ${created.id}`)

  const queue = JSON.parse(run(['list', '--agent-id', AGENT_ID, '--port', '5175']))
  if (queue.store !== STORE || queue.open.length !== 1) fail('CLI did not read the bridge-reported shared store')
  if (queue.open[0].owner?.session !== AGENT_ID) fail('created nudge lost its full Codex owner id')
  pass('CLI reads the shared store and scopes the queue to the Codex owner and port')

  const shown = JSON.parse(run(['show', '#1']))
  if (shown.id !== created.id || shown.target?.selector !== '.card') fail('pill reference did not resolve to the open nudge')
  pass('open pill reference resolves to full browser context')

  const foreignHook = execFileSync('node', [HOOK], {
    env: { ...ENV, CODEX_THREAD_ID: 'foreign-thread' },
    input: JSON.stringify({ prompt: 'Nudge 1' }), encoding: 'utf8', timeout: 5000,
  }).trim()
  if (foreignHook) fail('foreign Codex session received Nudge context')
  const ownHook = execFileSync('node', [HOOK], {
    env: { ...ENV, CODEX_THREAD_ID: AGENT_ID },
    input: JSON.stringify({ prompt: 'Nudge 1' }), encoding: 'utf8', timeout: 5000,
  }).trim()
  const hookContext = JSON.parse(ownHook).hookSpecificOutput?.additionalContext || ''
  if (!hookContext.includes('REFERENCED nudge_1') || !hookContext.includes(STORE)) fail('armed Codex hook did not receive the referenced shared context')
  pass('hook opt-in stays silent for foreign Codex sessions and works for the armed one')

  const resolved = JSON.parse(run(['resolve', created.id, '--wait-evidence', '0']))
  if (!resolved.resolved || resolved.evidence !== 'not_required') fail('element nudge resolve result is dishonest')
  const saved = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins[0]
  if (saved.status !== 'resolved') fail('resolved state was not persisted')
  pass('resolve persists completion and reports the correct evidence requirement')

  const portPins = []
  for (const url of ['http://localhost:5175/exact', 'http://localhost:51750/prefix', 'http://localhost:5199/?from=:5175', 'http://localhost:80/explicit', 'http://localhost/implicit', 'http://localhost:8000/prefix']) {
    const response = await fetch(`${BASE}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[TEST] exact port scope', url }) })
    if (!response.ok) fail(`port fixture rejected: ${response.status}`)
    portPins.push((await response.json()).id)
  }
  for (const port of ['5175', ':5175']) {
    const list = JSON.parse(run(['list', '--all', '--port', port]))
    if (list.open.length !== 1 || list.open[0].id !== portPins[0]) fail(`port ${port} matched a different port or URL text: ${JSON.stringify(list.open.map(pin => pin.url))}`)
  }
  for (const port of ['80', ':80']) {
    const list = JSON.parse(run(['list', '--all', '--port', port]))
    if (list.open.length !== 2 || list.open.some(pin => !portPins.slice(3, 5).includes(pin.id))) fail('explicit and implicit default ports must have identical scope')
  }
  for (const id of portPins) {
    const response = await fetch(`${BASE}/comments/${id}`, { method: 'DELETE' })
    if (!response.ok) fail(`port fixture withdrawal failed: ${response.status}`)
  }
  const withdrawals = JSON.parse(run(['context', '--all', '--port', '5175'])).withdrawn
  if (withdrawals.length !== 1 || withdrawals[0].id !== portPins[0]) fail('withdrawal context crossed the exact port boundary')
  pass('CLI queue and withdrawals use exact URL ports, not port prefixes or query text')

  console.log('\nRuntime-neutral Nudge integration: ALL PASS')
} finally {
  for (const child of children.reverse()) { try { child.kill() } catch { /* already gone */ } }
  fs.rmSync(STORE, { recursive: true, force: true })
}
