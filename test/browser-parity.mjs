// Shared real-input contract: Safari WebDriver and a loaded Chromium extension.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SafariDriver } from './safari-driver.mjs'
import { stageBrowserResources, jointDesktopPreflight } from './browser-joint-coexistence.mjs'
import { runInteractions } from './parity-interactions.mjs'
import { pressExtension, grantCurrentSite, setFixtureTitle, openPermissionWindow, closePermissionWindow } from './safari-permissions.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const PORT = 4822, PAGE = 5322, DRIVER = 4821
const B = `http://localhost:${PORT}`
const isChrome = process.argv.includes('--chromium')
const headless = process.argv.includes('--headless')
if (headless && !isChrome) throw new Error('--headless is a Chromium implementation check, not a Safari mode')
const family = isChrome ? 'chromium' : 'safari'
const outRoot = path.join(ROOT, 'artifacts/safari')
fs.mkdirSync(outRoot, { recursive: true })
const run = fs.mkdtempSync(path.join(outRoot, `${family}-parity-`))
const fixtureTitle = `Nudge browser parity fixture ${path.basename(run)}`
setFixtureTitle(fixtureTitle + ' permissions')
const storeDir = path.join(run, 'store'), ext = path.join(run, 'extension')
const report = { browser: family, headless, scope: 'Core interaction contract, not full A01–A14 acceptance', results: [], limitations: ['Native app and distribution are outside this browser run.', 'This runner does not prove permission revocation, real Safari storage quota, Safari worker suspension, zoom or simultaneous Safari/Chrome coexistence.'] }
let driver, bridge, server, driverProcess, context, extensionId, heartbeat, bridgeLog = '', permissionWindow = false
const readStore = () => {
  try { return JSON.parse(fs.readFileSync(path.join(storeDir, 'store.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return {pins:[], receipts:[]}; throw error }
}
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms
  let value
  while (Date.now() < end) { value = await fn(); if (value) return value; await sleep(100) }
  throw new Error(`Timeout: ${label}; last=${JSON.stringify(value)}`)
}
async function free(port) {
  const probe = net.createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve))
  await new Promise(resolve => probe.close(resolve))
}
const post = async (route, data) => {
  const r = await fetch(B + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  assert(r.ok, `${route}: ${r.status}`); return r.json()
}
const inspect = (selector, page = false) => driver.evaluate(({ selector, page, ownedId }) => {
  const hosts = [...document.querySelectorAll('#__groundworks-nudge-host')]
  const root = page ? document : (ownedId ? hosts.find(h => h.dataset.nudgeExtension === ownedId) : hosts.at(-1))?.shadowRoot
  const e = root?.querySelector(selector)
  if (!e) return null
  const r = e.getBoundingClientRect(), s = getComputedStyle(e)
  return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent, value: e.value,
    cls: e.className?.baseVal ?? e.className, visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' }
}, { selector, page, ownedId: extensionId ? decodeURIComponent(extensionId) : null })
const click = async (selector, page = false) => {
  const r = await until(async () => { const r = await inspect(selector, page); return r?.visible && r }, `visible ${selector}`)
  await driver.click(r.x + r.w / 2, r.y + r.h / 2)
}
const escape = () => driver.key('\uE00C')
async function check(name, fn) {
  await fn(); report.results.push({ name, verdict: 'passed' }); console.log(`PASS ${family}: ${name}`)
}
async function pixels(relative, type) {
  assert(relative?.startsWith('shots/'), `Expected stored ${type} image, got ${relative}`)
  const data = fs.readFileSync(path.join(storeDir, relative))
  if (type === 'png') assert.equal(data.subarray(1,4).toString(), 'PNG')
  else assert.equal(data.readUInt16BE(0), 0xffd8)
  return driver.evaluate(async url => {
    const img = new Image(); img.src = url; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d'); ctx.drawImage(img,0,0)
    return {width:img.width,height:img.height,centre:[...ctx.getImageData(Math.floor(img.width/2),Math.floor(img.height/2),1,1).data]}
  }, `data:image/${type};base64,${data.toString('base64')}`)
}
try {
  if (!isChrome) report.preflight = jointDesktopPreflight()
  await free(PORT); await free(PAGE)
  report.resources = stageBrowserResources({ out: ext, port: PORT, family: `${family}-test` })
  // The actual staged bytes are installed below for every run.
  bridge = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_PORT: String(PORT), NUDGE_STORE: storeDir, NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  bridge.stdout.on('data', b => { bridgeLog += b }); bridge.stderr.on('data', b => { bridgeLog += b })
  await until(async () => { try { return (await (await fetch(B + '/.identity')).json()).store === storeDir } catch { return false } }, 'isolated bridge identity')
  const html = fs.readFileSync(path.join(ROOT, 'test/fixtures/safari-parity.html'), 'utf8').replace('Nudge browser parity fixture', fixtureTitle)
  server = http.createServer((req, res) => {
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end('body{margin:40px;font:16px sans-serif}button,input{padding:12px;margin:10px}#second{position:absolute;left:40px;top:450px}#pixels{position:absolute;left:80px;top:240px;width:240px;height:160px;background:rgb(20,180,90);color:white}#page-pop{position:fixed;left:40px;bottom:40px;padding:20px;background:white;border:1px solid black}') }
    if (req.url === '/early.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('console.error("PARITY_EARLY_HOOK");fetch("/missing");') }
    if (req.url === '/missing') { res.writeHead(404); return res.end('Expected missing fixture') }
    if (req.url === '/strict') res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'")
    res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/permissions' ? html.replace(fixtureTitle, fixtureTitle + ' permissions') : html)
  })
  await new Promise(resolve => server.listen(PAGE, '0.0.0.0', resolve))
  const owner = { label: 'parity-agent', pid: process.pid, session: 'parity', since: 1, wake: 'pull', host: 'Terminal' }
  const hb = () => post('/agent/heartbeat', owner)
  await hb(); heartbeat = setInterval(() => hb().catch(() => {}), 1000)
  if (isChrome) {
    const { chromium } = await import('playwright')
    context = await chromium.launchPersistentContext('', { channel:'chromium', headless, viewport: { width: 1100, height: 800 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] })
    const p = context.pages()[0]
    report.console = []
    p.on('console', message => report.console.push({type:message.type(),text:message.text()}))
    report.version = context.browser()?.version()
    driver = { evaluate: (fn, arg) => p.evaluate(fn, arg), goto: url => p.goto(url), reload: () => p.reload(), click: (x, y) => p.mouse.click(x, y),
      movePointer: (x, y) => p.mouse.move(x, y, { steps: 8 }), windowSize: async () => p.viewportSize(), resize: (width, height) => p.setViewportSize({ width, height }),
      drag: async points => { await p.mouse.move(...points[0]); await p.mouse.down(); for (const pt of points.slice(1)) await p.mouse.move(...pt, { steps: 8 }); await p.mouse.up() },
      key: k => p.keyboard.press(({ '\uE00C': 'Escape', '\uE007': 'Enter' })[k] || k), type: text => p.keyboard.type(text),
      keyDown: k => p.keyboard.down(({ '\uE008': 'Shift' })[k] || k),
      keyUp: k => p.keyboard.up(({ '\uE008': 'Shift' })[k] || k),
    }
  } else {
    openPermissionWindow(`http://localhost:${PAGE}/permissions`)
    permissionWindow = true
    await free(DRIVER)
    driverProcess = spawn('/usr/bin/safaridriver', ['-p', String(DRIVER)], { stdio: 'ignore' })
    await until(async () => { try { return (await fetch(`http://localhost:${DRIVER}/status`)).ok } catch { return false } }, 'SafariDriver')
    driver = new SafariDriver(`http://localhost:${DRIVER}`)
    await driver.start(); report.version = driver.capabilities.browserVersion
    await driver.goto(`http://localhost:${PAGE}/`)
    if ((await inspect('.pill'))?.visible) {
      throw Object.assign(new Error('An existing Safari Nudge overlay is enabled. This isolated test will not toggle its browser-wide state or disturb unsent work; use a dedicated test browser session.'), { prerequisite: true })
    }
    await driver.evaluate(() => sessionStorage.clear()) // this runner's fixture only
    extensionId = await driver.install(ext)
    report.extensionId = extensionId
    await driver.command('POST', '/window/rect', { width: 1100, height: 900 })
  }
  await driver.goto(`http://localhost:${PAGE}/`)
  if (!isChrome) {
    await grantCurrentSite(extensionId); await driver.reload()
    await until(async () => !!await inspect('.pill'), 'fresh content controller')
    if (!(await inspect('.pill')).visible) pressExtension(extensionId)
    closePermissionWindow()
    permissionWindow = false
  }
  await check('fresh extension / HTTP + WS / green pull owner', async () => {
    await until(async () => (await inspect('.status'))?.cls.includes('ok'), 'green status', 15000)
    await until(async () => (await inspect('.pill'))?.visible, 'own toolbar visible')
    assert((await inspect('.who')).text.includes('parity-agent'))
    assert((await inspect('.who')).text.includes('Pull'))
  })
  await check('live push/pull changes update the toolbar and open status menu without reload', async () => {
    await click('.status')
    await until(async () => (await inspect('.sm-body'))?.text.includes('next message'), 'initial pull explanation')
    owner.wake = 'push'; await hb()
    await until(async () => !(await inspect('.who-wake'))?.visible && (await inspect('.sm-body'))?.text.includes('automatically'), 'push state reaches open controls')
    owner.wake = 'pull'; await hb()
    await until(async () => (await inspect('.who-wake'))?.visible && (await inspect('.sm-body'))?.text.includes('next message'), 'pull state reaches open controls')
    assert((await inspect('.status')).cls.includes('ok'), 'capability update preserves the live connection')
    await escape()
  })
  await check('repeated real grip drag and persisted position', async () => {
    report.drags = []
    for (const [x, y] of [[470, 140], [610, 180], [470, 140]]) {
      const g = await inspect('.grip'), p = await inspect('.pill')
      await driver.drag([[g.x + g.w / 2, g.y + g.h / 2], [x, y]])
      report.drags.push({g, p, x, y, after: await inspect('.pill'), gripAfter: await inspect('.grip')})
      await until(async () => { const a = await inspect('.pill'); return Math.abs(a.x - (x - (g.x + g.w / 2 - p.x))) < 3 && Math.abs(a.y - (y - (g.y + g.h / 2 - p.y))) < 3 }, 'both drag coordinates reached')
      const dropped = await inspect('.pill')
      await driver.movePointer(40, 40)
      const released = await inspect('.pill')
      assert(Math.abs(released.x - dropped.x) < 3 && Math.abs(released.y - dropped.y) < 3, 'released toolbar must not follow the pointer')
      assert(!(await inspect('.grip')).cls.includes('dragging'), 'release clears drag state')
    }
    const before = await inspect('.pill'); await driver.reload()
    await until(async () => { const restored = await inspect('.pill'); return restored && Math.abs(restored.x - before.x) < 3 && Math.abs(restored.y - before.y) < 3 }, 'both position coordinates restored')
  })
  await check('toolbar remains reachable at all viewport corners and after window resize', async () => {
    const edgePin = await post('/comments', { text: '[TEST-parity] Edge menu control', url: `http://localhost:${PAGE}/`, target: { selector: '#target' } })
    await until(async () => (await inspect('.count'))?.cls.includes('show'), 'edge queue badge')
    const size = await driver.windowSize()
    const inside = async () => {
      const p = await inspect('.pill'), g = await inspect('.grip')
      const v = await driver.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }))
      assert(p.visible && g.visible && p.x >= 0 && p.y >= 0 && p.x + p.w <= v.w + 1 && p.y + p.h <= v.h + 1, 'entire toolbar and grip must remain inside the viewport')
      return v
    }
    report.toolbarBounds = []
    const originalViewport = await inside()
    try {
      for (const [right, bottom] of [[false,false],[true,false],[true,true],[false,true]]) {
        const v = await inside(), g = await inspect('.grip')
        await driver.drag([[g.x + g.w / 2, g.y + g.h / 2], [right ? v.w - 2 : 2, bottom ? v.h - 2 : 2]])
        await inside()
        const corner = await inspect('.pill')
        assert((right ? v.w - corner.x - corner.w : corner.x) <= 6 && (bottom ? v.h - corner.y - corner.h : corner.y) <= 6, 'real drag must reach the requested corner, not merely remain in bounds')
        report.toolbarBounds.push(corner)
        for (const [control, menu] of [['.status', '.status-menu'], ['.who', '.who-menu'], ['.count', '.queue']]) {
          await click(control)
          await until(async () => (await inspect(menu))?.cls.includes('on'), `${menu} opens at corner`)
          await sleep(200) // observe the settled animation, not its entrance transform
          const box = await inspect(menu)
          assert(box.visible && box.x >= 0 && box.y >= 0 && box.x + box.w <= v.w + 1 && box.y + box.h <= v.h + 1, `${menu} must be fully inside the viewport at ${right ? 'right' : 'left'}/${bottom ? 'bottom' : 'top'}: ${JSON.stringify(box)}`)
          assert.equal(box.cls.split(/\s+/).includes('above'), bottom, 'bottom menus flip above the toolbar')
          if (right && bottom && menu === '.queue') {
            const image = path.join(run, 'bottom-edge-queue.png')
            if (isChrome) await context.pages()[0].screenshot({ path: image })
            else fs.writeFileSync(image, Buffer.from(await driver.command('GET', '/screenshot'), 'base64'))
          }
          await escape()
          assert(!(await inspect(menu))?.cls.split(/\s+/).includes('on'), 'Escape closes the edge menu')
        }
      }
      await driver.resize(720, 620)
      await sleep(250)
      const smaller = await inside()
      assert(smaller.w < originalViewport.w && smaller.h < originalViewport.h, 'window resize must actually shrink both viewport dimensions')
    } finally {
      await driver.resize(size.width, size.height)
      assert((await fetch(`${B}/comments/${edgePin.id}`, { method: 'DELETE' })).ok)
    }
    await sleep(250)
    const restoredViewport = await inside(), restoredPill = await inspect('.pill'), dropped = report.toolbarBounds.at(-1)
    assert(Math.abs(restoredViewport.w - originalViewport.w) < 2 && Math.abs(restoredViewport.h - originalViewport.h) < 2, 'original viewport must be restored')
    assert(Math.abs(restoredPill.x - dropped.x) < 3 && Math.abs(restoredPill.y - dropped.y) < 3, 'resize must preserve the dropped position')
    const g = await inspect('.grip')
    await driver.drag([[g.x + g.w / 2, g.y + g.h / 2], [470,140]])
    await inside() // following core cases exercise controls after all these drags
  })
  await check('status popover, Escape, repeated Pick and Cancel', async () => {
    await click('.status'); await until(async () => (await inspect('.status-menu'))?.cls.includes('on'), 'status menu opens')
    await escape(); await until(async () => !(await inspect('.status-menu'))?.cls.includes('on'), 'status menu closes')
    for (let i = 0; i < 3; i++) {
      await click('.btn-pick'); await click('#target', true)
      await until(async () => (await inspect('.composer'))?.visible, 'composer opens')
      await click('.composer .cancel'); await until(async () => !(await inspect('.composer'))?.visible, 'cancel closes composer')
    }
  })
  let domId
  await check('DOM pick, typing, send, context and early console/network hook', async () => {
    await click('.btn-pick'); await click('#target', true)
    await driver.type('[TEST-parity] More space')
    await until(async () => (await inspect('textarea'))?.value === '[TEST-parity] More space', 'typed text')
    await driver.key('\uE007')
    const pin = await until(() => readStore().pins?.find(p => p.text === '[TEST-parity] More space'), 'stored DOM pin')
    domId = pin.id
    assert.equal(pin.target.selector, '#target'); assert(pin.target.xpath); assert(pin.browserSource?.tab)
    assert.equal(pin.browserSource.browser, `${family}-test`, 'provenance must name the actual tested browser family')
    assert(readStore().receipts.find(r => r.id === pin.id)?.submissionId)
    assert(!pin.screenshot, 'DOM picks remain shot-free')
    assert(JSON.stringify(pin).includes('PARITY_EARLY_HOOK'), 'MAIN document_start hook')
    assert(JSON.stringify(pin).includes('/missing'), 'network failure context')
  })
  await check('DOM resolve feedback', async () => {
    await post(`/comments/${domId}/resolve`, {})
    await until(async () => (await inspect('.feed'))?.text.includes('done'), 'resolution feedback')
    assert(!readStore().pins.find(p => p.id === domId).screenshotAfter)
  })
  await check('Freeform before/overview/after evidence', async () => {
    await click('.btn-draw')
    await driver.drag([[100,260],[280,260],[280,370],[100,370],[100,260]])
    await until(async () => (await inspect('.composer'))?.visible, 'lasso composer')
    await driver.type('[TEST-parity] Region'); await driver.key('\uE007')
    const pin = await until(() => readStore().pins.find(p => p.text === '[TEST-parity] Region'), 'stored region', 12000)
    const before = await pixels(pin.screenshot, 'png')
    assert.deepEqual(before.centre, [20,180,90,255], 'before crop must contain fixture green pixels')
    const overview = await pixels(pin.screenshotFull, 'jpeg')
    assert(overview.width > before.width && overview.height > before.height)
    await driver.evaluate(() => { document.getElementById('pixels').style.background = 'rgb(200,40,60)' })
    await post(`/comments/${pin.id}/resolve`, {})
    const after = await until(() => readStore().pins.find(p => p.id === pin.id)?.screenshotAfter, 'source-bound after image', 15000)
    const afterPixels = await pixels(after, 'png')
    assert.deepEqual(afterPixels.centre, [200,40,60,255], 'after crop must contain changed red pixels')
    report.pixels = {before, overview, after:afterPixels}
  })
  await runInteractions({driver, check, inspect, click, escape, readStore, until, report})
  if (isChrome) await check('ambiguous RPC acknowledgement survives reload without duplicate or page-visible control tokens', async () => {
    const worker = context.serviceWorkers()[0]
    // Fault injection is privileged test setup. The real queue owner continues
    // its durable write and HTTP commit, but this first responder substitutes
    // an ambiguous response to the content RPC. UI retries remain real input.
    await worker.evaluate(() => {
      const once = (message, sender, reply) => {
        if (message.type !== 'nudge-queue' || message.action !== 'submit') return
        chrome.runtime.onMessage.removeListener(once)
        reply({ok:false,error:'injected_ack_loss'})
      }
      chrome.runtime.onMessage.addListener(once)
    })
    const text='[TEST-parity] Ambiguous acknowledgement'
    await click('.btn-pick'); await click('#target',true); await driver.type(text); await driver.key('\uE007')
    const pin=await until(()=>readStore().pins.find(p=>p.text===text),'server committed despite missing client acknowledgment')
    await until(async()=> (await inspect('.feed'))?.text.includes('prompt kept'),'ambiguous result preserves composer')
    assert((await inspect('.composer')).visible)
    const snapshot=await driver.evaluate(()=>sessionStorage.getItem('__rootsNudgeSession'))
    assert(!snapshot.includes(pin.browserSource.session) && !snapshot.includes(pin.browserSource.tab) && !snapshot.includes(pin.browserSource.document),'MAIN-world sessionStorage must not receive source control tokens')
    assert(JSON.parse(snapshot).composer.retryRef,'only an opaque draft reference belongs in page storage')
    await driver.reload()
    await until(async()=> (await inspect('.composer textarea'))?.value===text,'ambiguous draft restored')
    await click('.composer .send')
    await until(async()=> !(await inspect('.composer'))?.visible,'exact replay acknowledged')
    assert.equal(readStore().pins.filter(p=>p.text===text).length,1)
    await until(async()=> !(Object.keys(await worker.evaluate(()=>chrome.storage.local.get(null))).some(k=>k.startsWith('nudgeDraftRetry-'))),'acknowledged private retry payload collected')
  })
  for (const url of [`http://127.0.0.1:${PAGE}/`, `http://localhost:${PAGE}/strict`]) {
    await check(`transport and DOM send: ${new URL(url).hostname}${new URL(url).pathname}`, async () => {
      await driver.goto(url); await until(async () => (await inspect('.status'))?.cls.includes('ok'), 'green under page policy', 15000)
      await click('.btn-pick'); await click('#target', true)
      const text = `[TEST-parity] policy ${new URL(url).hostname}${new URL(url).pathname}`
      await driver.type(text); await driver.key('\uE007')
      const pin = await until(() => readStore().pins.find(p => p.text === text), 'DOM delivery under page policy')
      assert.equal(pin.target.selector, '#target')
      assert(JSON.stringify(pin).includes('PARITY_EARLY_HOOK'), 'early MAIN hook under page policy')
    })
  }
  report.verdict = 'passed'
} catch (error) {
  report.verdict = error.prerequisite ? 'blocked' : 'failed'; report.error = String(error); console.error(error)
  if (driver) {
    try {
      report.feed = await inspect('.feed'); report.composer = await inspect('.composer')
      report.targets = [await inspect('#target',true), await inspect('#second',true)]
      report.meta = await inspect('.composer .meta')
      if (isChrome) await context.pages()[0].screenshot({path:path.join(run,'failure.png')})
    } catch {}
    if (isChrome) { try {
      const worker = context.serviceWorkers()[0]
      report.queue = await worker.evaluate(() => chrome.storage.local.get('nudgeQueue'))
      report.backgroundDiagnostics = await worker.evaluate(async base => {
        const get = await fetch(base+'/.identity')
        const post = await fetch(base+'/diagnostic-not-a-route', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        return {get:{status:get.status,body:await get.json()},post:{status:post.status,body:await post.text()}}
      }, B)
    } catch (e) {report.backgroundDiagnosticError=String(e)} }
    try { report.dom = await driver.evaluate(() => ({ title: document.title, url: location.href, platform: globalThis.__nudgePlatform, hosts: [...document.querySelectorAll('#__groundworks-nudge-host')].map(h => ({html:h.outerHTML, status:h.shadowRoot?.querySelector('.status')?.outerHTML, styles:[...h.shadowRoot?.querySelectorAll('style') || []].map(s=>s.textContent.slice(0,1800))})) })) } catch {}
    if (!isChrome) { try { fs.writeFileSync(path.join(run, 'failure.png'), Buffer.from(await driver.command('GET', '/screenshot'), 'base64')) } catch {} }
  }
  process.exitCode = error.prerequisite ? 2 : 1
} finally {
  console.log('Cleanup: test resources')
  clearInterval(heartbeat)
  if (permissionWindow) { try { closePermissionWindow() } catch (e) {report.cleanupError=String(e)} }
  if (extensionId) { try { await driver.uninstall(extensionId) } catch (e) {report.cleanupError=String(e)} }
  if (!isChrome) { try { await driver?.close() } catch (e) {report.cleanupError=String(e)} }
  await context?.close(); driverProcess?.kill(); bridge?.kill()
  if (server) { server.close(); server.closeAllConnections() }
  if (report.cleanupError) { report.verdict = 'failed'; process.exitCode = 1 }
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(run, 'bridge.log'), bridgeLog)
  console.log(`Evidence: ${path.relative(ROOT, run)}/report.json`)
}
