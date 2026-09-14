// Readiness is an observation. This module never starts a bridge or watcher,
// installs a component, changes browser settings, or reads the prompt store.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bridgeIdentity, compatibleIdentity } from '../bridge/lifecycle.mjs'
import { resolveAgentId, resolveAgentRuntime, resolveStoreDir } from './runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GUIDE = 'https://github.com/gstangl/nudge-extension/blob/main/INSTALL.md#guided-setup-for-agents'
const SKILL_HOMES = { codex: '.agents/skills', 'claude-code': '.claude/skills', grok: '.grok/skills' }
const runtimeKey = value => ({ 'claude code': 'claude-code', 'grok build': 'grok' }[value.toLowerCase()] || value.toLowerCase())
const browserName = value => value === 'chromium' ? 'chrome' : value
const refused = error => error?.code === 'ECONNREFUSED' || (error?.cause && refused(error.cause))
  || (Array.isArray(error?.errors) && error.errors.length > 0 && error.errors.every(refused))

function skillState(root, home, runtime) {
  const relative = SKILL_HOMES[runtime]
  if (!relative) return { state: 'not_required', runtime }
  const installed = path.join(home, relative, 'groundworks-nudge/SKILL.md')
  try {
    const current = fs.readFileSync(installed)
    const canonical = fs.readFileSync(path.join(root, 'agent/NUDGE-SKILL.md'))
    return { state: current.equals(canonical) ? 'current' : 'different', path: installed, runtime }
  } catch (error) {
    return { state: error.code === 'ENOENT' && !fs.existsSync(installed) ? 'missing' : 'unreadable', path: installed, runtime }
  }
}

function appHost(tab, appPort) {
  try {
    const url = new URL(tab.url)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) return null
    if (appPort && Number(url.port || 80) !== appPort) return null
    return url.host
  } catch { return null }
}

export async function checkStatus({
  root = ROOT, home = os.homedir(), env = process.env, nodeVersion = process.versions.node,
  runtime = resolveAgentRuntime(env), agentId = resolveAgentId(env), browser = null,
  appPort = null, port = Number(env.NUDGE_PORT || 4700), fetchImpl = fetch,
} = {}) {
  if (browser !== null && !['chrome', 'safari'].includes(browser)) throw new Error('browser must be chrome or safari')
  if (appPort !== null && (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535)) throw new Error('app port must be between 1 and 65535')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid bridge port')
  const checks = {
    node: { state: Number(nodeVersion.split('.')[0]) >= 22 ? 'ready' : 'unsupported', version: nodeVersion },
    dependency: { state: 'ready' },
    skill: skillState(root, home, runtimeKey(runtime)),
    bridge: { state: 'unverified' },
    browser: { state: 'unverified', requested: browser, connected: [] },
    session: { state: 'unverified', wake: null },
  }
  try { createRequire(path.join(root, 'bridge/package.json')).resolve('ws') }
  catch { checks.dependency.state = 'missing' }

  let store, identity
  try { store = resolveStoreDir({ env, home }) }
  catch (error) { checks.bridge = { state: 'store_conflict', detail: error.message } }
  if (store) {
    try {
      identity = await bridgeIdentity({ port, fetchImpl })
      checks.bridge = { state: compatibleIdentity(identity, { store }) ? 'connected' : 'incompatible' }
    } catch (error) {
      checks.bridge = { state: refused(error) ? 'unreachable' : 'unverified', detail: error.message }
    }
  }
  if (checks.bridge.state === 'connected') {
    const tabs = Array.isArray(identity.tabs) ? identity.tabs.filter(tab =>
      appHost(tab, appPort) && ['chrome', 'safari'].includes(browserName(tab.browserSource?.browser))) : null
    const selected = tabs?.filter(tab => !browser || browserName(tab.browserSource.browser) === browser)
    checks.browser = {
      state: selected === null || selected === undefined ? 'unverified' : selected.length ? 'connected' : 'not_connected',
      requested: browser, connected: [...new Set(tabs?.map(tab => browserName(tab.browserSource.browser)) || [])],
    }
    const own = agentId && Array.isArray(identity.agents) && identity.agents.find(agent => agent?.session === agentId)
    checks.session = { state: !agentId ? 'identity_required' : own ? 'armed' : 'not_armed', wake: own ? (own.wake === 'push' ? 'push' : 'pull') : null }
    if (own && selected?.length) {
      const routes = Array.isArray(identity.routes) ? identity.routes : []
      const owners = selected.map(tab => routes.find(route => route?.host === appHost(tab, appPort))?.owner?.session)
      checks.session.state = owners.some(owner => owner && owner !== agentId) ? 'selection_required'
        : owners.every(owner => owner === agentId) ? 'connected' : 'unverified'
    }
  }

  let state
  if (['incompatible', 'unverified', 'store_conflict'].includes(checks.bridge.state)) state = 'blocked'
  else if (checks.node.state !== 'ready' || checks.dependency.state !== 'ready'
    || !['current', 'not_required'].includes(checks.skill.state)) state = 'setup_required'
  else if (checks.bridge.state !== 'connected') state = 'bridge_required'
  else if (checks.browser.state !== 'connected') state = 'browser_required'
  else if (checks.session.state === 'selection_required') state = 'selection_required'
  else if (checks.session.state !== 'connected') state = 'session_required'
  else state = 'ready'

  return {
    kind: 'groundworks-nudge-readiness', schemaVersion: 1, state,
    scope: { browser, appPort, currentSessionKnown: !!agentId }, checks,
    source: { root, skill: path.join(root, 'agent/NUDGE-SKILL.md'), localGuide: path.join(root, 'INSTALL.md'), guide: GUIDE },
    proof: 'Connection checks only; browser installation, prompt delivery and automatic wake require their own evidence.',
  }
}
