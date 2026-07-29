// UserPromptSubmit hook (USER-LEVEL: runs in every project) — Nudge: ONLY two
// things matter on every message: (1) does the chain work, (2) what is marked
// RIGHT NOW. No backlog listing — older prompts live behind /pins on demand.
// The current mark is the NEWEST pin regardless of status (a just-answered mark
// stays the referent for follow-ups) within a 15-minute freshness window.
// Store is GLOBAL (~/.claude/nudge) — one truth for every agent in every project.
//
// OPT-IN GATE (immanent, 2026-07-05): this hook runs in EVERY session, but only
// a session that PARTICIPATES in Nudge may see Nudge context — one that invoked
// /nudge and thereby armed a watcher, so its CLAUDE_CODE_SESSION_ID is in the
// bridge roster. Every other session (a CI agent, an unrelated task) gets TOTAL
// SILENCE. Before, any existing global store leaked status + mark + queue into
// every agent, and a foreign agent adopted the owner's session as its own
// (Gerald's screenshot: „Die neuen Nudges gehören der suite-e-Session"). No
// roster membership, no output — full stop.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.NUDGE_PORT || 4700)
const PIN_DIR = process.env.NUDGE_STORE || path.join(os.homedir(), '.claude', 'nudge')

// Gerald's prompt (hook stdin JSON) — scanned for nudge references („Nudge 123",
// „nudge_123", „#123"): a named nudge gets its FULL context injected right here,
// so referencing marked numbers is instant — no wake, no skill ceremony.
let promptText = ''
try { promptText = String(JSON.parse(fs.readFileSync(0, 'utf8')).prompt || '') } catch { /* no stdin payload */ }

let store = null
try { store = JSON.parse(fs.readFileSync(path.join(PIN_DIR, 'store.json'), 'utf8')) } catch { /* no store yet */ }
let selection = null
try { selection = JSON.parse(fs.readFileSync(path.join(PIN_DIR, 'selection.json'), 'utf8')) } catch { /* none yet */ }
if (!store && !selection) process.exit(0)

// The gate: is THIS session armed? Ask the bridge for the roster and match our
// own session id. Bridge down / no session id / not in roster → silent exit.
// (A just-typed /nudge is not armed YET — the skill arms it; context appears on
// the NEXT prompt. The skill itself surfaces everything on that first run.)
const mySession = (process.env.CLAUDE_CODE_SESSION_ID || '').slice(0, 8)
const hostOf = (u) => { try { return new URL(u).host } catch { return '' } }
let status, identity
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/.identity`, { signal: AbortSignal.timeout(400) })
  identity = await res.json()
  const armed = mySession && (identity.agents || []).some(a => a.session === mySession)
  if (!armed) process.exit(0) // this session does not participate in Nudge — say nothing
  status = identity.agentLive ? `Bridge ✓ · Agent-Watch ✓ (${identity.agentLabel || 'unbenannt'})` : 'Bridge ✓ · Agent-Watch ✗ — Nudges werden nur gespeichert.'
} catch {
  process.exit(0) // bridge unreachable → can't prove participation → stay silent
}

// ORIGIN-AWARE (2026-07-07): this session sees only ITS OWN nudges (a nudge is
// stamped by the bridge with the agent that owns its host) and only a selection
// on a host it owns — so parallel dev servers don't leak marks into the wrong agent.
const myKey = mySession ? `s:${mySession}` : null
const ownersMap = new Map(identity.owners || [])
const agentKeyOf = (a) => a.session ? `s:${a.session}` : `p:${a.pid}`
const ownsHost = (host) => {
  const key = ownersMap.get(host) || ownersMap.get('*')
  if (key) return key === myKey
  const newest = (identity.agents || []).reduce((a, b) => (!a || b.since >= a.since ? b : a), null)
  return !!newest && agentKeyOf(newest) === myKey
}
// mine = stamped to me, OR ownerless (offline arrival) but on a host I own
const pins = (store?.pins || []).filter(p => (p.owner?.session === mySession) || (!p.owner?.session && ownsHost(hostOf(p.url))))
if (selection && !ownsHost(hostOf(selection.url))) selection = null
const newestPin = [...pins].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
const selAt = selection ? Date.parse(selection.at) : 0
const pinAt = newestPin ? Date.parse(newestPin.createdAt) : 0
const useSel = selAt >= pinAt
const when = useSel ? selAt : pinAt
const age = when ? Math.max(0, Math.round((Date.now() - when) / 60000)) : Infinity

const routeOf = (u) => { try { const x = new URL(u); return (x.host + x.pathname + x.search + x.hash).slice(0, 70) } catch { return String(u).slice(0, 70) } }
// The number on the pill — bounded, wraps at 999 (mirror of store.mjs labelOf;
// the hook reads store.json directly and imports nothing from the bridge). The
// id keeps counting forever and stays the identity in files and commits.
const LABEL_POOL = 999
const labelOf = (id) => {
  const n = Number(String(id).replace(/^(?:pin|nudge)_/, ''))
  return Number.isFinite(n) && n > 0 ? ((n - 1) % LABEL_POOL) + 1 : 0
}
const lines = [`[Nudge] ${status}`]
if (age <= 15 && (useSel ? selection : newestPin)) {
  // multi-selection (Shift+Klick): several elements are ONE mark
  const multiLine = (targets) => targets?.length
    ? `  ${targets.length} Elemente: ${targets.map(t => t.selector).join(' · ').slice(0, 160)}` : null
  if (useSel) {
    lines.push(
      `AKTUELLE MARKIERUNG (Selektion, vor ${age} min): ${selection.targets?.length ? `${selection.targets.length} Elemente` : selection.selector || '?'}${selection.source ? ` (${selection.source})` : ''}`,
      ...(multiLine(selection.targets) ? [multiLine(selection.targets)] : []),
      `  Seite: ${routeOf(selection.url)}${selection.innerText ? ` · Text: „${selection.innerText.slice(0, 80)}"` : ''}${selection.screenshot ? ' · Screenshot: ~/.claude/nudge/shots/selection.png' : ''}`,
      `Sagt Gerald „das hier"/„diese Stelle", meint er DIESE Markierung. Details: ~/.claude/nudge/selection.json`,
    )
  } else {
    const text = newestPin.text ? `„${newestPin.text.slice(0, 120)}"` : '[Nur Markierung]'
    lines.push(
      `AKTUELLE MARKIERUNG (${newestPin.id}, Pille #${labelOf(newestPin.id)}, vor ${age} min): ${text}`,
      `  Element: ${newestPin.targets?.length ? `${newestPin.targets.length} Elemente (${newestPin.targets.map(t => t.selector).join(' · ').slice(0, 120)})` : newestPin.target?.selector || '?'} · ${routeOf(newestPin.url)}${newestPin.status === 'resolved' ? ' · bereits beantwortet' : ''}`,
      `Sagt Gerald „das hier"/„diese Stelle", meint er DIESE Markierung. Screenshot: ~/.claude/nudge/shots/${newestPin.id}.png`,
    )
  }
} else {
  lines.push('Keine aktuelle Markierung (Fenster: 15 min).')
}
// ---------- referenced nudges: „Nudge 123 macht das" pulls 123's context into
// THIS prompt. Lookup over ALL pins, not the origin-filtered list — Gerald typed
// the id in THIS session, so the explicit naming beats the origin stamp.
const referenced = []
const addRef = (n) => { const v = String(Number(n)); if (v !== 'NaN' && !referenced.includes(v)) referenced.push(v) }
for (const m of promptText.matchAll(/\b(?:nudges?|pins?)[\s_#-]*(\d{1,6})((?:\s*(?:,|und|and|&|\+)\s*#?\d{1,6})*)/gi)) {
  addRef(m[1])
  for (const n of (m[2] || '').matchAll(/\d{1,6}/g)) addRef(n[0]) // „Nudge 12, 14 und 15"
}
for (const m of promptText.matchAll(/(?:^|\s)#(\d{1,6})\b/g)) addRef(m[1])
const allPins = store?.pins || []
// A typed number is the LABEL first — the number on the pill, which is what
// Gerald reads off the page — and the raw id second. Order matters once ids pass
// 999 and the two can collide: an OPEN nudge he is looking at beats a
// long-resolved nudge_47 from eleven weeks ago. Below 999 both rules agree, so
// nothing changes for today's ids.
const resolveRef = (n) => {
  const num = Number(n)
  // findLast on the open pass: if two open nudges ever share a label (999 apart,
  // practically impossible) the NEWER one is the one on screen
  return allPins.findLast(p => p.status === 'open' && labelOf(p.id) === num)
    || allPins.find(p => p.id === `nudge_${n}` || p.id === `pin_${n}`)
    || allPins.findLast(p => labelOf(p.id) === num)
    || null
}
// ---------- withdrawals: „Gerald hat × gedrückt" ----------------------------
// A discarded nudge leaves inbox/<id>.withdrawn.md behind (store.deletePin).
// The live channel is the watcher's WS frame — but a CLI session (wake: 'pull')
// has no autonomous wake, so THIS is where it learns. Read once, here, before
// anything else claims work is outstanding.
const withdrawn = []
try {
  for (const f of fs.readdirSync(path.join(PIN_DIR, 'inbox'))) {
    const id = f.match(/^((?:pin|nudge)_\d+)\.withdrawn\.md$/)?.[1]
    if (!id) continue
    const md = fs.readFileSync(path.join(PIN_DIR, 'inbox', f), 'utf8')
    const at = md.match(/^- withdrawn: (.+)$/m)?.[1] || null
    const session = md.match(/^- session: (.+)$/m)?.[1] || null
    // mine, or ownerless-but-on-a-host-I-own — same gate as the pin list above
    if (!(session ? session === mySession : ownsHost(hostOf(md.match(/^- url: (.+)$/m)?.[1] || '')))) continue
    withdrawn.push({ id, at, label: md.match(/^# \S+ \(#(\d+)\)/m)?.[1] || labelOf(id), url: md.match(/^- url: (.+)$/m)?.[1] || '' })
  }
} catch { /* no inbox yet */ }
// only FRESH ones (30 min): past that the work is long done either way, and a
// stale „stop" line on every prompt would be noise
const freshWithdrawn = withdrawn.filter(w => !w.at || Date.now() - Date.parse(w.at) < 30 * 60_000)
if (freshWithdrawn.length) {
  lines.push(`ZURÜCKGEZOGEN (${freshWithdrawn.length}) — Gerald hat diese Nudges verworfen. Arbeit daran SOFORT einstellen, nichts committen, nicht resolven:`)
  for (const w of freshWithdrawn) lines.push(`  #${w.label} (${w.id})${w.at ? ` · ${w.at.slice(11, 16)}` : ''} · ${routeOf(w.url)}`)
}
const refPins = []
for (const n of referenced) {
  const p = resolveRef(n)
  if (!p) {
    // „nie existiert" and „verworfen" are different answers — the marker file
    // makes the second one provable instead of a guess
    const w = withdrawn.find(x => x.id === `nudge_${n}` || x.id === `pin_${n}` || String(x.label) === String(Number(n)))
    lines.push(w
      ? `Nudge ${n} (${w.id}): ZURÜCKGEZOGEN${w.at ? ` um ${w.at.slice(11, 16)}` : ''} — Gerald hat ihn verworfen, nicht bearbeiten.`
      : `Nudge ${n}: nicht im Store (nie existiert oder verworfen).`)
    continue
  }
  if (!refPins.includes(p)) refPins.push(p)
}
// ---------- referenced by ELEMENT TEXT: „der Nudge am Speichern-Button" ------
// Gerald looks at the page, not at numbers. The marked element's own words are
// already in the store, so naming them resolves too. Deliberately tight — this
// hook runs on EVERY prompt in EVERY project, and a wrong hit injects the wrong
// nudge into unrelated work: open nudges only, button-/label-sized text (5..40
// chars, not purely numeric), word-bounded, exactly ONE match, and only when no
// number was named (an explicit number is always the better answer).
if (!refPins.length) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hits = allPins.filter(p => {
    if (p.status !== 'open') return false
    const t = norm(p.target?.innerText)
    if (t.length < 5 || t.length > 40 || /^\d+$/.test(t)) return false
    try { return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t)}([^\\p{L}\\p{N}]|$)`, 'iu').test(promptText) } catch { return false }
  })
  if (hits.length === 1) refPins.push(hits[0])
}
for (const p of refPins) {
  const text = p.text ? `„${p.text.slice(0, 200)}"` : '[Nur Markierung — der Prompt hier IST der Arbeitsauftrag]'
  const els = p.targets?.length
    ? `${p.targets.length} Elemente: ${p.targets.map(t => t.selector).join(' · ').slice(0, 160)}`
    : (p.target?.selector || '?')
  const extra = [
    p.owner?.label ? `Agent: ${p.owner.label}` : null,
    p.amendments?.length ? `${p.amendments.length} Nachtrag/Nachträge` : null,
  ].filter(Boolean).join(' · ')
  lines.push(
    `REFERENZIERT ${p.id} (#${labelOf(p.id)}, ${p.status === 'open' ? 'offen' : 'bereits resolved'}): ${text}`,
    `  Element: ${els} · ${routeOf(p.url)}${p.target?.innerText ? ` · Text: „${p.target.innerText.slice(0, 60)}"` : ''}${extra ? ` · ${extra}` : ''}`,
    `  Details: ~/.claude/nudge/inbox/${p.id}.md${p.screenshot ? ` · Screenshot: ~/.claude/nudge/${p.screenshot}` : ''}`,
  )
}

// ---------- open queue: a compact, REFERENCEABLE list (id + gist + route) so
// „Nudge 123" works without Gerald memorizing numbers. [Mark]-Zeilen sind
// Referenz-Anker (Nummern-Pille auf der Seite), keine Arbeitsaufträge.
const open = pins.filter(p => p.status === 'open')
if (open.length) {
  lines.push(`Offene Nudges (${open.length}) — explizit genannte IDs zuerst, sonst oldest-first (/nudge); [Mark] = nur Anker.`)
  // #N ist die Pillen-Nummer auf der Seite (das, was Gerald sagt), nudge_N die
  // Identität dahinter (Dateien, Commits, CHANGELOG) — beide in einer Zeile,
  // damit der Agent von der gesagten Nummer direkt auf die inbox-Datei kommt.
  lines.push('  Format: #Pillennummer (id) · Gist · Route')
  for (const p of open.slice(0, 10)) {
    const gist = p.text
      ? `„${p.text.slice(0, 60)}${p.text.length > 60 ? '…' : ''}"`
      : `[Mark: ${(p.target?.innerText || p.target?.selector || '?').trim().slice(0, 40)}]`
    lines.push(`  #${labelOf(p.id)} (${p.id}) · ${gist} · ${routeOf(p.url)}`)
  }
  if (open.length > 10) lines.push(`  … +${open.length - 10} weitere`)
}

console.log(JSON.stringify({
  suppressOutput: true,
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') },
}))
