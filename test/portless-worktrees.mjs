// Real Git worktrees, real Portless proxy/server registration, project-scoped
// CLI watchers and Chromium extension delivery. Never touches the live proxy.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const portless = process.env.NUDGE_PORTLESS_BIN
if (!portless || !fs.existsSync(portless)) throw new Error('Set NUDGE_PORTLESS_BIN to an installed Portless CLI file')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-portless-worktrees-'))
const repo = path.join(out, 'repo'), state = path.join(out, 'proxy'), store = path.join(out, 'store')
const children = [], report = { results: [], scope: 'Two real Git worktrees and Portless instances with isolated Chromium extension and bridge' }
report.browserLogs = []
let context
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
const env = { ...process.env, PORTLESS_STATE_DIR: state, PORTLESS_PORT: String(proxyPort), NUDGE_STORE: store, NUDGE_PORT: String(bridgePort), NUDGE_NO_RELOAD: '1' }
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
  const legacy = child('legacy-watch-a', cli, ['watch', '--label', 'Legacy Worktree A', '--agent-id', 'legacy-a', '--wake', 'pull'], a)
  await until(async () => (await identity()).agents.find(agent => agent.session === 'legacy-a')?.hosts?.includes(new URL(urlA).host), 'older watcher process-backed binding')
  pass('An older opted-in watcher binds through its verified process cwd without replacing its wake channel')
  const ended = once(legacy.processHandle, 'exit')
  legacy.processHandle.kill('SIGTERM'); await ended
  await until(async () => (await fetch(base + '/.identity?host=' + encodeURIComponent(new URL(urlA).host)).then(r => r.json())).agentLabel === 'Worktree A', 'original project owner after legacy watcher exit')
  const orphan = await fetch(base + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Unclaimed host test', url: `http://unclaimed.app.localhost:${proxyPort}/`, target: { selector: '#target' } }) }).then(r => r.json())
  assert(orphan.id)
  assert.equal(run(['context', '--agent-id', 'worktree-a', '--url', `http://unclaimed.app.localhost:${proxyPort}`]).open.length, 0)
  assert.equal(run(['context', '--agent-id', 'worktree-b', '--url', `http://unclaimed.app.localhost:${proxyPort}`]).open.length, 0)
  pass('Unclaimed named hosts are not adopted by project-scoped sessions')

  const resource = `artifacts/safari/portless-${proxyPort}`
  execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'test', '--bridge-port', String(bridgePort), '--out', resource], { cwd: root, stdio: 'pipe' })
  context = await chromium.launchPersistentContext('', { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${path.join(root, resource)}`, `--load-extension=${path.join(root, resource)}`] })
  const pageA = await context.newPage(), pageB = await context.newPage()
  for (const [page, url, name] of [[pageA, urlA, 'Worktree A'], [pageB, urlB, 'Worktree B']]) {
    page.on('console', message => report.browserLogs.push({ name, type: message.type(), text: message.text() }))
    page.on('pageerror', error => report.browserLogs.push({ name, type: 'pageerror', text: error.message }))
    await page.goto(url)
    await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
    await until(async () => (await page.locator('.pill .who').innerText()).includes(name), 'correct visible toolbar owner')
  }
  const live = await identity()
  for (const [url, session] of [[urlA, 'worktree-a'], [urlB, 'worktree-b']]) {
    const route = live.routes.find(route => route.host === new URL(url).host)
    assert.equal(route.owner.session, session); assert.equal(route.via, 'worktree'); assert.equal(route.viaFallback, false)
  }
  pass('Fresh browser tabs show the correct connected toolbar without manual session selection')
  for (const [page, text] of [[pageA, 'Worktree A test'], [pageB, 'Worktree B test']]) {
    await page.bringToFront()
    await page.locator('.btn-pick').click()
    await page.locator('#target').click()
    await page.locator('.composer textarea').fill(text)
    await page.locator('.composer .send').click()
    await page.locator('.composer').waitFor({ state: 'hidden' })
  }
  await until(() => watchA.output.includes('Worktree A test') && watchB.output.includes('Worktree B test'), 'watcher delivery')
  assert(!watchA.output.includes('Worktree B test')); assert(!watchB.output.includes('Worktree A test'))
  assert.equal(run(['context', '--agent-id', 'worktree-a', '--url', urlA]).open.length, 1)
  assert.equal(run(['context', '--agent-id', 'worktree-a', '--url', urlB]).open.length, 0)
  assert.equal(run(['context', '--agent-id', 'worktree-b', '--url', urlB]).open.length, 1)
  const hook = session => execFileSync(process.execPath, [path.join(root, 'agent/nudge-context.mjs')], {
    env: { ...env, NUDGE_AGENT_ID: session, CODEX_THREAD_ID: session }, input: JSON.stringify({ prompt: 'Continue with the current mark' }), encoding: 'utf8', timeout: 10000,
  })
  const hookA = hook('worktree-a'), hookB = hook('worktree-b')
  assert(!hookA.includes('Worktree B test')); assert(!hookA.includes(urlB))
  assert(hookB.includes('Worktree B test'))
  pass('Real browser submissions reach only their own project watcher; URL-scoped CLI excludes the sibling')
  pass('Native context hooks exclude the other worktree selection and prompts on the same proxy port')
  await pageA.reload()
  await pageA.locator('.pill .status.ok').waitFor()
  await until(async () => (await pageA.locator('.pill .who').innerText()).includes('Worktree A'), 'owner after reload')
  await pageA.screenshot({ path: path.join(out, 'worktree-a.png') })
  await pageB.screenshot({ path: path.join(out, 'worktree-b.png') })
  pass('Reload retains the worktree owner and visible connected toolbar')
  report.previews = [{ url: urlA, serverPort: previewsA[0].serverPort }, { url: urlB, serverPort: previewsB[0].serverPort }]
} catch (error) {
  if (context) for (const [index, page] of context.pages().entries()) {
    await page.screenshot({ path: path.join(out, `failure-${index}.png`) }).catch(() => {})
    report.results.push({ diagnostic: await page.locator('.feed').innerText().catch(() => ''), composer: await page.locator('.composer').innerText().catch(() => '') })
  }
  report.identity = await identity().catch(() => null)
  report.results.push({ verdict: 'failed', error: String(error) }); process.exitCode = 1
  console.error(error)
} finally {
  await context?.close()
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
