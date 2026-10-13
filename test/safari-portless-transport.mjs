// Real Safari page transport against two fresh Portless worktrees. This checks
// HTTP/WS and owner routing, not extension injection, native permissions or pixels.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { lookup } from 'node:dns/promises'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { SafariDriver } from './safari-driver.mjs'
import { jointDesktopPreflight } from './browser-joint-coexistence.mjs'

const root = path.resolve(import.meta.dirname, '..')
const portless = process.env.NUDGE_PORTLESS_BIN
if (!portless || !fs.existsSync(portless)) throw new Error('Set NUDGE_PORTLESS_BIN to an installed Portless CLI file')
const evidenceRoot = process.env.NUDGE_PORTLESS_EVIDENCE_ROOT ? path.resolve(process.env.NUDGE_PORTLESS_EVIDENCE_ROOT) : os.tmpdir()
fs.mkdirSync(evidenceRoot, { recursive: true })
const out = fs.mkdtempSync(path.join(evidenceRoot, 'safari-portless-transport-'))
const repo = path.join(out, 'repo'), state = path.join(out, 'proxy'), store = path.join(out, 'store')
const children = [], report = { results: [], scope: 'Real Safari page HTTP/WS and owner routing across two fresh Portless worktrees', limitations: ['No extension UI, website permission, native startup, screenshots or idle agent wake proof'] }
let safari
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const result = await fn(); if (result) return result } catch {} await pause(100) }
  throw new Error('Timeout: ' + label)
}
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  assert.notEqual(port, 4700); assert.notEqual(port, 1355)
  return port
}
const proxyPort = await freePort(), bridgePort = await freePort()
const env = { ...process.env, PORTLESS_STATE_DIR: state, PORTLESS_PORT: String(proxyPort), PORTLESS_SYNC_HOSTS: '0', NUDGE_STORE: store, NUDGE_PORT: String(bridgePort), NUDGE_NO_RELOAD: '1' }
const base = `http://127.0.0.1:${bridgePort}`
function child(name, file, args, cwd = root) {
  const processHandle = spawn(process.execPath, [file, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { name, processHandle, output: '' }
  for (const pipe of [processHandle.stdout, processHandle.stderr]) pipe.on('data', data => { entry.output += data.toString() })
  children.push(entry)
  return entry
}
const cli = path.join(root, 'agent/groundworks-nudge.mjs')
const run = (args, cwd = root) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { env, cwd, encoding: 'utf8', timeout: 10000 }))
const identity = () => fetch(base + '/.identity').then(r => r.json())
const pass = name => { report.results.push({ name, verdict: 'passed' }); console.log('PASS', name) }

try {
  report.desktop = jointDesktopPreflight()
  fs.mkdirSync(repo)
  const git = args => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  git(['init'])
  fs.writeFileSync(path.join(repo, 'fixture.mjs'), `import http from 'node:http'; http.createServer((_,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><h1>Worktree fixture</h1><button id="target">Target</button>')}).listen(Number(process.env.PORT),'127.0.0.1')\n`)
  git(['add', 'fixture.mjs'])
  git(['-c', 'user.name=Nudge Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture'])
  const a = path.join(out, 'task-a'), b = path.join(out, 'task-b')
  git(['worktree', 'add', '-b', 'task-a', a])
  git(['worktree', 'add', '-b', 'task-b', b])
  child('bridge', path.join(root, 'bridge/bridge.mjs'), [])
  await until(async () => (await identity()).store === store, 'isolated bridge')
  child('proxy', portless, ['proxy', 'start', '--foreground', '--port', String(proxyPort), '--no-tls', '--skip-trust'])
  await until(() => fs.existsSync(path.join(state, 'proxy.port')), 'isolated proxy state')
  const watchA = child('watch-a', cli, ['watch', '--label', 'Worktree A', '--agent-id', 'worktree-a', '--project', a, '--wake', 'pull'], a)
  const watchB = child('watch-b', cli, ['watch', '--label', 'Worktree B', '--agent-id', 'worktree-b', '--project', b, '--wake', 'pull'], b)
  await until(async () => (await identity()).agents.length === 2, 'two opted-in watchers')
  assert((await identity()).agents.every(agent => Array.isArray(agent.hosts) && agent.hosts.length === 0))
  pass('Arming before preview startup leaves both sessions scoped and without foreign claims')
  child('app-a', portless, ['run', '--name', 'app', process.execPath, 'fixture.mjs'], a)
  child('app-b', portless, ['run', '--name', 'app', process.execPath, 'fixture.mjs'], b)
  const previewsA = await until(() => { const p = run(['previews', '--project', a]); return p.previews.length === 1 && p.previews }, 'first worktree preview')
  const previewsB = await until(() => { const p = run(['previews', '--project', b]); return p.previews.length === 1 && p.previews }, 'second worktree preview')
  const urlA = previewsA[0].url, urlB = previewsB[0].url
  assert.notEqual(new URL(urlA).hostname, new URL(urlB).hostname)
  assert.equal(new URL(urlA).port, new URL(urlB).port)
  assert.notEqual(previewsA[0].serverPort, previewsB[0].serverPort)
  await until(async () => { const agents = (await identity()).agents; return agents.find(a => a.session === 'worktree-a')?.hosts.includes(new URL(urlA).host) && agents.find(a => a.session === 'worktree-b')?.hosts.includes(new URL(urlB).host) }, 'automatic host claims after startup')
  pass('New real worktree URLs share the proxy port and retain distinct internal server ports and owners')

  const driverPort = await freePort()
  const driverProcess = spawn('/usr/bin/safaridriver', ['-p', String(driverPort)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { name: 'safaridriver', processHandle: driverProcess, output: '' }
  for (const pipe of [driverProcess.stdout, driverProcess.stderr]) pipe.on('data', data => { entry.output += data.toString() })
  children.push(entry)
  await until(async () => (await fetch(`http://127.0.0.1:${driverPort}/status`)).ok, 'SafariDriver ready')
  safari = new SafariDriver(`http://127.0.0.1:${driverPort}`)
  await safari.start()
  report.safariVersion = safari.capabilities.browserVersion
  assert(Number.parseInt(report.safariVersion) >= 26)

  async function probe(url, label) {
    await safari.goto(url)
    assert.equal(await safari.evaluate(() => document.querySelector('h1')?.textContent), 'Worktree fixture')
    assert.equal(await safari.evaluate(() => location.host), new URL(url).host)
    await safari.evaluate(({ base }) => {
      const state = globalThis.__nudgeTransportProbe = { errors: [] }
      const url = location.href
      const host = location.host.replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
      fetch(base + '/.identity?host=' + encodeURIComponent(host))
        .then(async response => { if (!response.ok) throw new Error('HTTP ' + response.status); state.identity = await response.json() })
        .catch(error => state.errors.push(String(error)))
      const ws = new WebSocket(base.replace(/^http/, 'ws'))
      state.ws = ws
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', url }))
      ws.onerror = () => state.errors.push('WebSocket error')
      ws.onmessage = event => { const message = JSON.parse(event.data); if (message.type === 'pins') state.snapshot = message }
    }, { base })
    await until(async () => {
      const state = await safari.evaluate(() => { const { ws, ...state } = globalThis.__nudgeTransportProbe; return state })
      if (state.errors.length) throw new Error(state.errors.join('; '))
      return state.identity?.agentLabel === label && state.snapshot?.agentLabel === label
    }, `real Safari HTTP/WS owner ${label}`)
    pass(`Safari accesses ${new URL(url).host} and receives its correct owner over HTTP and WebSocket`)
  }
  async function submissions(first, second, lane) {
    const textA = `Safari ${lane} transport A`, textB = `Safari ${lane} transport B`
    for (const [url, label, text] of [[first, 'Worktree A', textA], [second, 'Worktree B', textB]]) {
      await probe(url, label)
      await safari.evaluate(({ base, text }) => {
        const state = globalThis.__nudgeTransportProbe
        fetch(base + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, url: location.href, target: { selector: '#target' } }) })
          .then(async response => { if (response.status !== 201) throw new Error('Submit HTTP ' + response.status); state.submission = await response.json() })
          .catch(error => state.errors.push(String(error)))
      }, { base, text })
      await until(() => safari.evaluate(() => !!globalThis.__nudgeTransportProbe.submission?.id), 'Safari POST accepted')
    }
    await until(() => watchA.output.includes(textA) && watchB.output.includes(textB), 'Safari page request delivery')
    assert(!watchA.output.includes(textB)); assert(!watchB.output.includes(textA))
    assert.equal(run(['context', '--agent-id', 'worktree-a', '--url', first]).open.length, 1)
    assert.equal(run(['context', '--agent-id', 'worktree-a', '--url', second]).open.length, 0)
    assert.equal(run(['context', '--agent-id', 'worktree-b', '--url', second]).open.length, 1)
    pass('Actual Safari page POSTs wake only the correct worktree watcher and retain URL-scoped CLI context')
    await safari.reload()
    await probe(second, 'Worktree B')
  }
  const directA = `http://127.0.0.1:${previewsA[0].serverPort}/`, directB = `http://127.0.0.1:${previewsB[0].serverPort}/`
  // Explicit owner selection isolates the bridge transport lane from Safari's
  // system DNS. Named-host automatic binding is verified separately below.
  for (const [url, session] of [[directA, 'worktree-a'], [directB, 'worktree-b']]) {
    const response = await fetch(base + '/agent/owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: new URL(url).host, session }) })
    assert(response.ok)
  }
  await submissions(directA, directB, 'direct')
  report.directTransport = 'passed'
  if (!process.argv.includes('--direct-only')) {
    report.namedTransport = 'not_run'
    for (const url of [urlA, urlB]) {
      let addresses
      try { addresses = await lookup(new URL(url).hostname, { all: true }) } catch {}
      if (!addresses?.length || addresses.some(address => !['127.0.0.1', '::1'].includes(address.address))) {
        throw Object.assign(new Error('Safari system DNS must resolve each worktree hostname to loopback. Provision Portless hosts sync for the intended proxy state, then rerun; this test never edits /etc/hosts.'), { prerequisite: true })
      }
    }
    await submissions(urlA, urlB, 'named')
    report.namedTransport = 'passed'
  } else report.namedTransport = 'not_tested: --direct-only'
  report.previews = [{ url: urlA, serverPort: previewsA[0].serverPort }, { url: urlB, serverPort: previewsB[0].serverPort }]
  report.verdict = 'passed'
} catch (error) {
  report.verdict = error.prerequisite ? 'blocked' : 'failed'
  report.error = String(error)
  if (safari?.session) { try { report.page = await safari.evaluate(() => {
    const { ws, ...transport } = globalThis.__nudgeTransportProbe || {}
    return { title: document.title, url: location.href, transport }
  }) } catch {} }
  process.exitCode = error.prerequisite ? 2 : 1
  console.error(error)
} finally {
  try { await safari?.close() } catch (error) { report.cleanupError = String(error); report.verdict = 'failed'; process.exitCode = 1 }
  for (const entry of [...children].reverse()) {
    const processHandle = entry.processHandle
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      const exited = once(processHandle, 'exit')
      processHandle.kill('SIGTERM')
      await Promise.race([exited, pause(5000)])
      if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill('SIGKILL')
    }
    fs.writeFileSync(path.join(out, entry.name + '.log'), entry.output)
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('Evidence:', out)
}
