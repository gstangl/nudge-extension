import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SETUP = path.join(HERE, '../agent/setup-agent.sh')
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-setup-'))
const ENV = { ...process.env, HOME: HOME_DIR }
const fail = (message) => { throw new Error(message) }
const pass = (message) => console.log(`PASS ${message}`)

try {
  for (const [file, marker] of [
    ['.claude/settings.json', 'keep-claude'],
    ['.codex/hooks.json', 'keep-codex'],
  ]) {
    const target = path.join(HOME_DIR, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({
      preserved: marker,
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `echo ${marker}` }] }] },
    }))
  }
  for (const skillsHome of ['.claude/skills', '.agents/skills', '.grok/skills']) {
    const alias = path.join(HOME_DIR, skillsHome, 'nudge/SKILL.md')
    fs.mkdirSync(path.dirname(alias), { recursive: true })
    fs.writeFileSync(alias, '---\nname: nudge\ndescription: "Compatibility alias for groundworks-nudge."\n---\n')
    const stale = path.join(HOME_DIR, skillsHome, 'groundworks-nudge/SKILL.md')
    fs.mkdirSync(path.dirname(stale), { recursive: true })
    fs.writeFileSync(stale, '---\nname: groundworks-nudge\ndescription: "Stale installation fixture."\n---\n')
  }

  execFileSync('bash', [SETUP, 'all'], { env: ENV, stdio: 'pipe' })
  execFileSync('bash', [SETUP, 'all'], { env: ENV, stdio: 'pipe' })

  const launcher = path.join(HOME_DIR, '.local/bin/groundworks-nudge')
  if (!fs.lstatSync(launcher).isSymbolicLink()) fail('neutral CLI launcher was not installed as a symlink')
  const help = execFileSync(launcher, ['help'], { env: ENV, encoding: 'utf8' })
  if (!help.includes('watch --label') || !help.includes('resolve')) fail('installed launcher does not expose the neutral CLI')
  pass('runtime-neutral CLI launcher installs and runs')

  for (const home of [
    path.join(HOME_DIR, '.claude/skills'),
    path.join(HOME_DIR, '.agents/skills'),
    path.join(HOME_DIR, '.grok/skills'),
  ]) {
    const main = fs.readFileSync(path.join(home, 'groundworks-nudge/SKILL.md'), 'utf8')
    if (main !== fs.readFileSync(path.join(HERE, '../agent/NUDGE-SKILL.md'), 'utf8')) fail(`Skill differs from repository source in ${home}`)
    if (fs.existsSync(path.join(home, 'nudge/SKILL.md'))) fail(`legacy alias remains in ${home}`)
  }
  pass('Claude Code, Codex and Grok replace stale Skills with exact canonical copies')

  for (const [runtime, configFile, hooksDir] of [
    ['Claude Code', '.claude/settings.json', '.claude/hooks'],
    ['Codex', '.codex/hooks.json', '.codex/hooks'],
  ]) {
    const settings = JSON.parse(fs.readFileSync(path.join(HOME_DIR, configFile), 'utf8'))
    const marker = runtime === 'Claude Code' ? 'keep-claude' : 'keep-codex'
    if (settings.preserved !== marker) fail(`${runtime} top-level settings were overwritten`)
    const unrelated = (settings.hooks?.PreToolUse || []).flatMap((group) => group.hooks || []).map((hook) => hook.command)
    if (!unrelated.includes(`echo ${marker}`)) fail(`${runtime} unrelated hooks were overwritten`)
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const commands = (settings.hooks?.[event] || []).flatMap((group) => group.hooks || []).map((hook) => hook.command)
      if (commands.filter((command) => command.includes('nudge-')).length !== 1) fail(`${runtime} ${event} hook was duplicated by idempotent setup`)
    }
    for (const filename of ['nudge-context.mjs', 'runtime.mjs', 'nudge-session-start.sh']) {
      const installed = path.join(HOME_DIR, hooksDir, filename)
      if (!fs.existsSync(installed)) fail(`${runtime} hook is missing ${filename}`)
      if (!fs.readFileSync(installed).equals(fs.readFileSync(path.join(HERE, '../agent', filename)))) fail(`${runtime} hook differs from repository source: ${filename}`)
    }
  }
  pass('optional hooks preserve settings and install idempotently for Claude Code and Codex')

  console.log('\nNudge agent setup: ALL PASS')
} finally {
  fs.rmSync(HOME_DIR, { recursive: true, force: true })
}
