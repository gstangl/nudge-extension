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
import {
  resolveAgentId,
  resolveAgentRuntime,
  resolveAgentSurface,
  resolveStoreDir,
  resolveWake,
} from '../agent/runtime.mjs'

const STORE_DIR = resolveStoreDir()
const PORT = Number(process.env.NUDGE_PORT || 4700) // the bridge is port-configurable — its clients must be too
const STORE = path.join(STORE_DIR, 'store.json')
const seen = new Set()
const seenId = new Set() // ids ever woken for — a later key on a known id = an amendment
let first = true

function scan() {
  let pins
  try { pins = JSON.parse(fs.readFileSync(STORE, 'utf8')).pins } catch { return } // mid-write — next event retries
  scanPins(pins)
  scanWithdrawn()
}

// ---------- withdrawals ("Gerald hat × gedrückt") ----------
// A discarded nudge is ABSENT from the store, and absence never fires scanPins —
// which is exactly why a cancel used to reach the agent never (2026-07-29). Two
// carriers now: the bridge's `withdrawn` WS frame (fast path, below) and the
// marker file the store leaves behind (this pass — covers NUDGE_NO_WS, a bridge
// restart, and a watcher that was down for the moment of the click).
const seenGone = new Set()
function announceWithdrawn({ id, label, url, owner, at }) {
  if (!id || seenGone.has(id)) return
  seenGone.add(id)
  // same ownership gate as the wake path: only the agent this nudge belonged to
  // is told to stop. Ownerless (offline arrival) falls back to the global gate.
  const mine = !!(owner?.session && MY_SESSION && owner.session === MY_SESSION)
  const ownerless = !owner?.session
  if (first || !(mine || (ownerless && isOwner !== false))) return
  // only meaningful for a nudge THIS watcher actually woke for — otherwise the
  // agent never had it and a "stop" line would be noise about unknown work
  if (!seenId.has(id)) return
  const when = at ? ` (${String(at).slice(11, 16)})` : ''
  console.log(`Nudge ${id}${label ? ` (#${label})` : ''} ZURÜCKGEZOGEN${when} — Gerald hat ihn verworfen. Arbeit daran SOFORT einstellen, nichts committen, nicht resolven. ${url || ''}`.trim())
}
function scanWithdrawn() {
  let files
  try { files = fs.readdirSync(path.join(STORE_DIR, 'inbox')) } catch { return } // no inbox yet
  for (const f of files) {
    const id = f.match(/^((?:pin|nudge)_\d+)\.withdrawn\.md$/)?.[1]
    if (!id || seenGone.has(id) || !seenId.has(id)) continue
    let md = ''
    try { md = fs.readFileSync(path.join(STORE_DIR, 'inbox', f), 'utf8') } catch { continue }
    announceWithdrawn({
      id,
      label: md.match(/^# \S+ \(#(\d+)\)/m)?.[1] || null,
      url: md.match(/^- url: (.+)$/m)?.[1] || '',
      owner: { session: md.match(/^- session: (.+)$/m)?.[1] || null },
      at: md.match(/^- withdrawn: (.+)$/m)?.[1] || null,
    })
  }
}
// ORIGIN-AWARE wake: a nudge is stamped by the bridge with the agent that owns
// its host (localhost:port). Wake for a pin if it belongs to ME — a parallel
// dev server's nudges thus reach only its own agent. A nudge without a
// session-level owner (offline arrival, pid-keyed agent) falls back to the old
// global gate (the owner watcher wakes). Gerald 2026-07-07.
const MY_SESSION = resolveAgentId()
function scanPins(pins) {
  for (const p of pins) {
    // a fresh nudge AND every amendment must wake: fold the latest amendment's
    // timestamp into the key so a touched pin looks "new" again (recycled ids
    // must still wake too — 2026-07-04 lesson)
    const lastAmend = p.amendments?.length ? p.amendments[p.amendments.length - 1] : null
    const key = p.id + (p.createdAt || '') + (lastAmend?.at || '')
    if (p.status !== 'open' || seen.has(key)) continue
    const isAmendWake = seenId.has(p.id) // known id, new key -> Gerald appended a follow-up
    seen.add(key); seenId.add(p.id)
    const mine = !!(p.owner?.session && MY_SESSION && p.owner.session === MY_SESSION)
    const ownerless = !p.owner?.session // no session-level owner -> use the global gate
    if (!first && (mine || (ownerless && isOwner !== false))) {
      if (isAmendWake && lastAmend) {
        console.log(`Nudge ${p.id} ergänzt: ${lastAmend.text.slice(0, 120)} — ${p.url}`)
      } else {
        const sel = p.target?.selector || '?'
        const text = p.text ? p.text.slice(0, 120) : '[Nur Markierung — Gerald referenziert sie gleich im Chat]'
        console.log(`Neuer Pin ${p.id}: ${text} @ ${sel} — ${p.url}`)
      }
    }
  }
  first = false
}

// Identity pack: everything a human needs to RECOGNIZE this session in the
// toolbar dropdown — self-chosen/auto label, project + git branch, host
// (Zed/CLI), start time, session id, and the thread's FIRST USER MESSAGE
// (optionally read from a native transcript when an adapter exposes one).
const SINCE = Date.now()
// OPT-IN FENCE (G-5): a session appears in the extension ONLY after Gerald
// invoked groundworks-nudge there — that path sets the topic label. Without a deliberate
// NUDGE_AGENT_LABEL this watcher refuses to run, so accidental arming by
// eager agents is physically impossible (no default dir+pid label any more).
if (!process.env.NUDGE_AGENT_LABEL) {
  console.error('[nudge-watch] refused: NUDGE_AGENT_LABEL is required; arm only through groundworks-nudge.')
  process.exit(1)
}
if (!MY_SESSION) {
  console.error('[nudge-watch] refused: no agent identity; set NUDGE_AGENT_ID or use a supported runtime adapter.')
  process.exit(1)
}
const LABEL = process.env.NUDGE_AGENT_LABEL
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
// wake mode = can a new nudge START this agent by itself, or does it wait to be
// PULLED? The runtime adapter passes NUDGE_WAKE from an actual capability.
// Missing or invalid values stay pull; an editor name never implies push.
const WAKE = resolveWake()
const RUNTIME = resolveAgentRuntime()
const SURFACE = resolveAgentSurface()
const IDENTITY = {
  label: LABEL, pid: process.pid, since: SINCE,
  session: MY_SESSION,
  project: path.basename(process.cwd()),
  branch: gitBranch(),
  host: SURFACE,
  runtime: RUNTIME,
  surface: SURFACE,
  wake: WAKE, // 'push' = autonomous wake (Zed) · 'pull' = surfaces on next prompt (CLI)
  firstMsg: firstMessage(),
}
// STANDBY instead of exit (0.16.0): losers keep heartbeating silently — the
// bridge keeps a roster and Gerald picks the owner in the toolbar dropdown.
// Only the owner prints wake lines; being (re)chosen prints ONE line so the
// session knows it is on duty again.
let isOwner = null // unknown until the first reply

// Lifecycle (Gerald: inactive sessions get KILLED, stale names must vanish).
// Three tripwires, checked every 5 s / per heartbeat:
// 1) orphaned — the session process died, we got re-parented to launchd: exit
// 2) replaced — the SAME session armed a newer watcher (bridge tells us): exit
// 3) abandoned — standby AND the session transcript idle > 60 min: exit
//    (the OWNER never idle-exits: it is the chosen wake channel)
const TRANSCRIPT = process.env.CLAUDE_CODE_SESSION_ID
  ? path.join(process.env.HOME || '', '.claude', 'projects', process.cwd().replace(/\//g, '-'), `${process.env.CLAUDE_CODE_SESSION_ID}.jsonl`)
  : null
setInterval(() => {
  if (process.ppid === 1) process.exit(0) // orphan
  if (isOwner === false && TRANSCRIPT) {
    try { if (Date.now() - fs.statSync(TRANSCRIPT).mtimeMs > 60 * 60_000) process.exit(0) } catch { /* keep running */ }
  }
}, 5000)
function heartbeat() {
  fetch(`http://127.0.0.1:${PORT}/agent/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(IDENTITY),
    signal: AbortSignal.timeout(1000),
  })
    .then(r => r.json())
    .then(({ owner, replaced }) => {
      if (replaced) process.exit(0) // same session armed a newer watcher
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
    try {
      const j = JSON.parse(m)
      if (j.type === 'pins') scanPins(j.pins)
      if (j.type === 'withdrawn') announceWithdrawn(j) // Gerald pulled it — say so NOW, not on the next poll
    } catch { /* ignore */ }
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
