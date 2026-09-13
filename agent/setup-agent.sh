#!/bin/bash
# Nudge — agent-side setup (per user, once). Installs the runtime-neutral CLI,
# native Skill adapters, and optional context hooks for supported runtimes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="${1:-all}"
CLAUDE_HOME="$HOME/.claude"
CODEX_SKILLS="$HOME/.agents/skills"
CODEX_HOOKS="$HOME/.codex/hooks"
GROK_SKILLS="$HOME/.grok/skills"
BIN_HOME="$HOME/.local/bin"
LAUNCHER="$BIN_HOME/groundworks-nudge"

case "$RUNTIME" in
  all|claude-code|codex) ;;
  *) echo "usage: setup-agent.sh [all|claude-code|codex]" >&2; exit 2 ;;
esac

mkdir -p "$BIN_HOME"
if [ -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
  echo "refused: $LAUNCHER exists and is not a symlink" >&2
  exit 3
fi
ln -sfn "$HERE/groundworks-nudge.mjs" "$LAUNCHER"
chmod +x "$HERE/groundworks-nudge.mjs"

install_skill() {
  local home="$1"
  mkdir -p "$home/groundworks-nudge"
  cp "$HERE/NUDGE-SKILL.md" "$home/groundworks-nudge/SKILL.md"
}

remove_legacy_alias() {
  local legacy_dir="$1/nudge"
  local legacy_file="$legacy_dir/SKILL.md"
  [ -f "$legacy_file" ] || return 0
  if grep -Fq 'name: nudge' "$legacy_file" && grep -Fq 'Compatibility alias for groundworks-nudge' "$legacy_file"; then
    rm "$legacy_file"
    rmdir "$legacy_dir" 2>/dev/null || true
  else
    echo "preserved: $legacy_file is not the Groundworks Nudge compatibility alias" >&2
  fi
}

install_hooks() {
  local hooks_dir="$1"
  mkdir -p "$hooks_dir"
  cp "$HERE/nudge-context.mjs" "$HERE/runtime.mjs" "$HERE/nudge-session-start.sh" "$hooks_dir/"
  chmod +x "$hooks_dir/nudge-session-start.sh"
}

merge_hook_config() {
  local config_file="$1"
  local runtime_home="$2"
  NUDGE_HOOK_CONFIG="$config_file" NUDGE_RUNTIME_HOME="$runtime_home" node - <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const file = process.env.NUDGE_HOOK_CONFIG
const runtimeHome = process.env.NUDGE_RUNTIME_HOME
let settings = {}
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* fresh file */ }
settings.hooks = settings.hooks || {}
const wanted = {
  SessionStart: {
    filename: 'nudge-session-start.sh',
    command: `bash "$HOME/${runtimeHome}/hooks/nudge-session-start.sh" 2>/dev/null || true`,
  },
  UserPromptSubmit: {
    filename: 'nudge-context.mjs',
    command: `node "$HOME/${runtimeHome}/hooks/nudge-context.mjs" 2>/dev/null || true`,
  },
}
for (const [event, spec] of Object.entries(wanted)) {
  const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []
  let found = false
  const next = []
  for (const group of groups) {
    const hooks = []
    for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
      if (!String(hook.command || '').includes(spec.filename)) {
        hooks.push(hook)
      } else if (!found) {
        hooks.push({ ...hook, type: 'command', command: spec.command, timeout: 15, statusMessage: 'Nudge…' })
        found = true
      }
    }
    if (hooks.length || !Array.isArray(group.hooks)) next.push({ ...group, hooks })
  }
  if (!found) next.push({ hooks: [{ type: 'command', command: spec.command, timeout: 15, statusMessage: 'Nudge…' }] })
  settings.hooks[event] = next
}
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
console.log(`${path.basename(file)}: Nudge hooks active (SessionStart + UserPromptSubmit)`)
EOF
}

if [ "$RUNTIME" = "all" ] || [ "$RUNTIME" = "codex" ]; then
  install_skill "$CODEX_SKILLS"
  remove_legacy_alias "$CODEX_SKILLS"
  install_hooks "$CODEX_HOOKS"
  merge_hook_config "$HOME/.codex/hooks.json" ".codex"
fi

if [ "$RUNTIME" = "all" ] || [ "$RUNTIME" = "claude-code" ]; then
  install_skill "$CLAUDE_HOME/skills"
  remove_legacy_alias "$CLAUDE_HOME/skills"
  install_hooks "$CLAUDE_HOME/hooks"
  merge_hook_config "$CLAUDE_HOME/settings.json" ".claude"
fi

if [ "$RUNTIME" = "all" ]; then
  install_skill "$GROK_SKILLS"
  remove_legacy_alias "$GROK_SKILLS"
fi

echo "installed: $LAUNCHER · groundworks-nudge ($RUNTIME)"
echo
echo "Next: in an agent session on the project you want to change, invoke:"
echo "  /groundworks-nudge"
echo "Then open http://localhost:4700/demo in Chrome or Safari with Nudge installed."
echo "Safari uses the temporary developer-preview setup in docs/SAFARI.md."
echo "If the bridge is unavailable, run: groundworks-nudge ensure-bridge"
echo "Choose the armed session in the toolbar; a green Pull tag still needs a chat message."
echo "Zed: in the agent panel on that project, type /groundworks-nudge."
echo "T3 Code: open a thread on that project and type /groundworks-nudge (or pick it from \$)."
