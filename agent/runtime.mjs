import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const clean = (value, limit) => String(value || '').trim().slice(0, limit) || null

/**
 * One store for every agent runtime.
 *
 * Existing installations keep using ~/.claude/nudge until they are migrated.
 * Fresh installations use ~/.nudge. NUDGE_STORE remains the explicit override
 * for tests and managed installations.
 */
export function resolveStoreDir({ env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (env.NUDGE_STORE) return path.resolve(env.NUDGE_STORE)

  const neutral = path.join(home, '.nudge')
  const legacy = path.join(home, '.claude', 'nudge')
  if (exists(neutral) && exists(legacy)) {
    let same = false
    try { same = fs.realpathSync(neutral) === fs.realpathSync(legacy) } catch { /* report conflict below */ }
    if (!same) throw new Error(`Nudge store conflict: both ${neutral} and ${legacy} exist. Set NUDGE_STORE explicitly; no data was merged.`)
  }
  if (exists(neutral)) return neutral
  if (exists(legacy)) return legacy
  return neutral
}

/** Runtime adapters normalize their native session id here. */
export function resolveAgentId(env = process.env) {
  return clean(env.NUDGE_AGENT_ID, 128)
    || clean(env.CODEX_THREAD_ID, 128)
    || clean(env.CODEX_SESSION_ID, 128)
    || clean(env.CLAUDE_CODE_SESSION_ID, 128)
}

/** Runtime and surface are deliberately separate; an editor is not an agent. */
export function resolveAgentRuntime(env = process.env) {
  if (clean(env.NUDGE_AGENT_RUNTIME, 20)) return clean(env.NUDGE_AGENT_RUNTIME, 20)
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'Codex'
  if (env.CLAUDE_CODE_SESSION_ID) return 'Claude Code'
  return 'Agent'
}

export function resolveAgentSurface(env = process.env) {
  if (clean(env.NUDGE_AGENT_SURFACE, 20)) return clean(env.NUDGE_AGENT_SURFACE, 20)
  return env.ZED_ENVIRONMENT ? 'Zed' : 'CLI'
}

/** Missing or invalid wake capability is always pull. */
export function resolveWake(env = process.env) {
  return env.NUDGE_WAKE === 'push' ? 'push' : 'pull'
}
