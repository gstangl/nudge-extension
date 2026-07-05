#!/bin/bash
# Nudge — agent-side setup (per user, once). Installs the /nudge skill, the two
# hooks and their settings.json entries into ~/.claude. Idempotent: existing
# hook entries are not duplicated; other settings stay untouched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"

mkdir -p "$CLAUDE/hooks" "$CLAUDE/skills/nudge" "$CLAUDE/pin"
cp "$HERE/nudge-context.mjs" "$HERE/nudge-session-start.sh" "$CLAUDE/hooks/"
chmod +x "$CLAUDE/hooks/nudge-session-start.sh"
cp "$HERE/NUDGE-SKILL.md" "$CLAUDE/skills/nudge/SKILL.md"

node - <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const file = path.join(process.env.HOME, '.claude', 'settings.json')
let s = {}
try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* fresh file */ }
s.hooks = s.hooks || {}
const want = {
  SessionStart: 'bash "$HOME/.claude/hooks/nudge-session-start.sh" 2>/dev/null || true',
  UserPromptSubmit: 'node "$HOME/.claude/hooks/nudge-context.mjs" 2>/dev/null || true',
}
for (const [event, command] of Object.entries(want)) {
  s.hooks[event] = s.hooks[event] || []
  const exists = s.hooks[event].some(g => (g.hooks || []).some(h => (h.command || '').includes('nudge-')))
  if (!exists) s.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 15, statusMessage: 'Nudge…' }] })
}
fs.writeFileSync(file, JSON.stringify(s, null, 2))
console.log('settings.json: Nudge-Hooks aktiv (SessionStart + UserPromptSubmit)')
EOF

echo "fertig: Skill ~/.claude/skills/nudge · Hooks ~/.claude/hooks/pins-* · Store ~/.claude/nudge"
