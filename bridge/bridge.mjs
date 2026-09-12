#!/usr/bin/env node
/**
 * Nudge bridge — entry point. One process, two surfaces over one GLOBAL store:
 *  - HTTP on NUDGE_PORT (default 4700): extension posts prompts/selection,
 *    /.identity pairing, /demo test page. Port taken -> exit is fine, another
 *    bridge is serving (native host + hooks keep exactly one alive).
 *  - WebSocket (same port): pushes the pin list + agentLive to connected
 *    extensions on every change (badge, feed, status circle).
 * The agent side uses the runtime-neutral CLI to read the shared store and
 * resolves via HTTP. Lifecycle: Chrome starts this
 * detached via native-host.mjs; session hooks are the fallback. Logs -> stderr.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as store from './store.mjs'

const VERSION = '0.16.0'
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
  if (req.method === 'GET' && url.pathname === '/.identity') {
    // global view for tooling/hooks: the DEFAULT owner (per-host owners live in
    // the WS snapshot each tab receives). `?host=` asks for a specific host.
    const qHost = url.searchParams.get('host') || ''
    const gOwner = ownerForHost(qHost)
    // routes: for every open localhost tab, WHO owns it right now — the map that
    // lets a watcher tell the user "I own localhost:5175" and match it to the
    // toolbar. viaFallback = the returned owner came from newest-wins, NOT from a
    // live explicit pick (per-host or '*'). Derived from the ACTUAL resolution:
    // a pick whose agent just died still sits in chosenByHost until the 5 s sweep,
    // while ownerForHost already falls back — has(h) would lie in that window.
    const fresh = freshAgents()
    const pickAlive = (h) => { const k = chosenByHost.get(h) || chosenByHost.get('*'); return !!k && fresh.some(a => agentKey(a) === k) }
    const tabHosts = [...new Set([...wss.clients].map(c => hostOf(c.meta?.url || '')).filter(Boolean))]
    const routes = tabHosts.map(h => { const o = ownerForHost(h); return { host: h, owner: o ? { label: o.label, session: o.session, wake: o.wake } : null, viaFallback: !pickAlive(h) } })
    return json(res, 200, { app: 'roots-nudge', version: VERSION, workspace: path.dirname(store.STORE_DIR), store: store.STORE_DIR, agentLive: !!gOwner, agentLabel: gOwner?.label || null, agentWake: gOwner?.wake || null, agents: agentsForClient(qHost), owners: [...chosenByHost], routes, tabs: [...wss.clients].map(c => c.meta).filter(Boolean) })
  }
  // Agent heartbeat: a live watcher (watch-nudges.mjs) checks in every ~2 s. This is
  // what lets the extension show the HONEST green ("a prompt gets acted on now")
  // instead of just "bridge reachable".
  if (req.method === 'POST' && url.pathname === '/agent/heartbeat')
    return readBody(req, res, (who) => { // readBody = 400 on non-JSON, 413 past MAX_BODY
      // identity required since 0.15.x — and TYPED: pid/since must be finite
      // numbers or roster keys and owner election degrade into NaN comparisons
      if (!Number.isFinite(who?.pid) || !Number.isFinite(who?.since))
        return json(res, 400, { error: 'heartbeat needs {label, pid:number, since:number}' })
      // ONE roster entry per session: keyed by session id (pid as fallback).
      // An OLDER watcher of a session that armed a newer one is told to die.
      const key = who.session ? `s:${String(who.session).slice(0, 128)}` : `p:${who.pid}`
      const existing = roster.get(key)
      if (existing && existing.pid !== who.pid && existing.since > who.since)
        return json(res, 200, { ok: true, owner: false, replaced: true })
      roster.set(key, {
        label: String(who.label || '?').slice(0, 60), pid: who.pid, since: who.since,
        session: who.session ? String(who.session).slice(0, 128) : null,
        project: who.project ? String(who.project).slice(0, 60) : null,
        branch: who.branch ? String(who.branch).slice(0, 60) : null,
        host: who.host ? String(who.host).slice(0, 20) : null,
        runtime: who.runtime ? String(who.runtime).slice(0, 20) : null,
        surface: who.surface ? String(who.surface).slice(0, 20) : null,
        // wake mode: does a new nudge START this agent (push) or wait to be
        // pulled on the next prompt (pull)? Missing/invalid is always pull, so
        // the extension never claims an autonomous wake a session cannot do.
        wake: who.wake === 'push' ? 'push' : 'pull',
        firstMsg: String(who.firstMsg || '').slice(0, 90) || null,
        lastSeen: Date.now(),
      })
      // Push whenever the visible session list OR the ownership map changed — a
      // new session must reach the Switch-session dropdown at once
      // (2026-07-06); ownership is per-host now, no single global owner.
      if (rosterSig() !== lastBroadcastSig) pushSnapshot()
      return json(res, 200, { ok: true, owner: agentOwnsAnything(roster.get(key)) })
    })
  // toolbar dropdown: the user picks which session owns a given LOCALHOST. The
  // extension sends its own location.host, so a pick on localhost:5186 routes
  // that origin's nudges to the chosen agent; no host = the machine-wide default.
  if (req.method === 'POST' && url.pathname === '/agent/owner')
    return readBody(req, res, ({ pid, session, host }) => {
      // pick by SESSION id (stable) when given, pid only as fallback — a re-armed
      // session (new watcher pid) stays selectable (2026-07-06)
      const target = freshAgents().find(a => (session && a.session === session) || a.pid === pid)
      if (!target) return json(res, 404, { error: 'no such live agent' })
      const h = host ? normHost(String(host).slice(0, 120)) : '*'
      chosenByHost.set(h, agentKey(target))
      log(`owner chosen: ${target.label} for ${h}`)
      pushSnapshot()
      json(res, 200, { ok: true, owner: target.label, host: h })
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
  // agent hook to answer "what is marked right now".
  if (req.method === 'GET' && url.pathname === '/selection')
    return json(res, 200, store.getSelection() || {})
  if (req.method === 'POST' && url.pathname === '/selection')
    return readBody(req, res, (payload) => {
      const sel = store.setSelection(payload)
      json(res, 200, { ok: true, at: sel.at })
    })
  if (req.method === 'POST' && url.pathname === '/comments')
    return readBody(req, res, (payload) => {
      // owner is decided server-side by the nudge's HOST (its localhost:port =
      // which agent owns that dev server) — a client-sent payload.owner is never
      // read, so provenance can't be spoofed
      const pin = store.addPin(payload, ownerStamp(hostOf(payload.url)))
      log(`stored ${pin.id}: "${pin.text.slice(0, 60)}" @ ${pin.target?.selector || pin.url}${pin.owner ? ` [${pin.owner.label}]` : ''}`)
      json(res, 201, { id: pin.id })
    })
  const m = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)\/resolve$/)
  if (req.method === 'POST' && m)
    // offline-created nudges are attributed on resolve to the owner of THEIR host
    return store.resolvePin(m[1], ownerStamp(hostOf(store.getPin(m[1])?.url))) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not found' })
  // append a follow-up to an OPEN nudge (History "+ amend") — re-wakes its agent
  const mam = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)\/amend$/)
  if (req.method === 'POST' && mam)
    return readBody(req, res, ({ text, author }) => {
      const r = store.amendPin(mam[1], { text, author })
      if (r.pin) { log(`amended ${mam[1]}: "${String(text).slice(0, 60)}"`); return json(res, 200, { ok: true, amendments: r.pin.amendments.length }) }
      const code = r.error === 'not_found' ? 404 : r.error === 'resolved' ? 409 : 400
      json(res, code, { error: r.error })
    })
  // discard from the queue popover (×) — remove entirely, not a work outcome.
  // A nudge reaches its agent in milliseconds, so this is almost always a
  // WITHDRAWAL of running work, not a tidy-up: answer with WHO was told, so the
  // toolbar can say "agent informed" instead of a hopeful "dismissed".
  const md = url.pathname.match(/^\/comments\/((?:pin|nudge)_\d+)$/)
  if (req.method === 'DELETE' && md) {
    const target = store.getPin(md[1])
    const owner = target ? ownerForHost(hostOf(target.url)) : null
    const pin = store.deletePin(md[1])
    if (!pin) return json(res, 404, { error: 'not found' })
    // only an open nudge can be in flight; a resolved one is nobody's work
    const notified = !!owner && pin.status === 'open'
    log(`discarded ${pin.id}${notified ? ` — withdrawal sent to ${owner.label}` : ' — no agent on channel'}`)
    return json(res, 200, { ok: true, notified, agent: notified ? owner.label : null, wake: notified ? owner.wake : null })
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
const prunedW = store.pruneWithdrawn()
if (prunedW) log(`pruned ${prunedW} withdrawal markers (>24h) from the inbox`)

// ---------- agent roster + ORIGIN-AWARE ownership ----------
// A nudge belongs to the agent that owns ITS HOST (localhost:5186 = worktree B).
// Ownership is per-host so parallel dev servers each route to their own agent
// (2026-07-07). `chosenByHost` holds the manual per-localhost picks; the
// '*' key is the machine-wide default; with nothing assigned it degrades to the
// old single-owner behaviour (newest fresh agent owns every host).
const roster = new Map() // pid -> full identity + lastSeen (standby sessions incl.)
const chosenByHost = new Map() // host -> agentKey ('*' = default for un-picked hosts)
const agentKey = (a) => a.session ? `s:${a.session}` : `p:${a.pid}`
const freshAgents = () => { const now = Date.now(); return [...roster.values()].filter(a => now - a.lastSeen < 12_000) }
// 127.0.0.1 and localhost are the SAME dev server — normalize so a pick made on
// one spelling owns the other too (otherwise the same app splits into two hosts
// with two different owners)
const normHost = (h) => String(h || '').replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
const hostOf = (u) => { try { return normHost(new URL(u).host) } catch { return '' } }
// stable signature of the VISIBLE session list AND the ownership map — changes
// iff a session joins/leaves/renames OR a per-host owner changes; drives prompt
// dropdown updates without spamming on plain heartbeats
const rosterSig = () => freshAgents().map(a => `${a.pid}:${a.label}`).sort().join('|') + '#' + [...chosenByHost].sort().join(',')
// the agent that owns a given host: per-host pick → '*' default → newest fresh
function ownerForHost(host) {
  const f = freshAgents()
  if (!f.length) return null
  const key = (host && chosenByHost.get(host)) || chosenByHost.get('*')
  if (key) { const c = f.find(a => agentKey(a) === key); if (c) return c }
  return f.reduce((a, b) => (b.since >= a.since ? b : a)) // fallback: newest (single-owner behaviour)
}
// provenance stamp for a nudge on a given host — immutable once written onto a pin
const ownerStamp = (host) => { const o = ownerForHost(host); return o ? { label: o.label, session: o.session } : null }
// does this agent own at least one host (explicit pick, '*' default, or the newest fallback)?
function agentOwnsAnything(a) {
  const k = agentKey(a)
  if ([...chosenByHost.values()].includes(k)) return true
  const fallback = ownerForHost('') // '*' default or newest
  return !!fallback && agentKey(fallback) === k
}
const agentsForClient = (host) => { const o = ownerForHost(host); return freshAgents().map(a => ({ ...a, owner: o ? a.pid === o.pid : false })) }
let lastBroadcastSig = '' // rosterSig() at the last snapshot push — compare against
// THIS (not the tick start) so a session leaving the 12 s fresh window is caught
const pushSnapshot = () => { lastBroadcastSig = rosterSig(); broadcastSnapshot() }
setInterval(() => { // an owner dying / a session leaving / ownership change -> update
  for (const [pid, a] of roster) if (Date.now() - a.lastSeen > 60_000) roster.delete(pid)
  // drop per-host picks whose agent is gone, so the host falls back cleanly
  const liveKeys = new Set(freshAgents().map(agentKey))
  for (const [h, k] of chosenByHost) if (!liveKeys.has(k)) chosenByHost.delete(h)
  if (rosterSig() !== lastBroadcastSig) pushSnapshot()
}, 5000)

// ---------- WebSocket surface (live sync to the extension) ----------
const wss = new WebSocketServer({ server: httpServer })
// EADDRINUSE propagates from the http server to the wss too — without a handler
// it kills the MCP-only fallback process (found by the e2e colliding with a live bridge)
wss.on('error', () => { /* logged by the http handler */ })
const broadcast = (obj) => { const msg = JSON.stringify(obj); for (const c of wss.clients) if (c.readyState === 1) c.send(msg) }
// PER-CLIENT snapshot: each tab sees the owner of ITS OWN host (the bridge knows
// the tab's url from its hello). Pins are the full list — the extension filters
// by route; owner/live reflect who owns this tab's localhost.
const snapshotFor = (host) => {
  const owner = ownerForHost(host)
  // diet: every open pin, but only the 40 freshest resolved
  const all = store.getPins()
  const open = all.filter(p => p.status === 'open')
  const done = all.filter(p => p.status !== 'open').slice(-40)
  return { type: 'pins', agentLive: !!owner, agentLabel: owner?.label || null, agentWake: owner?.wake || null, agents: agentsForClient(host), pins: [...open, ...done].map(store.pinForClient) }
}
const broadcastSnapshot = () => { for (const c of wss.clients) if (c.readyState === 1) c.send(JSON.stringify(snapshotFor(hostOf(c.meta?.url || '')))) }
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
  ws.send(JSON.stringify(snapshotFor(''))) // immediate default snapshot (any client, even pre-hello)
  // once the tab says its url we send a snapshot scoped to THAT host's owner —
  // the ~ms between connect and hello converges, the tab ends on the right owner
  ws.on('message', (m) => {
    try {
      const h = JSON.parse(m)
      if (h.type === 'hello') {
        if (h.role !== 'agent') ws.meta = { url: String(h.url || '').slice(0, 120) }
        ws.send(JSON.stringify(snapshotFor(hostOf(ws.meta?.url || '')))) // agents: default owner
      }
    } catch { /* ignore */ }
  })
})

// store changes drive both surfaces: every change -> fresh pin list to the
// extension; a resolve additionally asks the browser for the after-shot evidence
store.onChange((kind, pin) => {
  if (kind === 'selection') return // picks are hover-frequency; tabs render nothing from it
  pushSnapshot() // keeps lastBroadcastSig fresh too, so roster pushes don't double-fire
  // after-shot evidence only for pins that HAD a before-shot (lasso) —
  // element pins are DOM-only by design, nothing to compare against
  if (kind === 'resolved' && pin.screenshot && !pin.screenshotAfter)
    broadcast({ type: 'capture-after', pin: store.pinForClient(pin) })
  // WITHDRAWAL — the only push that says "stop working". A deleted pin is simply
  // ABSENT from the snapshot, and absence is not an event: the watcher's scanPins
  // emits for new OPEN pins only, so before this frame existed a discarded nudge
  // reached the agent never (verified 2026-07-29, test/cancel.mjs). Owner rides
  // along so a parallel dev server's agent ignores a withdrawal that isn't its own.
  if (kind === 'deleted' && pin.status === 'open')
    broadcast({ type: 'withdrawn', id: pin.id, label: store.labelOf(pin.id), url: pin.url, owner: pin.owner || null, at: pin.withdrawnAt })
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
