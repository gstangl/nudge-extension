// Wake-latency benchmark: POST /comments -> watcher stdout line, per nudge.
// Runs the SAME bridge twice against two watcher modes:
//   1) WS push (fast path, bridge 0.8+)   2) NUDGE_NO_WS=1 (fs.watch fallback)
// Prints median/max per mode — the delta is the handover win.
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE = '/tmp/nudge-bench-store'
const PORT = 4799 // side port: never fights the live bridge / Chrome self-healing
const N = 12

async function winPort(env) {
  const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env, stdio: ['ignore', 'ignore', 'ignore'] })
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200))
    try {
      const id = await (await fetch(`http://localhost:${PORT}/.identity`)).json()
      if (id.workspace === path.dirname(STORE)) return bridge
    } catch { /* not up */ }
  }
  console.error('FAIL: bench bridge did not come up'); process.exit(1)
}

async function measure(mode, extraEnv) {
  fs.rmSync(STORE, { recursive: true, force: true })
  const env = { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }
  const bridge = await winPort(env)
  const watcher = spawn('node', [path.join(HERE, '../bridge/watch-nudges.mjs')], {
    env: { ...env, NUDGE_AGENT_LABEL: 'latency-bench', ...extraEnv }, stdio: ['ignore', 'pipe', 'ignore'],
  })
  const waiters = new Map() // id -> resolve(t)
  const early = new Map() // WS push can beat the POST response — buffer lines by id
  let buf = ''
  watcher.stdout.on('data', (c) => {
    buf += c
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      const id = line.match(/(nudge_\d+)/)?.[1]
      if (!id) continue
      if (waiters.has(id)) { waiters.get(id)(performance.now()); waiters.delete(id) }
      else early.set(id, performance.now())
    }
  })
  await new Promise(r => setTimeout(r, 1200)) // watcher settle (seed scan, WS connect)
  const lat = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    const { id } = await (await fetch(`http://localhost:${PORT}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `bench ${i}`, url: 'http://localhost:4700/demo', target: { selector: '#x' } }),
    })).json()
    const tLine = await new Promise((res) => {
      if (early.has(id)) { res(early.get(id)); early.delete(id); return }
      waiters.set(id, res)
      setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); res(NaN) } }, 6000)
    })
    lat.push(tLine - t0)
    await new Promise(r => setTimeout(r, 120))
  }
  watcher.kill(); bridge.kill()
  const ok = lat.filter(Number.isFinite).sort((a, b) => a - b)
  const med = ok[Math.floor(ok.length / 2)]
  console.log(`${mode}: median ${med.toFixed(1)} ms · max ${Math.max(...ok).toFixed(1)} ms · (${ok.length}/${N} measured)`)
  return med
}

const fsPath = await measure('fs.watch fallback', { NUDGE_NO_WS: '1' })
const wsPath = await measure('WS push        ', {})
console.log(`Handover gain: ${(fsPath - wsPath).toFixed(1)} ms (${(fsPath / wsPath).toFixed(1)}x)`)
