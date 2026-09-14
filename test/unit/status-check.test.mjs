import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkStatus } from '../../agent/status-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const homes = []
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }) })
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-status-check-'))
  homes.push(home)
  const skill = path.join(home, '.agents/skills/groundworks-nudge/SKILL.md')
  fs.mkdirSync(path.dirname(skill), { recursive: true })
  fs.copyFileSync(path.join(root, 'agent/NUDGE-SKILL.md'), skill)
  const store = path.join(home, '.nudge')
  const identity = {
    app: 'groundworks-nudge', version: '0.19.2', store,
    capabilities: { sourceBoundEvidence: 1, submissionIdempotency: 1, lifecycleIdentity: 1 },
    agents: [{ session: 'current-session', wake: 'pull' }],
    tabs: [{ url: 'http://localhost:5175/app', browserSource: { browser: 'chromium' } }],
    routes: [{ host: 'localhost:5175', owner: { session: 'current-session' } }],
  }
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method || 'GET' })
    return { ok: true, json: async () => structuredClone(identity) }
  }
  const options = { root, home, env: {}, runtime: 'Codex', agentId: 'current-session', port: 4899, fetchImpl }
  return { home, skill, store, identity, requests, run: extra => checkStatus({ ...options, ...extra }) }
}

describe('read-only Nudge readiness', () => {
  it('keeps setup checks under status and does not expose a separate retired command', () => {
    const cli = path.join(root, 'agent/groundworks-nudge.mjs')
    const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 })
    const help = run(['help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('status [--check')
    expect(help.stdout).not.toMatch(/\bdoctor\b/i)
    const retired = run(['doctor'])
    expect(retired.status).toBe(1)
    expect(retired.stderr).toContain('Unknown command')
    const invalid = run(['status', '--check=false'])
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toContain('flag and takes no value')
    const invalidPort = run(['status', '--check', '--port', '70000'])
    expect(invalidPort.status).toBe(2)
    expect(invalidPort.stderr).toContain('app port')
  })

  it('checks Chromium, the intended port and the current pull session without creating a store', async () => {
    const f = fixture()
    const before = fs.readFileSync(f.skill)
    const result = await f.run({ browser: 'chrome', appPort: 5175 })
    expect(result).toMatchObject({ kind: 'groundworks-nudge-readiness', schemaVersion: 1, state: 'ready',
      checks: { skill: { state: 'current' }, browser: { connected: ['chrome'] }, session: { state: 'connected', wake: 'pull' } } })
    expect(f.requests).toEqual([{ url: 'http://127.0.0.1:4899/.identity', method: 'GET' }])
    expect(fs.existsSync(f.store)).toBe(false)
    expect(fs.readFileSync(f.skill).equals(before)).toBe(true)
    expect(fs.existsSync(result.source.localGuide)).toBe(true)
  })

  it('accepts Safari alone and never substitutes Chrome or another app for the requested browser', async () => {
    const f = fixture()
    expect((await f.run({ browser: 'safari' })).state).toBe('browser_required')
    f.identity.tabs[0].browserSource.browser = 'safari'
    expect((await f.run({ browser: 'safari' })).state).toBe('ready')
    expect((await f.run({ browser: 'chrome' })).state).toBe('browser_required')
    expect((await f.run({ appPort: 5180 })).state).toBe('browser_required')
    f.identity.tabs[0].browserSource.browser = 'safari-test'
    expect((await f.run({ browser: 'safari' })).state).toBe('browser_required')
  })

  it('keeps absent browser connections separate from missing local installation', async () => {
    const f = fixture()
    f.identity.tabs = []
    expect(await f.run()).toMatchObject({ state: 'browser_required', checks: {
      dependency: { state: 'ready' }, skill: { state: 'current' }, browser: { state: 'not_connected' } } })
    delete f.identity.tabs
    expect((await f.run()).checks.browser.state).toBe('unverified')
  })

  it('detects differing or missing Skills without overwriting them', async () => {
    const f = fixture()
    fs.appendFileSync(f.skill, '\nLocal customization to preserve.\n')
    expect(await f.run()).toMatchObject({ state: 'setup_required', checks: { skill: { state: 'different' } } })
    expect(fs.readFileSync(f.skill, 'utf8')).toContain('Local customization to preserve.')
    fs.unlinkSync(f.skill)
    expect((await f.run()).checks.skill.state).toBe('missing')
    expect(fs.existsSync(f.skill)).toBe(false)
    expect((await f.run({ nodeVersion: '20.0.0' })).checks.node.state).toBe('unsupported')
  })

  it('does not use another live session or another page owner as readiness evidence', async () => {
    const f = fixture()
    expect((await f.run({ agentId: null })).state).toBe('session_required')
    expect((await f.run({ agentId: 'other-session' })).checks.session.state).toBe('not_armed')
    f.identity.routes[0].owner.session = 'other-session'
    expect((await f.run()).state).toBe('selection_required')
    f.identity.routes = [null]
    expect((await f.run()).checks.session.state).toBe('unverified')
    f.identity.agents = [null]
    expect((await f.run()).state).toBe('session_required')
  })

  it('distinguishes a refused connection from unknown or incompatible listeners', async () => {
    const f = fixture()
    const offline = await f.run({ fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }) } })
    expect(offline).toMatchObject({ state: 'bridge_required', checks: { bridge: { state: 'unreachable' }, browser: { state: 'unverified' } } })
    expect((await f.run({ fetchImpl: async () => { throw new Error('timeout') } })).state).toBe('blocked')
    f.identity.app = 'unrelated-service'
    expect((await f.run()).checks.bridge.state).toBe('incompatible')
    f.identity.app = 'groundworks-nudge'
    f.identity.store = path.join(f.home, 'another-store')
    expect((await f.run()).state).toBe('blocked')
    expect(fs.existsSync(f.identity.store)).toBe(false)
  })

  it('leaves conflicting stores untouched and refuses invalid arguments before any request', async () => {
    const f = fixture()
    fs.mkdirSync(path.join(f.home, '.nudge'))
    fs.mkdirSync(path.join(f.home, '.claude/nudge'), { recursive: true })
    expect((await f.run()).checks.bridge.state).toBe('store_conflict')
    await expect(f.run({ browser: 'firefox' })).rejects.toThrow('browser must')
    await expect(f.run({ appPort: 70000 })).rejects.toThrow('app port')
    await expect(f.run({ port: 0 })).rejects.toThrow('bridge port')
    expect(f.requests).toHaveLength(0)
    expect(fs.existsSync(path.join(f.home, '.claude/nudge'))).toBe(true)
  })

  it('reports missing runtime dependencies from an incomplete checkout without installing them', async () => {
    const f = fixture()
    const incomplete = path.join(f.home, 'incomplete-checkout')
    const result = await f.run({ root: incomplete, runtime: 'Agent' })
    expect(result).toMatchObject({ state: 'setup_required', checks: { dependency: { state: 'missing' } } })
    expect(fs.existsSync(incomplete)).toBe(false)
  })
})
