// Real simultaneous Safari + Chromium lane. Browser operations are intentionally
// separate from the Chromium-only installation-isolation subset.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SafariDriver } from './safari-driver.mjs'
import { setFixtureTitle, openPermissionWindow, closePermissionWindow, grantCurrentSite, pressExtension } from './safari-permissions.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export function stageBrowserResources({ out, port, family }) {
  assert(['chromium-test', 'safari-test'].includes(family))
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'test', '--bridge-port', String(port), '--out', path.relative(ROOT, out)], { cwd: ROOT, encoding: 'utf8' }))
  const platformFile = path.join(out, 'platform.js'), platform = fs.readFileSync(platformFile, 'utf8')
  const end = platform.indexOf('\n'), preset = JSON.parse(platform.slice('globalThis.__nudgePlatform = '.length, end))
  assert.equal(preset.nativeAutostart, false); assert.equal(preset.developmentReload, false); assert.equal(preset.bridgePort, port)
  // Only generated test resources change. Browser provenance must name the
  // actual runtime, and the digest must cover these final installed bytes.
  fs.writeFileSync(platformFile, `globalThis.__nudgePlatform = ${JSON.stringify({ ...preset, browser: family })}${platform.slice(end)}`)
  const hashes = []
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.name !== 'RESOURCE-SHA256') hashes.push(`${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(out, file).split(path.sep).join('/')}`)
    }
  }
  visit(out); fs.writeFileSync(path.join(out, 'RESOURCE-SHA256'), hashes.join('\n') + '\n')
  return { ...result, browserFamily: family, sourceResourceHash: result.resourceHash, resourceHash: crypto.createHash('sha256').update(hashes.join('\n')).digest('hex'), files: hashes.length }
}

function blocked(message) { return Object.assign(new Error(message), { prerequisite: true }) }
export function jointDesktopPreflight() {
  if (process.platform !== 'darwin') throw blocked('Real Safari coexistence requires macOS with Safari 26+ and an unlocked GUI session.')
  // Read only; never log the full hardware/session registry.
  const registry = execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8', timeout: 4000 })
  if (/"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(registry)) throw blocked('The macOS GUI session is locked; Safari permission/focus/capture cannot be verified. Unlock it and rerun.')
  try { fs.accessSync('/usr/bin/safaridriver', fs.constants.X_OK) } catch { throw blocked('SafariDriver is unavailable.') }
  return { platform: process.platform, lockedSessionDetected: false }
}

export async function runJointCoexistence() {
  const PORT = 4823, PAGE = 5323, DRIVER = 4821, base = `http://localhost:${PORT}`
  const artifacts = path.join(ROOT, 'artifacts/safari'); fs.mkdirSync(artifacts, { recursive: true })
  const run = fs.mkdtempSync(path.join(artifacts, 'joint-coexistence-'))
  const store = path.join(run, 'store'), title = `Nudge joint coexistence ${path.basename(run)}`
  const report = { scope: 'Simultaneous real Safari + Chromium: source identity, routing and evidence', startedAt: new Date().toISOString(), verdict: 'not_run', results: [], resources: {}, console: [], cleanup: [], limitations: ['This bounded joint lane is not full A01–A14 parity, Safari worker/quota/permission-revocation, native-app or distribution acceptance.'] }
  let bridge, pageServer, safariProcess, safari, chrome, extensionId, beatTimer, permissionWindow = false, bridgeLog = '', phase = 'prerequisites'
  const ownedProcesses = []
  const pages = []
  const tabUrl = name => `http://localhost:${PAGE}/same?tab=${name}`
  const readStore = () => {
    try { return JSON.parse(fs.readFileSync(path.join(store, 'store.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return { pins: [] }; throw error }
  }
  async function until(fn, label, ms = 12000) {
    const end = Date.now() + ms
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100) }
    throw new Error(`Timeout: ${label}`)
  }
  async function free(port) {
    const probe = net.createServer()
    try { await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve)) }
    catch { throw blocked(`Required test port ${port} is occupied; no existing listener was stopped.`) }
    await new Promise(resolve => probe.close(resolve))
  }
  function launch(command, args, options) {
    const child = spawn(command, args, options)
    child.exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', error => { child.startError = error; resolve() }) })
    ownedProcesses.push(child); return child
  }
  async function post(route, body = {}) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
    assert(response.ok, `${route}: ${response.status}`); return response.json()
  }
  const owners = [
    { label: 'joint-owner-one', session: 'joint_owner_one', pid: process.pid, since: Date.now(), wake: 'pull' },
    { label: 'joint-owner-two', session: 'joint_owner_two', pid: process.pid + 1, since: Date.now() - 1000, wake: 'pull' },
  ]
  const heartbeat = async () => { for (const owner of owners) await post('/agent/heartbeat', owner) }
  async function check(name, action) { await action(); report.results.push({ name, verdict: 'passed' }); console.log(`PASS real Safari + Chromium: ${name}`) }
  function safariTab(handle, name) {
    const page = { browser: 'safari', name, handle,
      async activate() {
        await safari.command('POST', '/window', { handle })
        const result = JSON.parse(execFileSync('peekaboo', ['window', 'focus', '--app', 'com.apple.Safari', '--window-title', `${title} ${name}`, '--verify', '--focus-timeout', '3s', '--focus-retry-count', '1', '--no-remote', '--json'], { encoding: 'utf8', timeout: 7000, killSignal: 'SIGKILL' }))
        if (!result.success) throw new Error(`Owned Safari test window could not be focused: ${JSON.stringify(result.error)}`)
        await until(() => safari.evaluate(() => !document.hidden && document.hasFocus()), 'owned Safari source focus')
      },
      async evaluate(fn, arg) { await safari.command('POST', '/window', { handle }); return safari.evaluate(fn, arg) },
      click: (x, y) => safari.click(x, y), drag: points => safari.drag(points), type: text => safari.type(text), key: key => safari.key(key),
      async close() { await safari.command('POST', '/window', { handle }); await safari.command('DELETE', '/window'); page.closed = true },
    }
    pages.push(page); return page
  }
  function chromeTab(raw, name) {
    const page = { browser: 'chromium', name, raw,
      async activate() {
        await raw.bringToFront()
        const sw = chrome.serviceWorkers()[0] || await chrome.waitForEvent('serviceworker', { timeout: 5000 })
        await sw.evaluate(async title => {
          const tab = (await chrome.tabs.query({})).find(tab => tab.title === title)
          if (!tab) throw new Error('Owned Chromium tab not found')
          await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true })
        }, `${title} ${name}`)
        await until(() => raw.evaluate(() => !document.hidden && document.hasFocus()), 'owned Chromium source focus')
      },
      evaluate: (fn, arg) => raw.evaluate(fn, arg), click: (x, y) => raw.mouse.click(x, y),
      async drag(points) { await raw.mouse.move(...points[0]); await raw.mouse.down(); for (const point of points.slice(1)) await raw.mouse.move(...point, { steps: 8 }); await raw.mouse.up() },
      type: text => raw.keyboard.type(text), key: key => raw.keyboard.press(({ '\uE007': 'Enter', '\uE00C': 'Escape' })[key] || key),
      async close() { await raw.close(); page.closed = true },
    }
    raw.on('console', message => report.console.push({ page: name, type: message.type(), text: message.text() }))
    pages.push(page); return page
  }
  const inspect = (page, selector, { inPage = false, text = null } = {}) => page.evaluate(({ selector, inPage, text, ownedId }) => {
    const hosts = [...document.querySelectorAll('#__groundworks-nudge-host')]
    const root = inPage ? document : hosts.find(host => host.dataset.nudgeExtension === ownedId)?.shadowRoot
    const element = [...root?.querySelectorAll(selector) || []].find(element => text === null || element.textContent.includes(text))
    if (!element) return null
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: element.textContent, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', cls: element.className?.baseVal ?? element.className }
  }, { selector, inPage, text, ownedId: page.browser === 'safari' ? decodeURIComponent(extensionId) : report.chromeExtensionId })
  async function click(page, selector, options) {
    const rect = await until(async () => { const rect = await inspect(page, selector, options); return rect?.visible && rect }, `${page.name} visible ${selector}`)
    await page.click(rect.x + rect.w / 2, rect.y + rect.h / 2)
  }
  async function prompt(page, text, region = false) {
    if (region) await sleep(1100) // separate prior after-proof from Chromium's capture quota window
    await page.activate(); await page.key('\uE00C')
    await click(page, region ? '.btn-draw' : '.btn-pick')
    if (region) await page.drag([[100,260], [280,260], [280,370], [100,370], [100,260]])
    else await click(page, '#target', { inPage: true })
    await until(async () => (await inspect(page, '.composer'))?.visible, `${page.name} composer`)
    await page.type(text); await page.key('\uE007')
    const pin = await until(() => readStore().pins.find(pin => pin.text === text), `stored ${text}`)
    assert.equal(pin.browserSource?.browser, `${page.browser}-test`)
    if (region) assert(pin.screenshot, `${page.name} must produce real before pixels`)
    else assert(!pin.screenshot, 'DOM prompts remain screenshot-free')
    return pin
  }
  async function pixel(relative) {
    assert(relative?.startsWith('shots/'))
    const data = fs.readFileSync(path.join(store, relative)); assert.equal(data.subarray(1, 4).toString(), 'PNG')
    // Decode already-produced evidence without changing either source's focus.
    return chrome.pages()[0].evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      return [...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data]
    }, `data:image/png;base64,${data.toString('base64')}`)
  }
  const paint = (page, color) => page.evaluate(color => { document.getElementById('pixels').style.background = color }, color)
  const storedPin = id => readStore().pins.find(pin => pin.id === id)
  try {
    if (process.argv.includes('--headless')) throw blocked('--headless cannot establish simultaneous visible Safari/Chromium coexistence; use --chromium-only for that explicitly separate subset.')
    report.desktop = jointDesktopPreflight()
    await free(PORT); await free(PAGE); await free(DRIVER)
    for (const family of ['safari', 'chromium']) report.resources[family] = stageBrowserResources({ out: path.join(run, `${family}-extension`), port: PORT, family: `${family}-test` })
    bridge = launch(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: store, NUDGE_PORT: String(PORT), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    bridge.stderr.on('data', data => { bridgeLog += data })
    await until(async () => { if (bridge.startError) throw bridge.startError; try { return (await (await fetch(base + '/.identity')).json()).store === store } catch { return false } }, 'joint bridge identity')
    pageServer = http.createServer((request, response) => {
      const name = new URL(request.url, base).searchParams.get('tab')
      const label = ['Safari1', 'Safari2', 'Chromium1', 'Chromium2'].includes(name) ? name : 'permissions'
      response.setHeader('Content-Type', 'text/html')
      response.end(`<!doctype html><title>${title} ${label}</title><style>body{margin:40px;font:16px sans-serif}button{padding:12px}#pixels{position:absolute;left:80px;top:240px;width:240px;height:160px;background:rgb(20,180,90)}</style><h1>Joint browser fixture</h1><button id="target">Selected element</button><div id="pixels"></div>`)
    })
    await new Promise(resolve => pageServer.listen(PAGE, '127.0.0.1', resolve))
    await heartbeat(); beatTimer = setInterval(() => heartbeat().catch(() => {}), 1000)
    setFixtureTitle(`${title} permissions`)
    permissionWindow = true // even a timed-out creation may have opened the owned window
    openPermissionWindow(`http://localhost:${PAGE}/permissions`)
    safariProcess = launch('/usr/bin/safaridriver', ['-p', String(DRIVER)], { stdio: 'ignore' })
    await until(async () => { if (safariProcess.startError) throw safariProcess.startError; try { return (await fetch(`http://localhost:${DRIVER}/status`)).ok } catch { return false } }, 'SafariDriver listener')
    safari = new SafariDriver(`http://localhost:${DRIVER}`)
    await safari.start(); report.safariVersion = safari.capabilities.browserVersion
    assert(Number.parseInt(report.safariVersion) >= 26, 'Safari 26+ is required')
    await safari.goto(tabUrl('Safari1'))
    const existing = await safari.evaluate(() => [...document.querySelectorAll('#__groundworks-nudge-host')].filter(host => {
      const pill = host.shadowRoot?.querySelector('.pill'); return pill && getComputedStyle(pill).display !== 'none'
    }).map(host => host.dataset.nudgeExtension))
    if (existing.length) throw blocked('A pre-existing enabled Nudge overlay is active in the test session. Turn that installation off before this isolated joint run; the runner will not alter its global state.')
    extensionId = await safari.install(path.join(run, 'safari-extension')); report.safariExtensionId = extensionId
    await grantCurrentSite(extensionId)
    await safari.reload()
    const s1 = safariTab(await safari.command('GET', '/window'), 'Safari1')
    await until(async () => !!await inspect(s1, '.pill'), 'exact installed Safari content controller')
    if (!(await inspect(s1, '.pill')).visible) pressExtension(extensionId)
    closePermissionWindow(); permissionWindow = false
    await safari.command('POST', '/window/rect', { width: 1100, height: 900 })
    const second = await safari.command('POST', '/window/new', { type: 'tab' })
    await safari.command('POST', '/window', { handle: second.handle }); await safari.goto(tabUrl('Safari2'))
    const s2 = safariTab(second.handle, 'Safari2')
    const { chromium } = await import('playwright')
    chrome = await chromium.launchPersistentContext(path.join(run, 'chromium-profile'), { channel: 'chromium', headless: false, viewport: { width: 1100, height: 800 }, args: [`--disable-extensions-except=${path.join(run, 'chromium-extension')}`, `--load-extension=${path.join(run, 'chromium-extension')}`] })
    report.chromiumVersion = chrome.browser().version()
    const sw = chrome.serviceWorkers()[0] || await chrome.waitForEvent('serviceworker', { timeout: 5000 })
    report.chromeExtensionId = new URL(sw.url()).host
    const c1 = chromeTab(chrome.pages()[0], 'Chromium1'); await c1.raw.goto(tabUrl('Chromium1'))
    const c2 = chromeTab(await chrome.newPage(), 'Chromium2'); await c2.raw.goto(tabUrl('Chromium2'))
    for (const page of [s1, s2, c1, c2]) {
      await until(async () => (await inspect(page, '.status'))?.cls.includes('ok'), `${page.name} exact extension green`, 15000)
      assert.equal(await page.evaluate(() => new URL(location.href).pathname), '/same')
    }
    phase = 'behavior'
    let dom
    await check('four same-route tabs use correct browser families, distinct sessions/tabs and shared owner', async () => {
      dom = []
      for (const page of [s1, s2, c1, c2]) dom.push(await prompt(page, `[TEST-joint] ${page.name}`))
      assert.equal(dom[0].browserSource.session, dom[1].browserSource.session)
      assert.equal(dom[2].browserSource.session, dom[3].browserSource.session)
      assert.notEqual(dom[0].browserSource.session, dom[2].browserSource.session)
      assert.notEqual(dom[0].browserSource.tab, dom[1].browserSource.tab); assert.notEqual(dom[2].browserSource.tab, dom[3].browserSource.tab)
      for (const pin of dom) assert.equal(pin.owner.session, owners[0].session)
      report.sources = dom.map(pin => ({ browserSource: pin.browserSource, ua: pin.ua }))
    })
    await check('shared history and Safari owner selection are visible in Chromium', async () => {
      for (const page of [s1, c1]) {
        await page.activate(); await click(page, '.count')
        for (const pin of dom) assert((await inspect(page, '.queue .q-list')).text.includes(pin.text))
        await page.key('\uE00C')
      }
      await s1.activate(); await click(s1, '.who'); await click(s1, '.w-row', { text: owners[1].label })
      // Avoid switching WebDriver contexts while checking the foreground Chrome
      // tab: inspection of Safari is deliberately performed first.
      await until(async () => (await inspect(s1, '.who')).text.includes(owners[1].label), 'Safari owner switched')
      await until(async () => (await inspect(c1, '.who')).text.includes(owners[1].label), 'Chromium owner switched')
      const next = await prompt(c1, '[TEST-joint] reassigned owner')
      assert.equal(next.owner.session, owners[1].session); assert.equal(storedPin(dom[0].id).owner.session, owners[0].session)
    })
    for (const [source, sibling, other, label] of [[s1, s2, c1, 'Safari'], [c1, c2, s1, 'Chromium']]) {
      await check(`${label} inactive source defers across same-route tabs and the other browser; return captures exact source pixels`, async () => {
        await paint(source, 'rgb(20,180,90)'); await paint(sibling, 'rgb(20,40,210)'); await paint(other, 'rgb(210,40,210)')
        const pin = await prompt(source, `[TEST-joint] ${label} inactive region`, true)
        assert.deepEqual(await pixel(pin.screenshot), [20,180,90,255])
        await paint(source, 'rgb(200,40,60)'); await sibling.activate(); await other.activate()
        await post(`/comments/${pin.id}/resolve`)
        await sleep(1800)
        assert(!storedPin(pin.id).screenshotAfter, 'another tab/browser must not satisfy the hidden source')
        await source.activate()
        const after = await until(() => storedPin(pin.id).screenshotAfter, `${label} source-bound after image`, 15000)
        assert.deepEqual(await pixel(after), [200,40,60,255]); assert.deepEqual(storedPin(pin.id).afterBrowserSource, pin.browserSource)
      })
    }
    // Do closed-source checks last: the session still retains its sibling tab.
    for (const [source, sibling, other, label] of [[s1, s2, c2, 'Safari'], [c1, c2, s2, 'Chromium']]) {
      await check(`${label} closed source cannot fall back to another tab or browser`, async () => {
        const pin = await prompt(source, `[TEST-joint] ${label} closed region`, true)
        await source.close(); await sibling.activate(); await other.activate(); await post(`/comments/${pin.id}/resolve`)
        await sleep(1800); assert(!storedPin(pin.id).screenshotAfter)
        const metadata = (await (await fetch(base + '/comments')).json()).find(item => item.id === pin.id)
        assert.deepEqual(metadata.afterEvidence, { status: 'pending', reason: 'source_unavailable' })
      })
    }
    report.verdict = 'joint_subset_passed'
  } catch (error) {
    report.phase = phase; report.error = String(error)
    report.verdict = error.prerequisite ? 'blocked' : 'failed'
    process.exitCode = report.verdict === 'blocked' ? 2 : 1
    console.error(`${report.verdict.toUpperCase()}: ${error.message}`)
    if (phase === 'behavior') {
      try { if (safari?.session) fs.writeFileSync(path.join(run, 'safari-failure.png'), Buffer.from(await safari.command('GET', '/screenshot'), 'base64')) } catch {}
      try { if (chrome?.pages().length) await chrome.pages()[0].screenshot({ path: path.join(run, 'chromium-failure.png') }) } catch {}
    }
  } finally {
    clearInterval(beatTimer)
    const cleanup = async (name, action) => { try { await action(); report.cleanup.push({ name, verdict: 'done' }) } catch (error) { report.cleanup.push({ name, verdict: 'failed', error: String(error) }); report.verdict = 'cleanup_failed'; process.exitCode = 1 } }
    if (extensionId) await cleanup('uninstall exactly this temporary Safari extension', () => safari.uninstall(extensionId))
    if (safari?.session) await cleanup('close owned Safari WebDriver session', () => safari.close())
    if (permissionWindow) await cleanup('close exact unique permission-window title', () => closePermissionWindow())
    if (chrome) await cleanup('close owned Chromium profile', () => chrome.close())
    for (const child of ownedProcesses.reverse()) await cleanup('stop owned child process', async () => {
      if (child.exitCode === null && child.signalCode === null && !child.startError) child.kill('SIGTERM')
      const stopped = () => Promise.race([child.exited.then(() => true), sleep(1500).then(() => false)])
      if (!await stopped()) {
        child.kill('SIGKILL') // only this runner's child, never Safari or an existing listener
        if (!await stopped()) throw new Error('Owned child did not exit within the cleanup deadline')
      }
    })
    if (pageServer) await cleanup('close owned fixture server', async () => { pageServer.closeAllConnections(); await new Promise(resolve => pageServer.close(resolve)) })
    fs.writeFileSync(path.join(run, 'bridge.log'), bridgeLog)
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(`Evidence: ${path.relative(ROOT, run)}/report.json`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runJointCoexistence()
