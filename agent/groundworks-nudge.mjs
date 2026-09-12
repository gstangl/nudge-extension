#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveAgentId,
  resolveAgentRuntime,
  resolveAgentSurface,
  resolveStoreDir,
  resolveWake,
} from './runtime.mjs'
import { ensureBridge } from '../bridge/lifecycle.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const PORT = Number(process.env.NUDGE_PORT || 4700)
const BASE = `http://127.0.0.1:${PORT}`

function parseArgs(args) {
  const options = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const value = args[i]
    if (!value.startsWith('--')) { positionals.push(value); continue }
    const [raw, inline] = value.slice(2).split(/=(.*)/s)
    if (inline !== undefined) options[raw] = inline
    else if (args[i + 1] && !args[i + 1].startsWith('--')) options[raw] = args[++i]
    else options[raw] = true
  }
  return { options, positionals }
}

const die = (message, code = 1) => { console.error(message); process.exit(code) }
const print = (value) => console.log(JSON.stringify(value, null, 2))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(route, init = {}) {
  const response = await fetch(`${BASE}${route}`, { signal: AbortSignal.timeout(2000), ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status} ${body.error || response.statusText}`)
  return body
}

async function identity(required = true) {
  try { return await request('/.identity') }
  catch (error) {
    if (required) die(`Nudge bridge unavailable on ${BASE}: ${error.message}`, 2)
    return null
  }
}

async function storeDir() {
  const live = await identity(false)
  return live?.store || resolveStoreDir()
}

async function readState() {
  const dir = await storeDir()
  let store = { seq: 0, pins: [] }
  let selection = null
  try { store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')) } catch { /* fresh store */ }
  try { selection = JSON.parse(fs.readFileSync(path.join(dir, 'selection.json'), 'utf8')) } catch { /* no selection */ }
  return { dir, store, selection, withdrawn: readWithdrawn(dir) }
}

function readWithdrawn(dir) {
  const out = []
  let files = []
  try { files = fs.readdirSync(path.join(dir, 'inbox')) } catch { return out }
  for (const file of files) {
    const id = file.match(/^((?:pin|nudge)_\d+)\.withdrawn\.md$/)?.[1]
    if (!id) continue
    let text = ''
    try { text = fs.readFileSync(path.join(dir, 'inbox', file), 'utf8') } catch { continue }
    const at = text.match(/^- withdrawn: (.+)$/m)?.[1] || null
    out.push({
      id,
      label: Number(text.match(/^# \S+ \(#(\d+)\)/m)?.[1] || labelOf(id)),
      withdrawnAt: at,
      owner: {
        label: text.match(/^- agent: (.+)$/m)?.[1] || null,
        session: text.match(/^- session: (.+)$/m)?.[1] || null,
      },
      url: text.match(/^- url: (.+)$/m)?.[1] || null,
      file: path.join(dir, 'inbox', file),
    })
  }
  return out
}

const labelOf = (id) => {
  const n = Number(String(id).replace(/^(?:pin|nudge)_/, ''))
  return Number.isFinite(n) && n > 0 ? ((n - 1) % 999) + 1 : 0
}

function resolveReference(pins, reference) {
  const raw = String(reference || '').trim()
  const exact = pins.find((pin) => pin.id === raw)
  if (exact) return exact
  const number = Number(raw.replace(/^(?:#|pin_|nudge_)/, ''))
  if (!Number.isFinite(number)) return null
  return pins.findLast((pin) => pin.status === 'open' && labelOf(pin.id) === number)
    || pins.find((pin) => pin.id === `nudge_${number}` || pin.id === `pin_${number}`)
    || pins.findLast((pin) => labelOf(pin.id) === number)
    || null
}

function pinRecord(pin, dir) {
  return {
    id: pin.id,
    label: labelOf(pin.id),
    status: pin.status,
    createdAt: pin.createdAt,
    owner: pin.owner || null,
    prompt: pin.text || null,
    markOnly: !pin.text,
    url: pin.url,
    target: pin.target || null,
    targets: pin.targets || null,
    amendments: pin.amendments || [],
    files: {
      inbox: path.join(dir, 'inbox', `${pin.id}.md`),
      before: pin.screenshot ? path.join(dir, pin.screenshot) : null,
      after: pin.screenshotAfter ? path.join(dir, pin.screenshotAfter) : null,
    },
  }
}

const hostOf = (url) => {
  try { return new URL(url).host.replace(/^127\.0\.0\.1(?=:|$)/, 'localhost') } catch { return '' }
}

function ownsOwnerless(url, agentId, live) {
  const host = hostOf(url)
  const route = live?.routes?.find((item) => item.host === host)
  if (route) return route.owner?.session === agentId
  return !!live?.agents?.find((item) => item.session === agentId && item.owner)
}

function scopedPins(pins, { agentId, port, all, live }) {
  return pins.filter((pin) => {
    if (port && !String(pin.url || '').includes(`:${String(port).replace(/^:/, '')}`)) return false
    if (all || !agentId) return true
    return pin.owner?.session === agentId || (!pin.owner?.session && ownsOwnerless(pin.url, agentId, live))
  })
}

function scopedWithdrawn(items, { agentId, port, all, live }) {
  return items.filter((item) => {
    if (item.withdrawnAt && Date.now() - Date.parse(item.withdrawnAt) > 30 * 60_000) return false
    if (port && !String(item.url || '').includes(`:${String(port).replace(/^:/, '')}`)) return false
    if (all || !agentId) return true
    return item.owner?.session === agentId || (!item.owner?.session && ownsOwnerless(item.url, agentId, live))
  })
}

function usage() {
  console.log(`groundworks-nudge <command>

  watch --label <name> [--agent-id <id>] [--runtime <name>] [--surface <name>] [--wake push|pull]
  status
  context [--agent-id <id>] [--port <port>] [--all]
  list [--agent-id <id>] [--port <port>] [--all]
  show <#label|nudge_id>
  selection
  resolve <#label|nudge_id> [--wait-evidence <ms>]
  bridge
  ensure-bridge
  store-path`)
}

const [command = 'help', ...rawArgs] = process.argv.slice(2)
const { options, positionals } = parseArgs(rawArgs)

if (command === 'help' || command === '--help' || command === '-h') {
  usage()
} else if (command === 'bridge') {
  await import(path.join(ROOT, 'bridge', 'bridge.mjs'))
} else if (command === 'ensure-bridge') {
  const result = await ensureBridge({ port: PORT, store: resolveStoreDir(), bridge: path.join(ROOT, 'bridge', 'bridge.mjs') })
  print({ state: result.state, bridge: result.identity })
} else if (command === 'watch') {
  const label = String(options.label || positionals.join(' ')).trim()
  if (!label) die('watch requires --label <name>')
  const agentId = String(options['agent-id'] || resolveAgentId() || `agent-${crypto.randomUUID().slice(0, 12)}`).slice(0, 128)
  process.env.NUDGE_AGENT_ID = agentId
  process.env.NUDGE_AGENT_LABEL = label
  process.env.NUDGE_AGENT_RUNTIME = String(options.runtime || resolveAgentRuntime())
  process.env.NUDGE_AGENT_SURFACE = String(options.surface || resolveAgentSurface())
  process.env.NUDGE_WAKE = String(options.wake || resolveWake())
  print({
    state: 'arming',
    agentId,
    label,
    runtime: process.env.NUDGE_AGENT_RUNTIME,
    surface: process.env.NUDGE_AGENT_SURFACE,
    wake: process.env.NUDGE_WAKE === 'push' ? 'push' : 'pull',
  })
  await import(path.join(ROOT, 'bridge', 'watch-nudges.mjs'))
} else if (command === 'status' || command === 'identity' || command === 'doctor') {
  print(await identity())
} else if (command === 'store-path') {
  console.log(await storeDir())
} else if (command === 'selection') {
  const { dir, selection } = await readState()
  print({ store: dir, selection })
} else if (command === 'list' || command === 'queue' || command === 'context') {
  const live = await identity(false)
  const { dir, store, selection, withdrawn } = await readState()
  const agentId = String(options['agent-id'] || resolveAgentId() || '') || null
  const scope = { agentId, port: options.port, all: !!options.all, live }
  const pins = scopedPins(store.pins || [], scope)
    .filter((pin) => pin.status === 'open')
    .sort((a, b) => Number(a.id.match(/\d+$/)?.[0]) - Number(b.id.match(/\d+$/)?.[0]))
    .map((pin) => pinRecord(pin, dir))
  const output = {
    bridge: live,
    store: dir,
    agentId,
    withdrawn: scopedWithdrawn(withdrawn, scope),
    open: pins,
  }
  if (command === 'context') {
    const at = Date.parse(selection?.at || '')
    output.selection = at && Date.now() - at <= 15 * 60_000 ? selection : null
  }
  print(output)
} else if (command === 'show') {
  const reference = positionals[0]
  if (!reference) die('show requires a pill number or nudge id')
  const { dir, store, withdrawn } = await readState()
  const pin = resolveReference(store.pins || [], reference)
  if (!pin) {
    const number = Number(String(reference).replace(/^(?:#|pin_|nudge_)/, ''))
    const removed = withdrawn.find((item) => item.id === reference || item.label === number)
    if (removed) { print({ ...removed, status: 'withdrawn' }); process.exit(0) }
    die(`Nudge ${reference} not found`, 3)
  }
  print(pinRecord(pin, dir))
} else if (command === 'resolve') {
  const reference = positionals[0]
  if (!reference) die('resolve requires a pill number or nudge id')
  const before = await readState()
  const pin = resolveReference(before.store.pins || [], reference)
  if (!pin) die(`Nudge ${reference} not found`, 3)
  if (pin.status !== 'open') die(`${pin.id} is already resolved`, 4)
  await request(`/comments/${pin.id}/resolve`, { method: 'POST' })

  const waitMs = Math.max(0, Number(options['wait-evidence'] ?? 4000))
  let evidence = pin.screenshot ? 'pending' : 'not_required'
  let after = null
  if (pin.screenshot && waitMs) {
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      const current = await readState()
      const resolved = current.store.pins?.find((candidate) => candidate.id === pin.id)
      if (resolved?.screenshotAfter) {
        evidence = 'captured'
        after = path.join(current.dir, resolved.screenshotAfter)
        break
      }
      await sleep(200)
    }
  }
  print({ id: pin.id, resolved: true, evidence, after })
} else {
  usage()
  die(`Unknown command: ${command}`)
}
