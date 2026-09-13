/**
 * Nudge store — single owner of the store directory on disk (store.json + shots/ + inbox/ mirror).
 *
 * Reads are mtime-cached for CLI readers. The bridge acquires the canonical
 * store's single-writer lease before loading or mutating; another listening
 * port never authorizes a second writer. Failed commits invalidate this cache.
 *
 * Mutations emit change events; the bridge subscribes (WS broadcast, evidence
 * request). The store itself knows nothing about HTTP/WS/MCP.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateImage } from './images.mjs'
import { resolveStoreDir } from '../agent/runtime.mjs'

// GLOBAL, one truth for every agent runtime and every project. Existing
// ~/.claude/nudge installations remain valid; fresh installations use ~/.nudge.
// Never derive from process.cwd(). NUDGE_STORE still overrides for tests.
export const STORE_DIR = resolveStoreDir()
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
      // Additive schema: a legacy store is valid and gains receipts only on its
      // next mutation. Receipts deliberately contain no prompt content.
      if (!Array.isArray(cache.receipts)) cache.receipts = []
    } else {
      cache = { seq: seqFloorFromInbox(), pins: [], receipts: [] }
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
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    // atomic: write aside, then rename — a crash mid-write leaves the old store intact
    const tmp = STORE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
    fs.renameSync(tmp, STORE_FILE)
    cacheMtime = fs.statSync(STORE_FILE).mtimeMs
  } catch (error) {
    // Mutators change the cache before committing. A failed rename must never
    // let a retry acknowledge an in-memory receipt that did not reach disk.
    cache = null; cacheMtime = -1
    throw error
  }
}

// ---------- change events ----------
const listeners = new Set()
export const onChange = (fn) => listeners.add(fn)
const emit = (kind, pin) => { for (const fn of listeners) fn(kind, pin) }

// ---------- queries ----------
export const getPins = () => load().pins
export const getPin = (id) => load().pins.find(p => p.id === id)

// ---------- display label vs id (two jobs, deliberately split) ----------
// The ID is storage identity: filenames (inbox/nudge_N.md, shots/nudge_N.png),
// watcher dedup, provenance in CHANGELOG and commits. It must NEVER be reused —
// a manual seq reset did exactly that on 2026-07-04 and every recycled id was
// silently swallowed (see addPin). So it counts up forever and gets long.
// The LABEL is the other job: the number the user reads off the pill and types in
// chat ("Nudge 47 does that"). That one only has to be unique among what is
// OPEN — one to five items — so it may wrap: nudge_1000 shows as 1. 999 slots
// is ~11 weeks at the user's rate, far longer than a number stays on screen, so a
// label they read minutes ago can never have moved to a different nudge.
// Derived, never stored: no second counter that could drift out of sync.
const LABEL_POOL = 999
export function labelOf(id) {
  const n = Number(String(id).replace(/^(?:pin|nudge)_/, ''))
  return Number.isFinite(n) && n > 0 ? ((n - 1) % LABEL_POOL) + 1 : 0
}

// EVERY client field is untrusted input. The extension sends bounded data, but
// the bridge must stay healthy no matter what posts on the port: an uncapped
// url/target/outerHTML would bloat store.json, and every load/persist/broadcast
// pays for it forever (brutal-suite finding, 2026-07-05).
const cap = (v, n) => { const s = String(v ?? ''); return s ? s.slice(0, n) : '' }
const capOrNull = (v, n) => (v == null ? null : cap(v, n) || null)
const token = (v) => /^[A-Za-z0-9_-]{1,128}$/.test(String(v || '')) ? String(v) : null
function sanitizeBrowserSource(source) {
  if (!source || typeof source !== 'object') return null
  if (typeof source.browser !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(source.browser)) return null
  if (['session', 'tab', 'document'].some(k => typeof source[k] !== 'string' || !token(source[k]))) return null
  const browser = source.browser
  const session = token(source.session), tab = token(source.tab), document = token(source.document)
  return { browser, session, tab, document }
}
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const payloadSignature = (payload) => crypto.createHash('sha256').update(canonical({
  text: cap(payload?.text, 4000), url: cap(payload?.url, 2000), author: cap(payload?.author, 80),
  target: sanitizeTarget(payload?.target), targets: sanitizeTargets(payload?.targets),
  browserSource: sanitizeBrowserSource(payload?.browserSource), submissionCreatedAt: payload?.submissionCreatedAt || null,
  selectionGeneration: token(payload?.selectionGeneration),
  title: cap(payload?.title, 300), ua: cap(payload?.ua, 300), viewport: sanitizeRect(payload?.viewport),
  annotations: payload?.annotations || null, console: payload?.console || null,
  screenshot: payload?.screenshot || null, screenshotFull: payload?.screenshotFull || null,
})).digest('hex')
// 0.18 receipts intentionally covered fewer fields and insertion order. Keep
// their existing no-mutation replay guarantee; never call them v2 image proof.
const legacyPayloadSignature = payload => crypto.createHash('sha256').update(JSON.stringify({
  text: cap(payload?.text,4000), url: cap(payload?.url,2000), author: cap(payload?.author,80),
  target: sanitizeTarget(payload?.target), targets: sanitizeTargets(payload?.targets),
  browserSource: payload?.browserSource && typeof payload.browserSource === 'object'
    ? (() => { const s=payload.browserSource; const browser=cap(s.browser,32), session=token(s.session), tab=token(s.tab), document=token(s.document); return browser||session||tab||document ? {browser:browser||null,session,tab,document} : null })() : null,
  submissionCreatedAt: payload?.submissionCreatedAt || null,
})).digest('hex')
// owner provenance stamp: { label, session } of the agent that owned the channel
const sanitizeOwner = (o) => (o && typeof o === 'object' && (o.label || o.session))
  ? { label: cap(o.label, 60) || null, session: o.session ? cap(o.session, 128) : null }
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
// Multi-selection (Shift+click): several elements are ONE mark/prompt.
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
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'selection_conflict' }
  const browserSource = sanitizeBrowserSource(payload.browserSource)
  const selectionGeneration = typeof payload.selectionGeneration === 'string' ? token(payload.selectionGeneration) : null
  const bound = payload.browserSource != null || payload.selectionGeneration != null
  const route = value => {
    try { const u = new URL(value); return u.origin + u.pathname + u.hash } catch { return null }
  }
  const url = cap(payload.url, 2000)
  if (bound && (!browserSource || !selectionGeneration || typeof payload.url !== 'string' || payload.url.length > 2000 || !route(url))) return { error: 'selection_conflict' }
  const prev = getSelection()
  const priorBound = !!(prev?.browserSource || prev?.selectionGeneration)
  const sameRoute = !!route(url) && route(url) === route(prev?.url)
  const sameMark = bound && priorBound && sameRoute && prev.selectionGeneration === selectionGeneration
    && ['browser', 'session', 'tab', 'document'].every(key => prev.browserSource?.[key] === browserSource[key])
  // Only an explicit new mark may replace the current generation. Async image
  // delivery and ancestor retargeting are updates and must still name precisely
  // the current browser/tab/document/route/generation, before any file is touched.
  if (payload.keepShot !== false && (bound ? !sameMark : priorBound)) return { error: 'selection_conflict' }
  const crop = payload.screenshot ? validateImage(payload.screenshot) : null
  const overview = payload.screenshotFull ? validateImage(payload.screenshotFull) : null
  if (payload.screenshot != null && payload.screenshot !== '' && (!crop || crop.type !== 'png' || crop.validation !== 'decoded')) return { error: 'invalid_selection_image' }
  if (payload.screenshotFull != null && payload.screenshotFull !== '' && !overview) return { error: 'invalid_selection_image' }
  const sel = {
    at: new Date().toISOString(),
    url, title: cap(payload.title, 300),
    selector: cap(payload.target?.selector || payload.selector, 500),
    source: capOrNull(payload.target?.source || payload.source, 500),
    xpath: capOrNull(payload.target?.xpath || payload.xpath, 500),
    innerText: cap(payload.target?.innerText || payload.innerText, 300),
    outerHTML: cap(payload.target?.outerHTML || payload.outerHTML, 1200),
    styles: sanitizeStyles(payload.target?.styles || payload.styles),
    rect: sanitizeRect(payload.target?.rect || payload.rect),
    viewport: sanitizeRect(payload.viewport),
    targets: sanitizeTargets(payload.targets),
    browserSource,
    selectionGeneration,
  }
  fs.mkdirSync(STORE_DIR, { recursive: true })
  if (payload.screenshot) sel.screenshot = saveImage('selection', '', payload.screenshot, crop)
  if (payload.screenshotFull) sel.screenshotFull = saveImage('selection', '_full', payload.screenshotFull, overview)
  // Two-phase publish: a fresh pick posts data-only with keepShot:false (old
  // screenshots are STALE, the new shot lands moments later); chip retargets
  // post keepShot:true and inherit the pick-time crop (padding covers ancestors).
  if (payload.keepShot !== false && (sameMark || (!bound && !priorBound && sameRoute))) {
    if (!sel.screenshot && prev?.screenshot) sel.screenshot = prev.screenshot
    if (!sel.screenshotFull && prev?.screenshotFull) sel.screenshotFull = prev.screenshotFull
  }
  const selTmp = SELECTION_FILE + '.tmp'
  fs.writeFileSync(selTmp, JSON.stringify(sel, null, 2))
  fs.renameSync(selTmp, SELECTION_FILE)
  emit('selection', sel)
  return sel
}
export function getSelection() {
  try {
    const value = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch { return null }
}

// ---------- mutations ----------
function saveImage(id, suffix, dataUrl, validated = null) {
  const image = validated || validateImage(dataUrl)
  // Region crops/after-evidence must be decoded PNG. JPEG is accepted only as
  // the auxiliary full-viewport overview, with structural validation alone.
  // Legacy malformed image payloads keep their prompt, but gain no image proof.
  if (!image || (suffix !== '_full' && (image.type !== 'png' || image.validation !== 'decoded'))) return null
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = `${id}${suffix}.${image.type === 'jpeg' ? 'jpg' : 'png'}`
  fs.writeFileSync(path.join(SHOTS_DIR, file), image.bytes)
  return `shots/${file}`
}

// `owner` is a SEPARATE arg, never read from payload: the bridge passes the
// server-decided owner stamp so a client can NEVER inject or spoof provenance
// (bulletproof binding — 2026-07-05: "not hijacked").
export function addPin(payload, owner, receipt = null) {
  const crop = payload.screenshot ? validateImage(payload.screenshot) : null
  const overview = payload.screenshotFull ? validateImage(payload.screenshotFull) : null
  if ((receipt || payload.browserSource) && (
    (payload.screenshot != null && (!crop || crop.type !== 'png' || crop.validation !== 'decoded')) ||
    (payload.screenshotFull != null && !overview)
  )) return { error: 'invalid_submission_image' }
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
    // provenance stays put (2026-07-05: "so that it is preserved").
    owner: sanitizeOwner(owner),
    browserSource: sanitizeBrowserSource(payload.browserSource),
    selectionGeneration: token(payload.selectionGeneration),
    submissionId: token(payload.submissionId),
    submissionCreatedAt: token(payload.submissionId) ? capOrNull(payload.submissionCreatedAt, 40) : null,
    viewport: sanitizeRect(payload.viewport),
    target: sanitizeTarget(payload.target),
    targets: sanitizeTargets(payload.targets),
    annotations: (() => { try { return payload.annotations && JSON.stringify(payload.annotations).length <= 100_000 ? payload.annotations : null } catch { return null } })(),
    console: Array.isArray(payload.console) ? payload.console.slice(-20).map(l => cap(l, 500)) : null,
  }
  if (payload.screenshot) pin.screenshot = saveImage(id, '', payload.screenshot, crop)
  if (payload.screenshotFull) pin.screenshotFull = saveImage(id, '_full', payload.screenshotFull, overview)
  s.pins.push(pin)
  // The pin and its idempotency receipt must reach disk in the SAME rename.
  // A crash between two writes otherwise leaves delivered work without its
  // receipt and a retry creates a second pin.
  if (receipt) s.receipts.push({ ...receipt, id: pin.id })
  persist()
  emit('added', pin) // wake FIRST — the inbox mirror is a convenience artifact
  writeInboxMirror(pin)
  return pin
}

// Exactly-once delivery for modern browser queues. The receipt's signature is
// enough to distinguish a harmless retry from a caller reusing an id for a
// different prompt; it intentionally never retains prompt text.
export function submitPin(payload, owner, now = Date.now()) {
  if (typeof payload?.submissionId !== 'string') return { error: 'invalid_submission_id' }
  if (typeof payload?.submissionCreatedAt !== 'string' || payload.submissionCreatedAt.length > 40) return { error: 'invalid_submission_time' }
  const submissionId = token(payload?.submissionId)
  if (!submissionId) return { error: 'invalid_submission_id' }
  const createdAt = Date.parse(payload?.submissionCreatedAt || '')
  if (!Number.isFinite(createdAt) || createdAt > now + 5 * 60_000 || createdAt < now - 7 * 24 * 3600e3) return { error: 'invalid_submission_time' }
  const s = load(), signature = payloadSignature(payload)
  const prior = s.receipts.find(r => r.submissionId === submissionId)
  if (prior) {
    const expected = prior.signatureVersion === 2 ? signature : legacyPayloadSignature(payload)
    if (prior.signature !== expected) return { error: 'submission_conflict' }
    return { pin: getPin(prior.id) || null, id: prior.id, replay: true, withdrawn: !!prior.withdrawn }
  }
  const pin = addPin(payload, owner, { submissionId, signature, signatureVersion: 2, createdAt: payload.submissionCreatedAt, withdrawn: false })
  if (pin.error) return pin
  return { pin, id: pin.id, replay: false, withdrawn: false }
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

// Append a follow-up to an OPEN nudge (the user: "the prompt is already sent,
// I want to add something to the same nudge"). Append-only: the original text
// is immutable (provenance); follow-ups accrue in `amendments`. Re-wakes the
// owning agent (the watcher's key changes) and re-mirrors the inbox. A resolved
// nudge is NOT reopened — that would resurrect a done item into the queue.
export function amendPin(id, { text, author } = {}) {
  const pin = getPin(id)
  if (!pin) return { error: 'not_found' }
  if (pin.status !== 'open') return { error: 'resolved' }
  const t = cap(text, 4000).trim()
  if (!t) return { error: 'empty' }
  pin.amendments = pin.amendments || []
  pin.amendments.push({ text: t, at: new Date().toISOString(), author: cap(author, 80) || null })
  persist()
  emit('amended', pin) // re-wake the owning agent + refresh the clients' History
  writeInboxMirror(pin)
  return { pin }
}

// Discard (queue-popover ×): the prompt was a slip / is obsolete — remove it
// entirely, evidence files included. Unlike resolve this is NOT a work outcome;
// nothing is kept. seq is untouched (ids are never reused).
//
// WITHDRAWAL (2026-07-29): a nudge reaches its agent within MILLISECONDS, so by
// the time the user hits × the work is usually already running. Deleting the pin
// used to be the whole story — the agent was never told and kept going, finding
// out only via a 404 on resolve, after the work was done. So a discard now
// leaves ONE marker behind: the pin content still goes (a slip must not linger),
// but `inbox/<id>.withdrawn.md` records THAT it was pulled, when, and whose. The
// live channel is the bridge's WS frame; this file is the durable trace an agent
// can still check on its next prompt (UserPromptSubmit hook reads it).
export function deletePin(id) {
  const s = load()
  const i = s.pins.findIndex(p => p.id === id)
  if (i < 0) return null
  const [pin] = s.pins.splice(i, 1)
  for (const receipt of s.receipts || []) if (receipt.id === id) receipt.withdrawn = true
  persist()
  for (const f of [`${id}.png`, `${id}_full.jpg`, `${id}_after.png`]) {
    try { fs.unlinkSync(path.join(SHOTS_DIR, f)) } catch { /* not there */ }
  }
  try { fs.unlinkSync(path.join(INBOX_DIR, `${id}.md`)) } catch { /* not there */ }
  pin.withdrawnAt = new Date().toISOString()
  // only an OPEN nudge is work-in-flight; discarding a resolved one is pure
  // housekeeping and needs no marker (nobody is working on it)
  if (pin.status === 'open') writeWithdrawnMarker(pin)
  emit('deleted', pin)
  return pin
}

// The marker deliberately carries NO prompt text — the point of a discard is
// that the content goes. Id, label, route and time are enough for an agent to
// match it against what it is holding in context and stop.
function writeWithdrawnMarker(pin) {
  try {
    fs.mkdirSync(INBOX_DIR, { recursive: true })
    fs.writeFileSync(path.join(INBOX_DIR, `${pin.id}.withdrawn.md`),
      `# ${pin.id} (#${labelOf(pin.id)}) - withdrawn\n\n`
      + `The user withdrew this nudge. Stop work on it IMMEDIATELY, do not commit, do not resolve.\n\n`
      + `- withdrawn: ${pin.withdrawnAt}\n- created: ${pin.createdAt}\n- url: ${pin.url}\n`
      + `- selector: \`${pin.target?.selector || '-'}\`\n`
      + (pin.owner?.label ? `- agent: ${pin.owner.label}\n` : '')
      + (pin.owner?.session ? `- session: ${pin.owner.session}\n` : ''))
  } catch { /* readonly fs — the WS frame still carries the withdrawal */ }
}

export function attachAfterShot(id, screenshot, provenance = null) {
  const pin = getPin(id)
  if (!pin || pin.status !== 'resolved' || !pin.screenshot) return { error: 'not_eligible' }
  if (pin.browserSource) {
    const got = sanitizeBrowserSource(provenance?.browserSource)
    const expected = pin.browserSource
    const original = sanitizeBrowserSource(provenance?.expectedBrowserSource)
    const successor = original && ['browser', 'session', 'tab', 'document'].every(k => original[k] === expected[k])
    if (!got || (successor ? ['browser', 'session', 'tab'] : ['browser', 'session', 'tab', 'document']).some(k => expected[k] !== got[k])) return { error: 'provenance_conflict' }
  }
  const image = validateImage(screenshot)
  if (!image || image.type !== 'png' || image.validation !== 'decoded') return { error: 'invalid_image' }
  const imageHash = crypto.createHash('sha256').update(String(screenshot)).digest('hex')
  if (pin.screenshotAfter) {
    if (pin.afterImageHash === imageHash) return { pin, duplicate: true }
    // Historical legacy records have no hash. Compare only their canonical
    // stored file, without rewriting the record or inventing source evidence.
    if (!pin.browserSource && !pin.afterImageHash && /^(?:pin|nudge)_\d+$/.test(pin.id)
      && pin.screenshotAfter === `shots/${pin.id}_after.png`) {
      try {
        const file = path.join(SHOTS_DIR, `${pin.id}_after.png`)
        if (fs.statSync(file).size === image.bytes.length && fs.readFileSync(file).equals(image.bytes))
          return { pin, duplicate: true }
      } catch { /* Missing evidence remains a conflict, not a new capture. */ }
    }
    return { error: 'evidence_conflict' }
  }
  const saved = saveImage(id, '_after', screenshot, image)
  if (!saved) return { error: 'invalid_image' }
  pin.screenshotAfter = saved
  pin.afterImageHash = imageHash
  if (pin.browserSource) pin.afterBrowserSource = sanitizeBrowserSource(provenance?.browserSource)
  persist()
  writeInboxMirror(pin)
  emit('evidence', pin)
  return { pin, duplicate: false }
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

// Keep non-content receipts through the complete retry horizon plus clock
// allowance. Delayed original requests remain expired after their receipt goes.
// Unknown timestamps fail closed: do not discard a receipt we cannot age.
export function pruneReceipts(now = Date.now()) {
  const s = load()
  const keep = s.receipts.filter(receipt => {
    const at = Date.parse(receipt.createdAt || '')
    return !Number.isFinite(at) || now <= at + 7 * 24 * 3600e3 + 5 * 60_000
  })
  const removed = s.receipts.length - keep.length
  if (removed) { s.receipts = keep; persist() }
  return removed
}

// Withdrawal markers are orphan files (their pin is gone), so pruneResolved can
// never reach them. They exist to be read once, on the agent's next prompt —
// past a day they are noise, and the hook that reads them runs on EVERY prompt
// in EVERY project, so the directory must not grow without bound.
export function pruneWithdrawn(maxAgeMs = 24 * 3600e3) {
  const cutoff = Date.now() - maxAgeMs
  let n = 0
  try {
    for (const f of fs.readdirSync(INBOX_DIR)) {
      if (!f.endsWith('.withdrawn.md')) continue
      const p = path.join(INBOX_DIR, f)
      try { if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); n++ } } catch { /* raced */ }
    }
  } catch { /* no inbox yet */ }
  return n
}

// ---------- projections (one per consumer, together on purpose) ----------
/** HTTP GET /comments — structured summary for scripts/tools. */
export function pinSummary(p) {
  return { id: p.id, label: labelOf(p.id), status: p.status, author: p.author, owner: p.owner?.label, text: p.text, amendments: p.amendments || undefined, url: p.url, selector: p.target?.selector, source: p.target?.source, targets: p.targets?.length || undefined, hasConsole: !!p.console?.length, hasEvidence: !!p.screenshotAfter, createdAt: p.createdAt, browserSource: p.browserSource || undefined, afterBrowserSource: p.afterBrowserSource || undefined }
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
  const text = !p.text ? `[${markLabel(p)} — "this one"]` : (p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text)
  const n = p.targets?.length ? ` · ${p.targets.length} elements` : ''
  // id first (that is what commits and the inbox use), label in brackets — the
  // agent needs both to map "Nudge 47" onto the file it has to open
  return `${p.id} (#${labelOf(p.id)}) · ${p.status} · ${text}${n} · ${route}`
}
/** WS push — what the extension needs for badge, queue popover + open-prompt dots. */
export function pinForClient(p) {
  return {
    // label = the short number on the pill; id stays the identity behind it
    id: p.id, label: labelOf(p.id), status: p.status, author: p.author, owner: p.owner || null, text: p.text, url: p.url, createdAt: p.createdAt, resolvedAt: p.resolvedAt,
    amendments: p.amendments?.map(a => ({ text: a.text, at: a.at })) || undefined, // the user's follow-ups on this nudge
    screenshot: p.screenshot, screenshotAfter: p.screenshotAfter,
    browserSource: p.browserSource || undefined,
    isRegion: p.annotations?.some(a => a.type === 'lasso') || false,
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
  const provenance = pin.browserSource ? `\n- browser provenance: \`${JSON.stringify(pin.browserSource)}\`` : '\n- browser provenance: legacy / unverified'
  const afterProvenance = pin.afterBrowserSource ? `\n- after provenance: \`${JSON.stringify(pin.afterBrowserSource)}\`` : ''
  const con = pin.console?.length ? `\n\n## Console\n\`\`\`\n${pin.console.join('\n')}\n\`\`\`\n` : ''
  const many = pin.targets?.length
    ? `\n\n## Elements (${pin.targets.length})\n${pin.targets.map((t, i) => `${i + 1}. \`${t.selector}\`${t.source ? ` — \`${t.source}\`` : ''}`).join('\n')}\n`
    : ''
  const after = pin.screenshotAfter ? `\n## Evidence (after)\n\n![after](../${pin.screenshotAfter})\n` : ''
  const quote = pin.text || `_(${markLabel(pin)} — reference for "this one" in chat)_`
  // follow-ups the user appended after sending — same nudge, later thoughts
  const amends = pin.amendments?.length
    ? '\n' + pin.amendments.map(a => `\n> **Amendment${a.at ? ` (${a.at.slice(11, 16)})` : ''}:** ${a.text}`).join('') + '\n'
    : ''
  fs.writeFileSync(path.join(INBOX_DIR, `${pin.id}.md`),
    // heading carries BOTH: the id (this file's name, what commits cite) and the
    // label the user saw on the pill — so "Nudge 47" is greppable back to nudge_1047
    `# ${pin.id} (#${labelOf(pin.id)}) - ${pin.status}\n\n> ${quote}\n${amends}\n- url: ${pin.url}\n- selector: \`${pin.target?.selector || '-'}\`${src}${who}${owns}${provenance}${afterProvenance}\n- created: ${pin.createdAt}\n${pin.screenshot ? `\n![screenshot](../${pin.screenshot})\n` : ''}${many}${con}${after}`)
}
