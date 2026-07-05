// Pin native messaging host — Chrome owns the bridge lifecycle.
//
// The extension calls chrome.runtime.connectNative('energy.roots.nudge'); Chrome
// spawns THIS process (stdio = native messaging wire: 4-byte LE length + JSON).
// Job: make sure the bridge is running, report status, idle. Deliberately a thin
// LAUNCHER, not the bridge itself: MV3 service workers suspend after ~30 s which
// kills the native port and this process — so the bridge is spawned DETACHED and
// survives; the next connectNative simply finds it already running (no-op).
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, 'bridge.mjs')
const PORT = 4700

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([head, body]))
}

const portInUse = () => new Promise((res) => {
  const s = net.createConnection({ port: PORT, host: '127.0.0.1' })
  const done = (v) => { clearTimeout(t); s.destroy(); res(v) } // single resolve, no timer leak
  const t = setTimeout(() => done(false), 500)
  s.once('connect', () => done(true))
  s.once('error', () => done(false))
})

async function ensureBridge() {
  if (await portInUse()) return 'running'
  const child = spawn(process.execPath, [BRIDGE], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref() // bridge outlives this launcher AND Chrome's SW suspensions
  return 'started'
}

// Ensure on spawn (connectNative), answer any incoming message with status.
const state = await ensureBridge()
send({ ok: true, bridge: state, port: PORT })

let buf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0)
    if (buf.length < 4 + len) break
    buf = buf.subarray(4 + len) // message content is irrelevant — every ping re-ensures
    void ensureBridge().then((s) => send({ ok: true, bridge: s, port: PORT }))
  }
})
process.stdin.on('end', () => process.exit(0)) // port closed (SW suspended) — bridge lives on
