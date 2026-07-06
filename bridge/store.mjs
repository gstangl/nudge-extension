/**
 * Pin store — single owner of .pin/ on disk (store.json + shots/ + inbox/ mirror).
 *
 * Read path is mtime-cached: several bridge processes can share one store (the
 * EADDRINUSE fallback runs a second, MCP-only bridge on the same .pin), so a plain
 * in-memory cache would go stale. statSync per read is ~µs; full read+parse only
 * when another process actually wrote. Writes are last-writer-wins on the whole
 * file — acceptable at PoC scale, documented in the README.
 *
 * Mutations emit change events; the bridge subscribes (WS broadcast, evidence
 * request). The store itself knows nothing about HTTP/WS/MCP.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Default store = ~/.claude/nudge — GLOBAL, one truth for every agent in every
// project (Gerald 2026-07-05: Pin must work everywhere, not just roots-apps).
// Never derive from process.cwd() (a restart from the wrong directory once
// stranded marks in a test store). NUDGE_STORE still overrides for tests.
export const STORE_DIR = process.env.NUDGE_STORE || path.join(os.homedir(), '.claude', 'nudge')
export const SHOTS_DIR = path.join(STORE_DIR, 'shots')
const INBOX_DIR = path.join(STORE_DIR, 'inbox')
const STORE_FILE = path.join(STORE_DIR, 'store.json')

// ---------- cached read / write ----------
let cache = null
let cacheMtime = -1
// Parsing alone is not enough: a hand edit / partial write / old schema can be
// valid JSON of the WRONG SHAPE (`null`, `[]`, {pins:"x"}, {seq:"x"}). Those
// crashed the bridge on the first pins.filter — BEFORE it listened, so the
// native host crash-looped it (found by the brutal suite, 2026-07-05).
function usable(c) {
  return !!c && typeof c === 'object' && !Array.isArray(c) && Array.isArray(c.pins) && Number.isFinite(c.seq)
}
function load() {
  let m = 0
  try { m = fs.statSync(STORE_FILE).mtimeMs } catch { m = 0 }
  if (!cache || m !== cacheMtime) {
    let parsed, reason = null
    try { parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) } catch (e) { reason = e.message }
    if (reason == null && !usable(parsed)) reason = 'wrong shape'
    if (reason == null) {
      cache = parsed
    } else {
      cache = { seq: seqFloorFromInbox(), pins: [] }
      // NEVER silently wipe: an unusable store gets backed up, and the seq floor
      // from the inbox mirrors prevents id reuse for everything ever issued
      if (fs.existsSync(STORE_FILE)) {
        const bak = `${STORE_FILE}.corrupt-${Date.now()}`
        try { fs.copyFileSync(STORE_FILE, bak) } catch { /* readonly fs — nothing to save */ }
        console.error(`[nudge-store] store.json UNUSABLE (${reason}) — backed up to ${bak}, starting empty at seq ${cache.seq}`)
      }
    }
    cacheMtime = m
  }
  return cache
}
// highest pin/nudge number ever mirrored to the inbox — survives store loss
function seqFloorFromInbox() {
  try {
    return fs.readdirSync(INBOX_DIR).reduce((max, f) => {
      const n = Number(f.match(/^(?:pin|nudge)_(\d+)\.md$/)?.[1] || 0)
      return n > max ? n : max
    }, 0)
  } catch { return 0 }
}
function persist() {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  // atomic: write aside, then rename — a crash mid-write leaves the old store intact
  const tmp = STORE_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, STORE_FILE)
  try { cacheMtime = fs.statSync(STORE_FILE).mtimeMs } catch { /* keep stale mtime */ }
}

// ---------- change events ----------
const listeners = new Set()
export const onChange = (fn) => listeners.add(fn)
const emit = (kind, pin) => { for (const fn of listeners) fn(kind, pin) }

// ---------- queries ----------
export const getPins = () => load().pins
export const getPin = (id) => load().pins.find(p => p.id === id)

// EVERY client field is untrusted input. The extension sends bounded data, but
// the bridge must stay healthy no matter what posts on the port: an uncapped
// url/target/outerHTML would bloat store.json, and every load/persist/broadcast
// pays for it forever (brutal-suite finding, 2026-07-05).
const cap = (v, n) => { const s = String(v ?? ''); return s ? s.slice(0, n) : '' }
const capOrNull = (v, n) => (v == null ? null : cap(v, n) || null)
// owner provenance stamp: { label, session } of the agent that owned the channel
const sanitizeOwner = (o) => (o && typeof o === 'object' && (o.label || o.session))
  ? { label: cap(o.label, 60) || null, session: o.session ? cap(o.session, 32) : null }
  : null
function sanitizeStyles(styles) {
  if (!styles || typeof styles !== 'object') return null
  try { return JSON.stringify(styles).length > 20_000 ? null : styles } catch { return null }
}
function sanitizeRect(r) {
  if (!r || typeof r !== 'object') return null
  const { x, y, w, h, width, height, top, left, dpr } = r
  const out = { x, y, w, h, width, height, top, left, dpr }
  for (const k of Object.keys(out)) if (!Number.isFinite(out[k])) delete out[k]
  return Object.keys(out).length ? out : null
}
function sanitizeTarget(t) {
  if (!t || typeof t !== 'object') return null
  return {
    selector: cap(t.selector, 500),
    source: capOrNull(t.source, 500),
    xpath: capOrNull(t.xpath, 500),
    innerText: cap(t.innerText, 300),
    outerHTML: cap(t.outerHTML, 4000),
    styles: sanitizeStyles(t.styles),
    rect: sanitizeRect(t.rect),
  }
}
// Multi-selection (Shift+Klick): several elements are ONE mark/prompt.
// Cap + per-element trim keep store.json bounded no matter what a client posts.
function sanitizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length < 2) return null
  return targets.slice(0, 12).map(t => ({
    selector: cap(t?.selector, 500),
    source: t?.source ? cap(t.source, 500) : null,
    xpath: t?.xpath ? cap(t.xpath, 500) : null,
    innerText: cap(t?.innerText, 300),
    outerHTML: cap(t?.outerHTML, 1200),
    styles: sanitizeStyles(t?.styles),
  }))
}

// ---------- current selection (ephemeral, latest-wins) ----------
// "What is marked RIGHT NOW": set on every element pick in the extension —
// no send needed. One file, overwritten each time; screenshots likewise.
// Not a pin: no id, no inbox mirror, no lifecycle.
const SELECTION_FILE = path.join(STORE_DIR, 'selection.json')
export function setSelection(payload) {
  const sel = {
    at: new Date().toISOString(),
    url: payload.url || '', title: payload.title || '',
    selector: payload.target?.selector || payload.selector || '',
    source: payload.target?.source || payload.source || null,
    xpath: payload.target?.xpath || payload.xpath || null,
    innerText: (payload.target?.innerText || payload.innerText || '').slice(0, 300),
    outerHTML: (payload.target?.outerHTML || payload.outerHTML || '').slice(0, 1200),
    styles: payload.target?.styles || payload.styles || null,
    rect: payload.target?.rect || payload.rect || null,
    viewport: payload.viewport || null,
    targets: sanitizeTargets(payload.targets),
  }
  fs.mkdirSync(STORE_DIR, { recursive: true })
  if (payload.screenshot) sel.screenshot = saveImage('selection', '', payload.screenshot)
  if (payload.screenshotFull) sel.screenshotFull = saveImage('selection', '_full', payload.screenshotFull)
  // Two-phase publish: a fresh pick posts data-only with keepShot:false (old
  // screenshots are STALE, the new shot lands moments later); chip retargets
  // post keepShot:true and inherit the pick-time crop (padding covers ancestors).
  if (!sel.screenshot && payload.keepShot !== false) {
    const prev = getSelection()
    if (prev?.screenshot) { sel.screenshot = prev.screenshot; sel.screenshotFull = prev.screenshotFull }
  }
  const selTmp = SELECTION_FILE + '.tmp'
  fs.writeFileSync(selTmp, JSON.stringify(sel, null, 2))
  fs.renameSync(selTmp, SELECTION_FILE)
  emit('selection', sel)
  return sel
}
export function getSelection() {
  try { return JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf8')) } catch { return null }
}

// ---------- mutations ----------
function saveImage(id, suffix, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(png|jpeg);base64,(.+)$/s)
  if (!m) return null
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = `${id}${suffix}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`
  fs.writeFileSync(path.join(SHOTS_DIR, file), Buffer.from(m[2], 'base64'))
  return `shots/${file}`
}

// `owner` is a SEPARATE arg, never read from payload: the bridge passes the
// server-decided owner stamp so a client can NEVER inject or spoof provenance
// (bulletproof binding — Gerald 2026-07-05: "nicht gekidnappt").
export function addPin(payload, owner) {
  const s = load()
  // ids must NEVER be reused (watchers dedup by id; a recycled id is silently
  // swallowed — happened live 2026-07-04 after a manual seq reset). Guard against
  // hand-edited stores: seq always moves past every existing pin number.
  s.seq = Math.max(s.seq, ...s.pins.map(p => Number(p.id.replace(/^(?:pin|nudge)_/, '')) || 0)) + 1
  const id = `nudge_${s.seq}`
  const pin = {
    id,
    status: 'open',
    createdAt: new Date().toISOString(),
    author: cap(payload.author, 80) || null,
    text: cap(payload.text, 4000),
    url: cap(payload.url, 2000),
    title: cap(payload.title, 300),
    ua: capOrNull(payload.ua, 300),
    // owner = the agent session that held the watch channel WHEN this nudge
    // arrived (server-decided, from the `owner` arg — payload.owner is IGNORED).
    // Immutable: a later owner switch never relabels an existing nudge —
    // provenance stays put (Gerald 2026-07-05: "damit das erhalten bleibt").
    owner: sanitizeOwner(owner),
    viewport: sanitizeRect(payload.viewport),
    target: sanitizeTarget(payload.target),
    targets: sanitizeTargets(payload.targets),
    annotations: (() => { try { return payload.annotations && JSON.stringify(payload.annotations).length <= 100_000 ? payload.annotations : null } catch { return null } })(),
    console: Array.isArray(payload.console) ? payload.console.slice(-20).map(l => cap(l, 500)) : null,
  }
  if (payload.screenshot) pin.screenshot = saveImage(id, '', payload.screenshot)
  if (payload.screenshotFull) pin.screenshotFull = saveImage(id, '_full', payload.screenshotFull)
  s.pins.push(pin)
  persist()
  emit('added', pin) // wake FIRST — the inbox mirror is a convenience artifact
  writeInboxMirror(pin)
  return pin
}

export function resolvePin(id, ownerFallback) {
  const pin = getPin(id)
  if (!pin) return null
  pin.status = 'resolved'
  pin.resolvedAt = new Date().toISOString()
  // attribute done work: if the nudge arrived with no agent on channel, stamp
  // the session that resolved it — a done row always names WHO handled it
  if (!pin.owner) pin.owner = sanitizeOwner(ownerFallback)
  persist()
  emit('resolved', pin) // notify first, mirror after
  writeInboxMirror(pin)
  return pin
}

// Discard (queue-popover ×): the prompt was a slip / is obsolete — remove it
// entirely, evidence files included. Unlike resolve this is NOT a work outcome;
// nothing is kept. seq is untouched (ids are never reused).
export function deletePin(id) {
  const s = load()
  const i = s.pins.findIndex(p => p.id === id)
  if (i < 0) return null
  const [pin] = s.pins.splice(i, 1)
  persist()
  for (const f of [`${id}.png`, `${id}_full.jpg`, `${id}_after.png`]) {
    try { fs.unlinkSync(path.join(SHOTS_DIR, f)) } catch { /* not there */ }
  }
  try { fs.unlinkSync(path.join(INBOX_DIR, `${id}.md`)) } catch { /* not there */ }
  emit('deleted', pin)
  return pin
}

export function attachAfterShot(id, screenshot) {
  const pin = getPin(id)
  if (!pin) return null
  pin.screenshotAfter = saveImage(id, '_after', screenshot)
  persist()
  writeInboxMirror(pin)
  emit('evidence', pin)
  return pin
}

// housekeeping: drop resolved pins past their useful life, evidence files incl.
// Open pins are NEVER pruned — the queue is a work list, not a cache.
export function pruneResolved(maxAgeMs = 7 * 24 * 3600e3) {
  const s = load()
  const cutoff = Date.now() - maxAgeMs
  const drop = s.pins.filter(p => p.status === 'resolved' && Date.parse(p.resolvedAt || p.createdAt) < cutoff)
  if (!drop.length) return 0
  s.pins = s.pins.filter(p => !drop.includes(p))
  persist()
  for (const p of drop) {
    for (const suf of ['.png', '_full.jpg', '_after.png']) {
      try { fs.unlinkSync(path.join(SHOTS_DIR, `${p.id}${suf}`)) } catch { /* not there */ }
    }
    try { fs.unlinkSync(path.join(INBOX_DIR, `${p.id}.md`)) } catch { /* not there */ }
  }
  return drop.length
}

// ---------- projections (one per consumer, together on purpose) ----------
/** HTTP GET /comments — structured summary for scripts/tools. */
export function pinSummary(p) {
  return { id: p.id, status: p.status, author: p.author, owner: p.owner?.label, text: p.text, url: p.url, selector: p.target?.selector, source: p.target?.source, targets: p.targets?.length || undefined, hasConsole: !!p.console?.length, hasEvidence: !!p.screenshotAfter, createdAt: p.createdAt }
}
// speaking label for text-less prompts — same wording as the extension queue
// (label parity: browser and agent describe a mark identically)
export function markLabel(p) {
  if (p.targets?.length) return `Mark: ${p.targets.length} elements`
  const t = (p.target?.innerText || '').trim()
  if (t) return `Mark: “${t.slice(0, 48)}${t.length > 48 ? '…' : ''}”`
  return p.target?.selector ? `Mark: ${p.target.selector}` : 'Mark without element'
}
/** agent-facing one-liner (skill/watcher), keeps the queue overview compact. */
export function pinLine(p) {
  const route = (() => {
    try { const u = new URL(p.url); return (u.pathname + u.search + u.hash).slice(0, 60) } catch { return p.url.slice(0, 60) }
  })()
  const text = !p.text ? `[${markLabel(p)} — "das hier"]` : (p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text)
  const n = p.targets?.length ? ` · ${p.targets.length} Elemente` : ''
  return `${p.id} · ${p.status} · ${text}${n} · ${route}`
}
/** WS push — what the extension needs for badge, queue popover + open-prompt dots. */
export function pinForClient(p) {
  return {
    id: p.id, status: p.status, author: p.author, owner: p.owner || null, text: p.text, url: p.url, createdAt: p.createdAt, resolvedAt: p.resolvedAt,
    screenshot: p.screenshot, screenshotAfter: p.screenshotAfter,
    target: {
      selector: p.target?.selector, rect: p.target?.rect,
      innerText: (p.target?.innerText || '').slice(0, 80) || undefined, // speaking queue label
    },
    targets: p.targets?.map(t => ({ selector: t.selector })) || undefined, // one dot per element
  }
}

// ---------- inbox mirror (file fallback for MCP-less agent sessions) ----------
function writeInboxMirror(pin) {
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  const src = pin.target?.source ? `\n- source: \`${pin.target.source}\`` : ''
  const who = pin.author ? `\n- author: ${pin.author}` : ''
  // provenance in the file an agent reads: WHICH session this nudge belongs to
  const owns = pin.owner?.label ? `\n- agent: ${pin.owner.label}` : ''
  const con = pin.console?.length ? `\n\n## Console\n\`\`\`\n${pin.console.join('\n')}\n\`\`\`\n` : ''
  const many = pin.targets?.length
    ? `\n\n## Elemente (${pin.targets.length})\n${pin.targets.map((t, i) => `${i + 1}. \`${t.selector}\`${t.source ? ` — \`${t.source}\`` : ''}`).join('\n')}\n`
    : ''
  const after = pin.screenshotAfter ? `\n## Beweis (nachher)\n\n![after](../${pin.screenshotAfter})\n` : ''
  const quote = pin.text || `_(${markLabel(pin)} — reference for "das hier" in chat)_`
  fs.writeFileSync(path.join(INBOX_DIR, `${pin.id}.md`),
    `# ${pin.id} - ${pin.status}\n\n> ${quote}\n\n- url: ${pin.url}\n- selector: \`${pin.target?.selector || '-'}\`${src}${who}${owns}\n- created: ${pin.createdAt}\n${pin.screenshot ? `\n![screenshot](../${pin.screenshot})\n` : ''}${many}${con}${after}`)
}
