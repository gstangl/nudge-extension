// Real Send -> unchanged watcher. Synthetic sessions prove TW, never TS.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { candidate, root, binding, until, ownedChild, stop } from './support/bridge-candidate.mjs'
import { DeliveryLedger, summary } from './support/delivery-ledger.mjs'
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const count = Number(option('--samples', '10'))
assert(Number.isInteger(count) && count > 0 && count <= 10000, 'invalid sample count')
const browserName = option('--browser', 'chrome')
assert(['chrome', 'chromium', 'chrome-for-testing'].includes(browserName), 'unknown browser')
const out = path.resolve(option('--out', path.join(root, 'artifacts/bridge-comparison', `send-${Date.now()}`)))
fs.mkdirSync(out, { recursive: true })
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n')
const event = (kind, data) => fs.appendFileSync(path.join(out, 'events.jsonl'), JSON.stringify({ at: performance.now(), kind, data }) + '\n')
const before = binding(); write('source.json', before)
const ledger = new DeliveryLedger(); const watchers = []; let ctx, bridge, active, report
const deadline = setTimeout(() => { event('whole-run-timeout', {}); process.kill(process.pid, 'SIGTERM') }, 120000 + count * 10000)
const interrupted = () => { throw new Error('interrupted') }
process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted)
try {
  bridge = await candidate({ log: (stream, data) => event('bridge-' + stream, data) }); await bridge.start()
  write('candidate.json', { argv: bridge.argv, port: bridge.port, store: bridge.store, pid: bridge.child.pid })
  const url = `http://localhost:${bridge.port}/demo`
  for (const session of ['comparison_alpha', 'comparison_beta']) {
    let pending = ''
    const watcher = ownedChild([process.execPath, path.join(root, 'bridge/watch-nudges.mjs')], { ...bridge.env,
      NUDGE_AGENT_ID: session, NUDGE_AGENT_LABEL: session, NUDGE_AGENT_RUNTIME: 'Agent', NUDGE_AGENT_SURFACE: 'test', NUDGE_WAKE: 'pull',
      NUDGE_PREVIEW_URL: session === 'comparison_alpha' ? url : 'http://beta.localhost:59999/',
    }, (stream, data) => {
      event(`watcher-${stream}`, { session, data })
      if (stream !== 'stdout') return
      pending += data
      while (pending.includes('\n')) {
        const i = pending.indexOf('\n'); const line = pending.slice(0, i); pending = pending.slice(i + 1)
        const match = /^New nudge (nudge_\d+): (comparison_[a-z0-9_]+)/.exec(line)
        if (!match) continue
        const attempt = ledger.attempts.find(a => a.text === match[2])
        if (attempt) attempt.observations.push({ kind: 'watcher', session, id: match[1], at: performance.now() })
        else event('unmatched-watcher-receipt', { session, line })
      }
    }); watchers.push(watcher)
  }
  await until(async () => (await bridge.request('/.identity')).body.agents?.length === 2, 5000, 'both synthetic watchers')
  // Same stage for every candidate: fixed storage-port configuration, native off.
  const stage = path.join(root, 'artifacts/safari/comparison-extension')
  execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'test', '--use-storage-port', '--out', path.relative(root, stage)], { cwd: root })
  const platformPath = path.join(stage, 'platform.js')
  fs.writeFileSync(platformPath, fs.readFileSync(platformPath, 'utf8').replace('"browser":"safari-test"', `"browser":"${browserName}"`))
  const launch = { ignoreDefaultArgs: ['--disable-extensions'], headless: process.argv.includes('--headless'), viewport: { width: 1280, height: 900 }, args: ['--enable-unsafe-extension-debugging'] }
  if (browserName === 'chrome') launch.channel = 'chrome'
  else if (browserName === 'chromium') launch.channel = 'chromium'
  else { assert(process.env.CHROME_FOR_TESTING, 'CHROME_FOR_TESTING executable prerequisite missing'); launch.executablePath = process.env.CHROME_FOR_TESTING }
  ctx = await chromium.launchPersistentContext(path.join(bridge.home, 'profile'), launch)
  const cdp = await ctx.browser().newBrowserCDPSession()
  const version = await cdp.send('Browser.getVersion')
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: stage })
  write('browser.json', { lane: browserName, headless: launch.headless, version, extensionId: loaded.id, nativeAutostart: false, installation: 'CDP Extensions.loadUnpacked over isolated debugging pipe', actualAgentReceipt: 'unavailable; synthetic watcher only' })
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate(port => chrome.storage.local.set({ nudgePort: port }), bridge.port)
  // Hash actual staged bytes, not the pre-identity-adjustment packaging manifest.
  const stageFiles = fs.readdirSync(stage, { recursive: true }).filter(n => fs.statSync(path.join(stage, n)).isFile()).sort().map(n => [n, crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, n))).digest('hex')])
  write('extension.json', stageFiles)
  const page = ctx.pages()[0] || await ctx.newPage()
  page.on('response', async response => {
    if (!response.url().endsWith('/comments') || response.request().method() !== 'POST') return
    try {
      const sent = response.request().postDataJSON(); const attempt = ledger.attempts.find(a => a.text === sent.text)
      event('http-response', { sent, status: response.status() })
      if (attempt) { attempt.submissionId = sent.submissionId; attempt.ta = performance.now(); attempt.http = { status: response.status(), body: await response.json() } }
    } catch (error) { event('http-observer-error', String(error)) }
  })
  await page.goto(url)
  await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  for (let n = 0; n < count; n++) {
    await page.locator('.pill .btn-pick').click()
    await page.locator('#card-conversion').click({ position: { x: 10, y: 10 } })
    const text = `comparison_${crypto.randomBytes(12).toString('hex')}`
    await page.locator('.composer textarea').fill(text)
    await page.waitForFunction(() => !document.querySelector('#__groundworks-nudge-host').shadowRoot.querySelector('.composer .send').disabled)
    const sendBox = await page.locator('.composer .send').boundingBox()
    assert(sendBox, 'ready Send geometry required')
    const sendPoint = { x: sendBox.x + sendBox.width / 2, y: sendBox.y + sendBox.height / 2 }
    await page.mouse.move(sendPoint.x, sendPoint.y)
    // Register intention before dispatch. Browser-generated identity is correlated
    // from its HTTP request; expected payload/owner do not come from the bridge.
    active = ledger.attempt({ submissionId: `pending_${text}`, text, url, owner: 'comparison_alpha', t0: performance.now(), index: n })
    event('attempt', active)
    try {
      await page.mouse.click(sendPoint.x, sendPoint.y)
      await page.locator('.composer').waitFor({ state: 'hidden', timeout: 5000 })
      active.queueUiObservedAt = performance.now() // UI acknowledgement upper bound, not storage callback timing
      await until(() => active.observations.length && active.http, 5000, 'exact watcher and acceptance receipt')
      active.latencyMs = active.observations[0].at - active.t0
      active.status = 'passed'
    } catch (error) { active.status = 'timeout'; active.error = String(error) }
    event('terminal', active); write('attempts.json', ledger.attempts)
    if (active.status !== 'passed') throw new Error(active.error)
  }
  // Let competing FS/WS/poll paths run; reject duplicate/foreign notifications.
  await new Promise(resolve => setTimeout(resolve, 5200))
  const pins = bridge.read().pins; write('store.json', bridge.read())
  const reconciliation = ledger.reconcile(pins)
  assert.equal(binding().sha256, before.sha256, 'source changed during run')
  report = { verdict: 'passed', boundary: 'T0 dispatch -> TW unchanged watcher stdout; includes input/pipe observer cost', queueBoundary: 'composer hidden: UI acknowledgement upper bound only; TQ storage acknowledgement not instrumented', actualAgentReceipt: 'unavailable', wake: 'pull', intentionalWaitMs: null, source: before.sha256, browser: browserName, statistics: summary(ledger.attempts), reconciliation }
} catch (error) { report = { verdict: 'failed', error: error.stack, attempts: ledger.attempts.length }; process.exitCode = 1 }
finally {
  clearTimeout(deadline)
  if (ctx) await ctx.close()
  for (const watcher of watchers) await stop(watcher)
  if (bridge) await bridge.close()
  write('attempts.json', ledger.attempts); write('report.json', report)
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
