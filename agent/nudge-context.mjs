// UserPromptSubmit hook (USER-LEVEL: runs in every project) — Pin: ONLY two
// things matter on every message: (1) does the chain work, (2) what is marked
// RIGHT NOW. No backlog listing — older prompts live behind /pins on demand.
// The current mark is the NEWEST pin regardless of status (a just-answered mark
// stays the referent for follow-ups) within a 15-minute freshness window.
// Store is GLOBAL (~/.claude/nudge) — one truth for every agent in every project.
// Exits silently when Pin is not in play (no store at all).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PIN_DIR = path.join(os.homedir(), '.claude', 'nudge')

let store = null
try { store = JSON.parse(fs.readFileSync(path.join(PIN_DIR, 'store.json'), 'utf8')) } catch { /* no store yet */ }
let selection = null
try { selection = JSON.parse(fs.readFileSync(path.join(PIN_DIR, 'selection.json'), 'utf8')) } catch { /* none yet */ }
if (!store && !selection) process.exit(0)

let status = 'Bridge ✗ (nicht erreichbar)'
try {
  const res = await fetch('http://127.0.0.1:4700/.identity', { signal: AbortSignal.timeout(400) })
  const id = await res.json()
  status = id.agentLive ? `Bridge ✓ · Agent-Watch ✓ (${id.agentLabel || 'unbenannt'})` : 'Bridge ✓ · Agent-Watch ✗ — Prompts werden nur gespeichert! Watcher armen (nudge-Skill Watch mode).'
} catch { /* bridge down */ }

const pins = store?.pins || []
const newestPin = [...pins].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
const selAt = selection ? Date.parse(selection.at) : 0
const pinAt = newestPin ? Date.parse(newestPin.createdAt) : 0
const useSel = selAt >= pinAt
const when = useSel ? selAt : pinAt
const age = when ? Math.max(0, Math.round((Date.now() - when) / 60000)) : Infinity

const routeOf = (u) => { try { const x = new URL(u); return (x.host + x.pathname + x.search + x.hash).slice(0, 70) } catch { return String(u).slice(0, 70) } }
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
      `AKTUELLE MARKIERUNG (${newestPin.id}, vor ${age} min): ${text}`,
      `  Element: ${newestPin.targets?.length ? `${newestPin.targets.length} Elemente (${newestPin.targets.map(t => t.selector).join(' · ').slice(0, 120)})` : newestPin.target?.selector || '?'} · ${routeOf(newestPin.url)}${newestPin.status === 'resolved' ? ' · bereits beantwortet' : ''}`,
      `Sagt Gerald „das hier"/„diese Stelle", meint er DIESE Markierung. Screenshot: ~/.claude/nudge/shots/${newestPin.id}.png`,
    )
  }
} else {
  lines.push('Keine aktuelle Markierung (Fenster: 15 min).')
}
const openCount = pins.filter(p => p.status === 'open').length
if (openCount > 0) lines.push(`Warteschlange: ${openCount} offene${openCount === 1 ? 'r' : ''} Prompt${openCount === 1 ? '' : 's'} — oldest-first abarbeiten (/pins).`)

console.log(JSON.stringify({
  suppressOutput: true,
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') },
}))
