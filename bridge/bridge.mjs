#!/usr/bin/env node
/**
 * Pin bridge — entry point. One process, two surfaces over one GLOBAL store:
 *  - HTTP on NUDGE_PORT (default 4700): extension posts prompts/selection,
 *    /.identity pairing, /demo test page. Port taken -> exit is fine, another
 *    bridge is serving (native host + hooks keep exactly one alive).
 *  - WebSocket (same port): pushes the pin list + agentLive to connected
 *    extensions on every change (badge, feed, status circle).
 * The AGENT side needs no server surface: it reads ~/.claude/nudge files and
 * resolves via HTTP (see ~/.claude/skills/nudge). Lifecycle: Chrome starts this
 * detached via native-host.mjs; session hooks are the fallback. Logs -> stderr.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as store from './store.mjs'

const VERSION = '0.11.6'
const PORT = Number(process.env.NUDGE_PORT || 4700)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const log = (...a) => console.error('[nudge-bridge]', ...a)

// ---------- HTTP surface (extension side) ----------
// CORS: localhost origins ONLY. A wildcard here would let EVERY visited website
// read /selection (DOM excerpts + screenshots of the open app), /comments and
// /shots/* — Chrome's Private Network Access mitigates that, Firefox/Safari
// don't. No Origin header (curl, same-origin) needs no CORS at all.
const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
function corsFor(req) {
  const origin = req.headers.origin
  if (!origin || !ORIGIN_OK.test(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...res.cors })
  res.end(JSON.stringify(obj))
}
const MAX_BODY = Number(process.env.NUDGE_MAX_BODY || 40e6)
function readBody(req, res, onJson) {
  let body = ''
  let refused = false
  req.on('data', c => {
    if (refused) return
    body += c
    if (body.length > MAX_BODY) {
      refused = true
      json(res, 413, { error: 'body too large' }) // answer, THEN drop — no hanging socket
      res.socket?.end()
    }
  })
  req.on('end', () => {
    if (refused) return
    try { onJson(JSON.parse(body)) } catch (e) { json(res, 400, { error: String(e) }) }
  })
}
const httpServer = http.createServer((req, res) => {
  try { handle(req, res) } catch (e) {
    log('handler error', e.message)
    try { json(res, 500, { error: 'internal' }) } catch { /* headers already sent */ }
  }
})
function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  res.cors = corsFor(req)
  if (req.method === 'OPTIONS') { res.writeHead(204, res.cors); return res.end() }
  if (req.method === 'GET' && url.pathname === '/.identity')
    return json(res, 200, { app: 'roots-nudge', version: VERSION, workspace: path.dirname(store.STORE_DIR), store: store.STORE_DIR, agentLive: agentLive(), agentLabel: agentLive() ? agent?.label || null : null, agents: agentsForClient(), tabs: [...wss.clients].map(c => c.meta).filter(Boolean) })
  // Agent heartbeat: a live watcher (watch-nudges.mjs) checks in every ~2 s. This is
  // what lets the extension show the HONEST green ("a prompt gets acted on now")
  // instead of just "bridge reachable".
  if (req.method === 'POST' && url.pathname === '/agent/heartbeat')
    return readBody(req, res, (who) => { // readBody = 400 on non-JSON, 413 past MAX_BODY
      // identity required since 0.15.x — and TYPED: pid/since must be finite
      // numbers or roster keys and owner election degrade into NaN comparisons
      if (!Number.isFinite(who?.pid) || !Number.isFinite(who?.since))
        return json(res, 400, { error: 'heartbeat needs {label, pid:number, since:number}' })
      const was = agentLive()
      const prevPid = agent?.pid, prevLabel = agent?.label
      // ONE roster entry per session: keyed by session id (pid as fallback).
      // An OLDER watcher of a session that armed a newer one is told to die.
      const key = who.session ? `s:${String(who.session).slice(0, 32)}` : `p:${who.pid}`
      const existing = roster.get(key)
      if (existing && existing.pid !== who.pid && existing.since > who.since)
        return json(res, 200, { ok: true, owner: false, replaced: true })
      roster.set(key, {
        label: String(who.label || '?').slice(0, 60), pid: who.pid, since: who.since,
        session: who.session ? String(who.session).slice(0, 32) : null,
        project: who.project ? String(who.project).slice(0, 60) : null,
        branch: who.branch ? String(who.branch).slice(0, 60) : null,
        host: who.host ? String(who.host).slice(0, 20) : null,
        firstMsg: String(who.firstMsg || '').slice(0, 90) || null,
        lastSeen: Date.now(),
      })
      const own = currentOwner()
      agent = own ? { label: own.label, pid: own.pid, since: own.since } : null
      const owner = agent?.pid === who.pid
      if (owner) agentSeenAt = Date.now()
      // Push on: liveness flip, ownership/label change, OR the visible session
      // list changed — a NEW session joining (or a label change / re-appearance)
      // must reach the Switch-session dropdown at once, even when a sticky owner
      // means it doesn't become owner (else it only showed on the next unrelated
      // broadcast — minutes later; Gerald 2026-07-06).
      if ((!was && agentLive()) || agent?.pid !== prevPid || agent?.label !== prevLabel || rosterSig() !== lastBroadcastSig) pushSnapshot()
      return json(res, 200, { ok: true, owner })
    })
  // toolbar dropdown: Gerald picks which session owns the wake channel
  if (req.method === 'POST' && url.pathname === '/agent/owner')
    return readBody(req, res, ({ pid, session }) => {
      // pick by SESSION id (stable) when given, pid only as fallback — so a
      // session that re-armed (new watcher pid) is still selectable, and the
      // sticky choice survives its re-arms (Gerald 2026-07-06: 404 on a session
      // whose pid had moved / that had just ended)
      const target = freshAgents().find(a => (session && a.session === session) || a.pid === pid)
      if (!target) return json(res, 404, { error: 'no such live agent' })
      chosenKey = agentKey(target)
      const own = currentOwner()
      agent = own ? { label: own.label, pid: own.pid, since: own.since } : null
      agentSeenAt = Date.now() // chosen = live by decree until its next heartbeat confirms
      log(`owner chosen: ${own?.label} (${chosenKey})`)
      pushSnapshot()
      json(res, 200, { ok: true, owner: own?.label })
    })
  if (req.method === 'GET' && url.pathname === '/comments')
    return json(res, 200, store.getPins().map(store.pinSummary))
  if (req.method === 'GET' && url.pathname === '/demo') {
    try {
      const html = fs.readFileSync(path.join(HERE, 'demo.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(html)
    } catch { return json(res, 404, { error: 'demo page missing' }) }
  }
  // Current selection — set on every element pick (no send needed), read by the
  // agent hook to answer "was ist gerade markiert".
  if (req.method === 'GET' && url.pathname === '/selection')
    return json(res, 200, store.getSelection() || {})
  if (req.method === 'POST' && url.pathname === '/selection')
    return readBody(req, res, (payload) => {
      const sel = store.setSelection(payload)
      json(res, 200, { ok: true, at: sel.at })
    })
  if (req.method === 'POST' && url.pathname === '/comments')
    return readBody(req, res, (payload) => {
      // owner is passed SEPARATELY and decided server-side — a client-sent
      // payload.owner is never read, so provenance can't be spoofed
      const pin = store.addPin(payload, ownerStamp())
      log(`stored ${pin.id}: "${pin.text.slice(0, 60)}" @ ${pin.target?.selector || pin.url}${pin.owner ? ` [${pin.owner.label}]` : ''}`)
      json(res, 201, { id: pin.id })
    })
  const m = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)\/resolve$/)
  if (req.method === 'POST' && m)
    return store.resolvePin(m[1], ownerStamp()) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not found' })
  // discard from the queue popover (×) — remove entirely, not a work outcome
  const md = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)$/)
  if (req.method === 'DELETE' && md) {
    const pin = store.deletePin(md[1])
    if (pin) log(`discarded ${pin.id}`)
    return pin ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not found' })
  }
  const ma = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)\/after$/)
  if (req.method === 'POST' && ma)
    return readBody(req, res, ({ screenshot }) => {
      const pin = store.attachAfterShot(ma[1], screenshot)
      if (pin) log(`evidence captured for ${pin.id}`)
      pin ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not found' })
    })
  const ms = url.pathname.match(/^\/shots\/([\w.-]+\.(?:png|jpg))$/)
  if (req.method === 'GET' && ms) {
    try {
      const img = fs.readFileSync(path.join(store.SHOTS_DIR, ms[1]))
      res.writeHead(200, { 'Content-Type': ms[1].endsWith('.jpg') ? 'image/jpeg' : 'image/png', ...res.cors })
      return res.end(img)
    } catch { return json(res, 404, { error: 'not found' }) }
  }
  json(res, 404, { error: 'not found' })
}
httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // revival races are normal (test Chrome + real Chrome + session hook can all
    // ensure at once) — the loser has no job left, exit instead of lingering
    log(`port ${PORT} taken - another bridge is already serving; exiting`)
    process.exit(0)
  } else log('http error', e)
})
httpServer.listen(PORT, '127.0.0.1', () => log(`http://localhost:${PORT} (demo: /demo) - store: ${store.STORE_DIR}`))

// housekeeping: resolved prompts older than 7 days leave the store (files incl.) —
// unbounded growth would bloat every write and every WS broadcast
const pruned = store.pruneResolved()
if (pruned) log(`pruned ${pruned} resolved pins (>7d) from the store`)

// ---------- agent liveness + roster ----------
let agentSeenAt = 0
let agent = null // the session owning the wake channel (subset of the roster)
const roster = new Map() // pid -> full identity + lastSeen (standby sessions incl.)
let chosenKey = null // sticky manual choice from the dropdown — session-keyed (survives re-arms)
const agentKey = (a) => a.session ? `s:${a.session}` : `p:${a.pid}`
const freshAgents = () => { const now = Date.now(); return [...roster.values()].filter(a => now - a.lastSeen < 12_000) }
// stable signature of the VISIBLE session list (pid+label of every fresh agent) —
// changes iff a session joins, leaves the fresh window, or renames itself; drives
// prompt Switch-session-dropdown updates without spamming on plain heartbeats
const rosterSig = () => freshAgents().map(a => `${a.pid}:${a.label}`).sort().join('|')
function currentOwner() {
  const f = freshAgents()
  if (!f.length) return null
  if (chosenKey) { const c = f.find(a => agentKey(a) === chosenKey); if (c) return c } // sticky until that session dies
  return f.reduce((a, b) => (b.since >= a.since ? b : a)) // fallback: newest
}
// provenance stamp for a nudge: WHO owns the channel right now (immutable once
// written onto a pin) — so a later owner switch never relabels an existing nudge
const ownerStamp = () => { const o = currentOwner(); return o ? { label: o.label, session: o.session } : null }
const agentLive = () => Date.now() - agentSeenAt < 10_000
const agentsForClient = () => freshAgents().map(a => ({ ...a, owner: a.pid === agent?.pid }))
let lastBroadcastLive = false
let lastBroadcastSig = '' // rosterSig() at the last snapshot push — compare against
// THIS (not the tick start) so a session leaving the 12 s fresh window is caught
// (its expiry is time-based; both reads inside one tick already see it gone)
const pushSnapshot = () => { lastBroadcastLive = agentLive(); lastBroadcastSig = rosterSig(); broadcast(snapshot()) }
setInterval(() => { // liveness flip, an owner dying, or a session leaving -> update
  for (const [pid, a] of roster) if (Date.now() - a.lastSeen > 60_000) roster.delete(pid)
  const own = currentOwner()
  const changed = own?.pid !== agent?.pid
  if (changed) agent = own ? { label: own.label, pid: own.pid, since: own.since } : null
  if (agentLive() !== lastBroadcastLive || changed || rosterSig() !== lastBroadcastSig) pushSnapshot()
}, 5000)

// ---------- WebSocket surface (live sync to the extension) ----------
const wss = new WebSocketServer({ server: httpServer })
// EADDRINUSE propagates from the http server to the wss too — without a handler
// it kills the MCP-only fallback process (found by the e2e colliding with a live bridge)
wss.on('error', () => { /* logged by the http handler */ })
const broadcast = (obj) => { const msg = JSON.stringify(obj); for (const c of wss.clients) if (c.readyState === 1) c.send(msg) }
const snapshot = () => {
  // diet: every open pin, but only the 40 freshest resolved — the popover
  // history shows 8 per route; shipping months of history on every change
  // would bloat each broadcast for nothing
  const all = store.getPins()
  const open = all.filter(p => p.status === 'open')
  const done = all.filter(p => p.status !== 'open').slice(-40)
  return { type: 'pins', agentLive: agentLive(), agentLabel: agentLive() ? agent?.label || null : null, agents: agentsForClient(), pins: [...open, ...done].map(store.pinForClient) }
}
const WS_PING = Number(process.env.NUDGE_WS_PING || 30_000)
setInterval(() => {
  for (const c of wss.clients) {
    if (c.isAlive === false) { c.terminate(); continue } // no pong since last ping
    c.isAlive = false
    try { c.ping() } catch { /* dying socket */ }
  }
}, WS_PING)
wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  ws.send(JSON.stringify(snapshot()))
  // the extension introduces its tab -> /.identity can answer "which pages hang here"
  ws.on('message', (m) => {
    try {
      const h = JSON.parse(m)
      if (h.type === 'hello' && h.role !== 'agent') ws.meta = { url: String(h.url || '').slice(0, 120) }
    } catch { /* ignore */ }
  })
})

// store changes drive both surfaces: every change -> fresh pin list to the
// extension; a resolve additionally asks the browser for the after-shot evidence
store.onChange((kind, pin) => {
  if (kind === 'selection') return // picks are hover-frequency; tabs render nothing from it
  pushSnapshot() // keeps lastBroadcastSig fresh too, so roster pushes don't double-fire
  // after-shot evidence only for pins that HAD a before-shot (lasso/Kreis) —
  // element pins are DOM-only by design, nothing to compare against
  if (kind === 'resolved' && pin.screenshot && !pin.screenshotAfter)
    broadcast({ type: 'capture-after', pin: store.pinForClient(pin) })
})

// ---------- dev auto-reload: extension files changed -> extension reloads itself ----------
// NUDGE_NO_RELOAD=1 disables the watch: when the bridge runs from a WORKTREE
// while Chrome's unpacked extension points at the canonical path (missing on a
// foreign branch), a reload broadcast would kill the extension until a manual
// re-load — edits in the worktree must not trigger it (2026-07-05).
const EXT_DIR = path.join(HERE, '../extension')
let reloadTimer
try {
  if (process.env.NUDGE_NO_RELOAD) throw new Error('reload watch disabled')
  fs.watch(EXT_DIR, { recursive: true }, (_event, filename) => {
    if (filename && path.basename(filename).startsWith('.')) return // .DS_Store etc.
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      log('extension files changed - broadcasting reload')
      broadcast({ type: 'reload' })
    }, 400)
  })
} catch { /* fs.watch unsupported - manual reload then */ }

