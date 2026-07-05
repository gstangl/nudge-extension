// Monitor feed: emit one line per NEW open pin (agent wake-up) — EVENT-DRIVEN.
// fs.watch on the store file fires the instant the bridge writes (wake latency
// ~ms instead of the old 1 s python poll); a slow fallback poll covers editors/
// filesystems that drop watch events. Also heartbeats the bridge every 2 s so
// the extension can show the honest green ("agent live").
// First pass seeds silently: existing open pins are not "new".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import WebSocket from 'ws' // resolves via bridge/node_modules (this file lives in bridge/)

const STORE_DIR = process.env.NUDGE_STORE || path.join(os.homedir(), '.claude', 'nudge')
const PORT = Number(process.env.NUDGE_PORT || 4700) // the bridge is port-configurable — its clients must be too
const STORE = path.join(STORE_DIR, 'store.json')
const seen = new Set()
let first = true

function scan() {
  let pins
  try { pins = JSON.parse(fs.readFileSync(STORE, 'utf8')).pins } catch { return } // mid-write — next event retries
  scanPins(pins)
}
function scanPins(pins) {
  for (const p of pins) {
    const key = p.id + (p.createdAt || '') // recycled ids must still wake (2026-07-04 lesson)
    if (p.status !== 'open' || seen.has(key)) continue
    seen.add(key)
    if (!first && isOwner !== false) { // standby sessions track silently
      const sel = p.target?.selector || '?'
      const text = p.text ? p.text.slice(0, 120) : '[Nur Markierung — Gerald referenziert sie gleich im Chat]'
      console.log(`Neuer Pin ${p.id}: ${text} @ ${sel} — ${p.url}`)
    }
  }
  first = false
}

// Identity pack: everything a human needs to RECOGNIZE this session in the
// toolbar dropdown — self-chosen/auto label, project + git branch, host
// (Zed/CLI), start time, session id, and the thread's FIRST USER MESSAGE
// (read from the session transcript via the inherited CLAUDE_CODE_SESSION_ID).
const SINCE = Date.now()
const LABEL = process.env.NUDGE_AGENT_LABEL || `${path.basename(process.cwd())} #${process.pid % 10000}`
function gitBranch() {
  try { return execSync('git branch --show-current', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null } catch { return null }
}
function firstMessage() {
  try {
    const sid = process.env.CLAUDE_CODE_SESSION_ID
    if (!sid) return null
    const slug = process.cwd().replace(/\//g, '-')
    const f = path.join(os.homedir(), '.claude', 'projects', slug, `${sid}.jsonl`)
    const fd = fs.openSync(f, 'r')
    const buf = Buffer.alloc(262144)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      try {
        const j = JSON.parse(line)
        const c = j.message?.content
        if (j.type === 'user' && c) {
          const t = ((typeof c === 'string' ? c : c.find?.(x => x.type === 'text')?.text) || '').trim()
          if (t && !t.startsWith('<')) return t.slice(0, 90)
        }
      } catch { /* partial line */ }
    }
  } catch { /* no transcript (non-Claude host) */ }
  return null
}
const IDENTITY = {
  label: LABEL, pid: process.pid, since: SINCE,
  session: (process.env.CLAUDE_CODE_SESSION_ID || '').slice(0, 8) || null,
  project: path.basename(process.cwd()),
  branch: gitBranch(),
  host: process.env.ZED_ENVIRONMENT ? 'Zed' : 'CLI',
  firstMsg: firstMessage(),
}
// STANDBY instead of exit (0.16.0): losers keep heartbeating silently — the
// bridge keeps a roster and Gerald picks the owner in the toolbar dropdown.
// Only the owner prints wake lines; being (re)chosen prints ONE line so the
// session knows it is on duty again.
let isOwner = null // unknown until the first reply
function heartbeat() {
  fetch(`http://127.0.0.1:${PORT}/agent/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(IDENTITY),
    signal: AbortSignal.timeout(1000),
  })
    .then(r => r.json())
    .then(({ owner }) => {
      if (owner === true && isOwner === false) console.log('Watch-Kanal übernommen — diese Session ist jetzt Owner.')
      isOwner = owner !== false
    })
    .catch(() => { /* bridge down — the icon shows it */ })
}

scan()
heartbeat()
setInterval(heartbeat, 2000)
setInterval(scan, 5000) // safety net — WS push and watch events are the fast paths

// ---------- fast path: WS push from the bridge (in-memory, no FSEvents
// coalescing, no debounce). fs.watch + poll stay as fallbacks; the `seen`
// set dedups across all three paths. Disable via NUDGE_NO_WS=1 (benchmarks).
if (!process.env.NUDGE_NO_WS) connectPush()
function connectPush() {
  let sock
  try { sock = new WebSocket(`ws://127.0.0.1:${PORT}`) } catch { return setTimeout(connectPush, 1500) }
  sock.on('open', () => sock.send(JSON.stringify({ type: 'hello', role: 'agent' })))
  sock.on('message', (m) => {
    try { const j = JSON.parse(m); if (j.type === 'pins') scanPins(j.pins) } catch { /* ignore */ }
  })
  sock.on('close', () => setTimeout(connectPush, 1500))
  sock.on('error', () => { try { sock.close() } catch { /* dying */ } })
}

let debounce
const arm = () => {
  try {
    fs.watch(STORE_DIR, (_ev, file) => {
      if (file && file !== 'store.json') return
      clearTimeout(debounce)
      debounce = setTimeout(scan, 10) // writes are ATOMIC (rename) since bridge 0.8 — tiny settle only
    })
  } catch { /* dir may not exist yet — fallback poll carries us until it does */ }
}
if (fs.existsSync(STORE_DIR)) arm()
else {
  const retry = setInterval(() => { if (fs.existsSync(STORE_DIR)) { clearInterval(retry); arm() } }, 2000)
}
