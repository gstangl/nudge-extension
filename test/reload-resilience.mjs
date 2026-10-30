// Suite Q — Reload resilience. 2026-07-29: "every time the browser reloads
// because the agent is doing something in the background, my Nudge bar briefly
// disappears, my input field too, and I lose what I was about to do."
// The dev server reloads the tab under the user's hands; the content script dies
// with the half-written nudge in it. A content script cannot survive a
// navigation — so the WORKING state is snapshotted into sessionStorage and
// rebuilt on the next load. Legs cover the promise and its accepted worst case:
// the typed text ALWAYS comes back, the DOM anchor only if the app renders that
// element again (incl. late hydration), and a mark whose element is gone still
// sends instead of throwing.
// Hermetic: own page server on 5196, extension re-pointed to a DEAD bridge port
// (4799) so no fetch can ever reach the user's live bridge on 4700.
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = process.env.NUDGE_EXT || path.join(HERE, '../extension')
const PAGE = 5196
const DEAD_PORT = 4799 // nothing listens here — the live bridge stays untouched
const sleep = ms => new Promise(r => setTimeout(r, ms))

// `?gone=1` drops #alpha — the element the agent's edit removed from the render.
// #late appears only after 900ms: the SPA-hydration case the restore must wait for.
const HTML = `<!doctype html><html><head><meta charset=utf8><title>reload</title><style>
  body{margin:0;font-family:sans-serif;padding:40px}
  .box{width:240px;height:64px;background:#eee;border:1px solid #ccc;margin:12px 0;display:flex;align-items:center;justify-content:center}
</style></head><body>
  <div id="wrap"></div>
  <script>
    const wrap = document.getElementById('wrap')
    const add = (id, label) => wrap.insertAdjacentHTML('beforeend', '<div class="box" id="' + id + '">' + label + '</div>')
    if (!new URLSearchParams(location.search).has('gone')) add('alpha', 'Alpha')
    add('beta', 'Beta')
    add('gamma', 'Gamma')
    setTimeout(() => add('late', 'Late'), 900)
  </script>
</body></html>`

const pageSrv = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(HTML) }).listen(PAGE)
let failed = 0
const fail = (m) => { console.error('FAIL:', m); failed++ }
const pass = (m) => console.log('PASS', m)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: process.env.NUDGE_HEADLESS === '1', channel: 'chromium', viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  let sw = ctx.serviceWorkers()[0]
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  await sw.evaluate((port) => chrome.storage.local.set({ nudgePort: port }), DEAD_PORT)

  const p = await ctx.newPage()
  const sr = 'document.getElementById("__groundworks-nudge-host").shadowRoot'
  const ready = async () => { await p.locator('.pill').waitFor({ timeout: 15000 }); await sleep(250) }
  const meta = () => p.evaluate(`${sr}.querySelector('.composer .meta').textContent`)
  const metaLost = () => p.evaluate(`${sr}.querySelector('.composer .meta').classList.contains('lost')`)
  const taVal = () => p.evaluate(`${sr}.querySelector('.composer textarea').value`)
  const open = () => p.evaluate(`getComputedStyle(${sr}.querySelector('.composer')).display === 'block'`)
  const hlTop = () => p.evaluate(`${sr}.querySelector('.hl').classList.contains('on') ? parseFloat(${sr}.querySelector('.hl').style.top) : null`)
  const outlines = () => p.evaluate(`${sr}.querySelectorAll('.hl-multi').length`)
  const topOf = (id) => p.evaluate(`document.getElementById('${id}').getBoundingClientRect().top`)
  const at = async (id) => p.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
  const arm = async () => { await p.keyboard.press('Escape'); await sleep(120); await p.evaluate(`${sr}.querySelector('.btn-pick').click()`); await sleep(150) }
  const click = async (id) => { const c = await at(id); await p.mouse.click(c.x, c.y); await sleep(300) }
  const shiftClick = async (id) => { const c = await at(id); await p.keyboard.down('Shift'); await p.mouse.click(c.x, c.y); await p.keyboard.up('Shift'); await sleep(300) }
  const until = async (fn, ms, what) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150) }
    fail(`timeout waiting for ${what}`)
    return false
  }

  await p.goto(`http://localhost:${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await ready()

  // ---------- Q1: the half-written nudge comes back ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('round off this edge')
    await sleep(400) // let the snapshot settle (pagehide flushes anyway)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (!await open()) fail('Q1: the composer did not come back after the reload')
    else if (await taVal() !== 'round off this edge') fail(`Q1: typed text lost, got "${await taVal()}"`)
    else if (!(await meta()).includes('#beta')) fail(`Q1: the mark lost its target, meta="${await meta()}"`)
    else pass('Q1 draft + target survive a page reload')
  }

  // ---------- Q2: the mark re-attaches to the live element ----------
  {
    const ok = await until(async () => !await metaLost() && await hlTop() !== null, 8000, 'the highlight to re-attach')
    const dy = Math.abs((await hlTop()) - (await topOf('beta')))
    if (!ok) { /* already reported */ }
    else if (dy > 3) fail(`Q2: the highlight is ${dy}px off the element it marks`)
    else pass('Q2 the restored mark snaps back onto its live element')
  }

  // ---------- Q3: an element that hydrates LATE is still found ----------
  {
    await arm()
    await until(async () => p.evaluate(`!!document.getElementById('late')`), 4000, '#late to render')
    await click('late')
    await p.keyboard.type('this one only after hydration')
    await sleep(400)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready() // the content script is up while #late does not exist yet
    if (await taVal() !== 'this one only after hydration') fail('Q3: text lost on the late-element reload')
    else if (!await until(async () => !await metaLost() && await hlTop() !== null, 8000, 'the late element to be relocated')) { /* reported */ }
    else if (!(await meta()).includes('#late')) fail(`Q3: relocated onto the wrong node, meta="${await meta()}"`)
    else pass('Q3 an element rendered ~1s after load is found inside the retry window')
  }

  // ---------- Q4: the element never comes back — text survives, the mark says so ----------
  {
    await arm()
    await click('alpha')
    await p.keyboard.type('Alpha is about to vanish')
    await sleep(400)
    await p.goto(`http://localhost:${PAGE}/?gone=1`, { waitUntil: 'domcontentloaded' }) // same route, #alpha no longer rendered
    await ready()
    if (!await open()) fail('Q4: composer gone — the draft must outlive its element')
    else if (await taVal() !== 'Alpha is about to vanish') fail(`Q4: typed text lost with the element, got "${await taVal()}"`)
    else if (!await until(metaLost, 12000, 'the mark to report its lost anchor')) { /* reported */ }
    else if (!(await meta()).startsWith('element gone')) fail(`Q4: the meta must SAY the anchor is gone, got "${await meta()}"`)
    else pass('Q4 element gone: text kept, anchor honestly reported as lost')
  }

  // ---------- Q5: such a mark still sends (frozen context, no crash) ----------
  {
    const errs = []
    p.on('pageerror', e => errs.push(String(e)))
    await p.evaluate(`${sr}.querySelector('.composer .send').click()`)
    await until(async () => !await open(), 5000, 'offline draft acknowledgement')
    const chips = await p.evaluate(`[...${sr}.querySelectorAll('.feed .feed-text')].map(n => n.textContent)`)
    if (errs.length) fail(`Q5: sending an anchor-less mark threw: ${errs[0]}`)
    else if (!chips.some(t => /queued|offline/i.test(t))) fail(`Q5: no send feedback, chips=${JSON.stringify(chips)}`)
    else if (await open()) fail('Q5: the composer stayed open after the send')
    else pass('Q5 a mark whose element is gone still sends (queued offline, no crash)')
  }

  // ---------- Q6: a cancelled draft must NOT resurrect ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('never mind, not this')
    await sleep(300)
    await p.keyboard.press('Escape')
    await sleep(300)
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    await sleep(600)
    if (await open()) fail(`Q6: a cancelled composer came back with "${await taVal()}"`)
    else pass('Q6 Escape before the reload leaves nothing to restore')
  }

  // ---------- Q7: a Shift-collected multi-selection survives too ----------
  {
    await arm()
    await click('beta')
    await shiftClick('gamma')
    await p.keyboard.type('swap these two')
    await sleep(400)
    if (await outlines() !== 2) {
      console.error('Q7 diagnostics', await p.evaluate(() => {
        const r = document.querySelector('#__groundworks-nudge-host').shadowRoot
        const n = document.getElementById('gamma'), b = n.getBoundingClientRect()
        return {meta:r.querySelector('.meta').textContent, text:r.querySelector('textarea').value,
          hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,400),
          pill:r.querySelector('.pill').getBoundingClientRect().toJSON(),composer:r.querySelector('.composer').getBoundingClientRect().toJSON()}
      }))
      fail('Q7: setup — the multi-selection did not form')
    }
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (await taVal() !== 'swap these two') fail('Q7: text lost on the multi reload')
    else if (!await until(async () => await outlines() === 2, 8000, 'both outlines to come back')) { /* reported */ }
    else if (!(await meta()).startsWith('2 elements')) fail(`Q7: the set lost its count, meta="${await meta()}"`)
    else pass('Q7 a Shift-collected set of elements survives the reload')
  }

  // ---------- Q8: failed private storage must not poison the next reload ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('Recover after retry quota failure')
    await sw.evaluate(async () => {
      const used = await chrome.storage.local.getBytesInUse(null)
      const key = 'testRetryQuotaFiller'
      await chrome.storage.local.set({ [key]: 'x'.repeat(chrome.storage.local.QUOTA_BYTES - used - key.length - 128) })
    })
    await p.locator('.composer .send').click()
    await until(async () => p.locator('.feed').innerText().then(t => t.includes('Retry storage unavailable')), 5000, 'quota failure feedback')
    if (!await open()) fail('Q8: quota failure consumed the draft')
    // Wait for the normal deferred snapshot as well as exercising pagehide.
    await sleep(350)
    await sw.evaluate(() => chrome.storage.local.remove('testRetryQuotaFiller'))
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (await taVal() !== 'Recover after retry quota failure') fail('Q8: draft text lost after storage failure')
    await p.locator('.composer .send').click()
    if (await until(async () => !await open(), 5000, 'restored draft to submit after quota recovery')) {
      const entries = await sw.evaluate(() => chrome.storage.local.get('nudgeQueue'))
      if (!JSON.stringify(entries).includes('Recover after retry quota failure')) fail('Q8: recovered prompt missing from durable queue')
      else pass('Q8 quota failure followed by reload preserves a sendable draft')
    }
  }

  // ---------- Q9: lost acknowledgement replays the same queued submission ----------
  {
    await sw.evaluate(() => {
      const once = (message, sender, reply) => {
        if (message.type !== 'nudge-queue' || message.action !== 'submit') return
        chrome.runtime.onMessage.removeListener(once)
        reply({ ok: false, error: 'injected_ack_loss' })
      }
      chrome.runtime.onMessage.addListener(once)
    })
    await arm()
    await click('beta')
    await p.keyboard.type('Replay the same queued submission')
    await p.locator('.composer .send').click()
    const matching = () => sw.evaluate(async () =>
      (await chrome.storage.local.get('nudgeQueue')).nudgeQueue.entries
        .filter(entry => entry.payload.text === 'Replay the same queued submission'))
    await until(async () => (await matching()).length === 1, 5000, 'queue commit despite lost acknowledgement')
    if (!await open()) fail('Q9: injected acknowledgement loss did not preserve the composer')
    const original = (await matching())[0]?.payload.submissionId
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    if (await taVal() !== 'Replay the same queued submission') fail('Q9: ambiguous draft lost on reload')
    await p.locator('.composer .send').click()
    if (await until(async () => !await open(), 5000, 'exact replay acknowledgement')) {
      const entries = await matching()
      if (entries.length !== 1 || entries[0].payload.submissionId !== original) fail('Q9: replay duplicated or replaced the queued submission')
      else pass('Q9 ambiguous acknowledgement survives reload with exactly one queued submission')
    }
  }

  // ---------- Q10: a malformed page event cannot strand Send ----------
  {
    await arm()
    await click('beta')
    await p.keyboard.type('Send despite malformed console context')
    await p.evaluate(() => {
      addEventListener('groundworks-nudge-console-req', () => {
        dispatchEvent(new CustomEvent('groundworks-nudge-console-res', { detail: '{invalid' }))
      }, { capture: true, once: true })
    })
    await p.locator('.composer .send').click()
    if (await until(async () => !await open(), 5000, 'send after malformed page-console event')) {
      const entries = await sw.evaluate(async () => (await chrome.storage.local.get('nudgeQueue')).nudgeQueue.entries)
      const sent = entries.filter(entry => entry.payload.text === 'Send despite malformed console context')
      if (sent.length !== 1 || sent[0].payload.console.length !== 0) fail('Q10: malformed console context was not safely discarded')
      else pass('Q10 malformed console context cannot leave Send disabled')
    }
  }

  // ---------- Q11: a composing mark follows page scroll, even while Send is disabled ----------
  {
    await arm()
    await p.evaluate(() => {
      document.body.style.minHeight = '2400px'
      document.getElementById('wrap').innerHTML = '<div id="scroll-target" class="box" style="margin-top:300px">Scroll target</div>'
      scrollTo(0, 0)
    })
    await click('scroll-target')
    await p.keyboard.type('Keep this draft while scrolling')
    await p.evaluate(() => {
      const root = document.getElementById('__groundworks-nudge-host').shadowRoot
      root.querySelector('textarea').setSelectionRange(5, 9)
      root.querySelector('.send').disabled = true
    })
    const before = await p.locator('.composer').boundingBox()
    await p.mouse.move(1000, 650)
    await p.mouse.wheel(0, 120)
    await sleep(350)
    const delta = await p.evaluate(() => {
      const root = document.getElementById('__groundworks-nudge-host').shadowRoot
      const mark = root.querySelector('.hl').getBoundingClientRect()
      const target = document.getElementById('scroll-target').getBoundingClientRect()
      const ta = root.querySelector('textarea')
      return { offset: Math.abs(mark.top - target.top), scroll: scrollY, text: ta.value,
        start: ta.selectionStart, end: ta.selectionEnd, focused: root.activeElement === ta,
        disabled: root.querySelector('.send').disabled }
    })
    const after = await p.locator('.composer').boundingBox()
    console.log('Q11 scroll geometry:', JSON.stringify({ ...delta, composerMovement: before.y - after.y }))
    if (delta.scroll < 80 || delta.offset > 2 || Math.abs(before.y - after.y - delta.scroll) > 2)
      fail('Q11: single highlight/composer stayed behind during page scroll')
    else if (delta.text !== 'Keep this draft while scrolling' || delta.start !== 5 || delta.end !== 9 || !delta.focused || !delta.disabled)
      fail('Q11: following the target changed the draft, caret, focus or send state')
    else pass('Q11 page scroll keeps highlight/composer anchored without changing a pending draft')
    await p.evaluate(`${sr}.querySelector('.send').disabled = false`)
  }

  // ---------- Q12: nested scroll and responsive reflow use fresh element geometry ----------
  {
    await arm()
    await p.evaluate(() => {
      scrollTo(0, 0)
      document.getElementById('wrap').innerHTML = '<div id="scroller" style="height:420px;width:400px;overflow:auto"><div style="height:1000px;padding-top:240px"><div id="nested-target" class="box" style="margin-left:10vw">Nested target</div></div></div>'
    })
    await click('nested-target')
    await p.keyboard.type('Nested draft')
    const before = await p.locator('.composer').boundingBox()
    await p.mouse.move(70, 180)
    await p.mouse.wheel(0, 100)
    await sleep(350)
    const after = await p.locator('.composer').boundingBox()
    const offset = await p.evaluate(`${sr}.querySelector('.hl').getBoundingClientRect().top - document.getElementById('nested-target').getBoundingClientRect().top`)
    if (Math.abs(offset) > 2 || before.y - after.y < 80) fail('Q12: nested scrolling did not move the mark and composer')
    else pass('Q12 nested container scroll keeps the draft beside its target')
    await p.setViewportSize({ width: 1000, height: 700 })
    await sleep(350)
    const geometry = await p.evaluate(() => {
      const root = document.getElementById('__groundworks-nudge-host').shadowRoot
      const target = document.getElementById('nested-target').getBoundingClientRect()
      const mark = root.querySelector('.hl').getBoundingClientRect()
      const composer = root.querySelector('.composer').getBoundingClientRect()
      return { offset: Math.abs(target.left - mark.left), gap: composer.left - target.right }
    })
    if (geometry.offset > 2 || Math.abs(geometry.gap - 14) > 2 || await taVal() !== 'Nested draft')
      fail('Q12: responsive layout left stale highlight/composer coordinates')
    else pass('Q12 resizing refreshes the live anchor without resetting text')
  }

  // ---------- Q13: a removed target must not leave a false highlight ----------
  {
    await p.evaluate(() => document.getElementById('nested-target').remove())
    await p.mouse.move(70, 180)
    await p.mouse.wheel(0, 80)
    await sleep(350)
    if (await p.evaluate(`${sr}.querySelector('.hl').classList.contains('on')`) || !await metaLost() || await taVal() !== 'Nested draft')
      fail('Q13: detached target kept a stale mark or lost the draft')
    else pass('Q13 scrolling after target removal hides the stale highlight and keeps the draft')
    await p.keyboard.press('Escape')
    await p.mouse.wheel(0, 80)
    await sleep(200)
    if (await open()) fail('Q13: scrolling resurrected a cancelled composer')
  }

  // Q14: freeform coordinates follow both page and nested scrolling.
  {
    await p.keyboard.press('Escape')
    await p.setViewportSize({ width: 1200, height: 800 })
    await p.evaluate(() => {
      scrollTo(0, 0)
      document.getElementById('wrap').innerHTML = '<div id="scroller" style="height:500px;width:500px;overflow:auto"><div style="height:1200px;padding-top:260px"><div id="region-target" class="box">Region target</div></div></div>'
    })
    await p.locator('.btn-draw').click()
    const b = await p.locator('#region-target').boundingBox()
    await p.mouse.move(b.x - 5, b.y - 5)
    await p.mouse.down()
    await p.mouse.move(b.x + b.width + 5, b.y - 5, { steps: 8 })
    await p.mouse.move(b.x + b.width + 5, b.y + b.height + 5, { steps: 8 })
    await p.mouse.move(b.x - 5, b.y + b.height + 5, { steps: 8 })
    await p.mouse.up()
    await until(open, 4000, 'freeform composer')
    await p.locator('.composer textarea').fill('Keep the region attached')
    await p.locator('.composer').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
    const geometry = () => p.evaluate(() => {
      const r = document.getElementById('__groundworks-nudge-host').shadowRoot
      const target = document.getElementById('region-target').getBoundingClientRect()
      const stroke = r.querySelector('.draw path').getBoundingClientRect()
      const composer = r.querySelector('.composer').getBoundingClientRect()
      return { offset: stroke.top - target.top, stroke: stroke.top, composer: composer.top }
    })
    const before = await geometry()
    await p.mouse.move(450, 220)
    await p.mouse.wheel(0, 100)
    await sleep(350)
    const nested = await geometry()
    await p.mouse.move(1100, 650)
    await p.mouse.wheel(0, 80)
    await sleep(350)
    const page = await geometry()
    console.log('Q14 region geometry:', JSON.stringify({ before, nested, page }))
    if (Math.abs(nested.offset - before.offset) > 2 || before.stroke - nested.stroke < 80 || Math.abs(page.offset - before.offset) > 2 || nested.stroke - page.stroke < 60)
      fail('Q14: freeform stroke drifted during nested/page scrolling')
    else if (Math.abs(before.composer - page.composer - (before.stroke - page.stroke)) > 2 || await taVal() !== 'Keep the region attached')
      fail('Q14: region composer failed to follow or lost its draft')
    else pass('Q14 freeform stroke and composer follow nested and page scrolling')
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    const saved = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__rootsNudgeSession')).composer)
    if (Math.abs(saved.rect.top - page.stroke) > 2 || Math.abs(Math.min(...saved.stroke.map(point => point[1])) - page.stroke) > 2)
      fail('Q14: persisted capture rectangle and stroke disagree')
    else pass('Q14 persisted region uses the same updated coordinates as its visible stroke')
    // Recreate the same content at a different scroll position after reload.
    await p.route(`http://localhost:${PAGE}/**`, route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;padding:40px;min-height:2400px}.box{width:240px;height:64px;margin:12px 0;border:1px solid}</style><div id="wrap"><div id="scroller" style="height:500px;width:500px;overflow:auto"><div style="height:1200px;padding-top:260px"><div id="region-target" class="box">Region target</div></div></div></div>' }))
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    const restored = await geometry()
    if (Math.abs(restored.offset - before.offset) > 2 || await taVal() !== 'Keep the region attached')
      fail('Q14: reload replaced the region rectangle with the centroid element rectangle')
    else pass('Q14 reload preserves region shape and relocates it with its original target')
  }

  // Q15: move the actual header with real pointer input, including recovery
  // from a clipped long draft. The drop belongs to this draft across reloads.
  {
    const text = Array(18).fill('A long draft that must remain editable.').join('\n')
    await p.locator('.composer textarea').fill(text)
    await sleep(250)
    await p.locator('.composer textarea').evaluate(el => { el.focus(); el.setSelectionRange(5, 12) })
    await p.locator('.composer .send').evaluate(el => { el.disabled = true })
    const box = () => p.locator('.composer').boundingBox()
    const dragHeader = async (dx, dy) => {
      const h = await p.locator('.composer .meta').boundingBox()
      await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
      await p.mouse.down()
      await p.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 12 })
      await p.mouse.up()
      await sleep(150)
    }
    await p.evaluate(() => {
      window.headerPointerLeaks = 0
      document.addEventListener('pointerdown', () => window.headerPointerLeaks++, true)
    })
    // Reproduce the report: the header is reachable, the bottom is clipped.
    await p.locator('.composer').evaluate(el => { el.style.top = '650px' })
    const before = await box()
    await dragHeader(170, -420)
    const dropped = await box()
    if (await p.evaluate(() => window.headerPointerLeaks))
      throw new Error('Q15: header drag leaked to page outside-click handlers')
    console.log('Q15 drag geometry:', JSON.stringify({ before, dropped }))
    if (Math.abs(dropped.x - before.x - 170) > 2 || dropped.y > 240)
      throw new Error('Q15: header drag did not recover the clipped composer')
    const draftState = await p.evaluate(() => {
      const root = document.getElementById('__groundworks-nudge-host').shadowRoot
      const ta = root.querySelector('.composer textarea')
      return { focused: root.activeElement === ta, start: ta.selectionStart, end: ta.selectionEnd, disabled: root.querySelector('.send').disabled }
    })
    if (!draftState.focused || draftState.start !== 5 || draftState.end !== 12 || !draftState.disabled)
      throw new Error('Q15: dragging changed focus, selection or pending Send state')
    await p.screenshot({ path: path.join(EXT, '..', 'composer-drag.png') })
    await p.locator('.composer .send').evaluate(el => { el.disabled = false })
    await p.mouse.move(1100, 700)
    await p.mouse.wheel(0, 100)
    await sleep(300)
    const scrolled = await box()
    if (Math.abs(scrolled.x - dropped.x) > 2 || Math.abs(scrolled.y - dropped.y) > 2 || await taVal() !== text)
      throw new Error('Q15: scroll/release moved the dropped composer or lost text')
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    const restored = await box()
    if (Math.abs(restored.x - dropped.x) > 2 || Math.abs(restored.y - dropped.y) > 2 || await taVal() !== text)
      throw new Error('Q15: reload lost the dropped position or draft')
    await dragHeader(-110, -100)
    const repeated = await box()
    if (Math.abs(repeated.x - restored.x + 110) > 2 || Math.abs(repeated.y - restored.y + 100) > 2)
      throw new Error('Q15: repeated header drag failed')
    const handle = await p.locator('.composer .meta').boundingBox()
    await p.mouse.move(handle.x + 40, handle.y + 12)
    await p.mouse.down()
    await p.mouse.move(handle.x + 65, handle.y + 32, { steps: 5 })
    await p.evaluate(() => dispatchEvent(new Event('blur')))
    const blurred = await box()
    await p.mouse.move(1000, 700)
    await p.mouse.up()
    const released = await box()
    if (Math.abs(released.x - blurred.x) > 2 || Math.abs(released.y - blurred.y) > 2 || await p.locator('.composer .meta.dragging').count())
      throw new Error('Q15: window blur left a stuck drag')
    await p.setViewportSize({ width: 380, height: 420 })
    await sleep(300)
    const fitted = await box()
    if (fitted.x < 0 || fitted.y < 0 || fitted.x + fitted.width > 380 || fitted.y + fitted.height > 420)
      throw new Error('Q15: resized composer escaped the viewport: ' + JSON.stringify(fitted))
    await p.locator('.composer textarea').fill('Still editable after dragging')
    await p.locator('.composer .cancel').click()
    if (await open()) throw new Error('Q15: Cancel stopped working after dragging')
    await p.setViewportSize({ width: 1200, height: 800 })
    await p.evaluate(() => { scrollTo(0, 0); document.getElementById('scroller').scrollTop = 0 })
    await arm()
    await click('region-target')
    await p.keyboard.type('Element draft')
    const elementBefore = await box()
    await dragHeader(100, -80)
    const elementAfter = await box()
    if (Math.abs(elementAfter.x - elementBefore.x - 100) > 2 || Math.abs(elementAfter.y - elementBefore.y + 80) > 2)
      throw new Error('Q15: element composer header cannot be dragged')
    await p.locator('.composer .send').click()
    await until(async () => !await open(), 5000, 'dragged element draft to send')
    pass('Q15 region/element header dragging, release, scroll, reload, resize and controls')
  }

  // Q16: a restored draft can recover after tab identity changes and a failed
  // first storage read, while retaining the original queued submission token.
  {
    await arm()
    await click('region-target')
    await p.keyboard.type('Retry after identity reset')
    await sw.evaluate(() => {
      const once = (message, sender, reply) => {
        if (message.type !== 'nudge-queue' || message.action !== 'submit') return
        chrome.runtime.onMessage.removeListener(once)
        reply({ ok: false, error: 'injected_ack_loss' })
      }
      chrome.runtime.onMessage.addListener(once)
    })
    await p.locator('.composer .send').click()
    const matching = () => sw.evaluate(async () =>
      (await chrome.storage.local.get('nudgeQueue')).nudgeQueue.entries
        .filter(entry => entry.payload.text === 'Retry after identity reset'))
    await until(async () => (await matching()).length === 1, 5000, 'ambiguous submission stored before identity reset')
    const original = (await matching())[0].payload
    // Simulate loss of privileged session identity without deleting durable
    // storage. Worker cleanup retention is separately covered by unit tests.
    await sw.evaluate(async () => { await chrome.storage.session.clear(); identity = null })
    await p.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    // Isolated content-world API fault, not a page-controlled worker mutation.
    const session = await ctx.newCDPSession(p)
    const worlds = []
    session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context))
    await session.send('Runtime.enable')
    const extensionOrigin = `chrome-extension://${new URL(sw.url()).hostname}`
    const world = worlds.find(context => context.origin === extensionOrigin || context.name === new URL(sw.url()).hostname)
    if (!world) throw new Error('Q16: extension isolated world missing')
    await session.send('Runtime.evaluate', { contextId: world.id, expression: `(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local)
      chrome.storage.local.get = function(key, ...rest) {
        if (typeof key === 'string' && key.startsWith('nudgeDraftRetry-')) {
          chrome.storage.local.get = get
          return Promise.reject(new Error('injected transient retry read'))
        }
        return get(key, ...rest)
      }
    })()` })
    await p.locator('.composer .send').click()
    await until(async () => (await p.locator('.feed').innerText()).includes('Previous delivery state unavailable'), 4000, 'first restoration read failure')
    if (!await open()) fail('Q16: transient restoration failure discarded the draft')
    await p.locator('.composer .send').click()
    await until(async () => !await open(), 5000, 'retry restoration after transient failure')
    const entries = await matching()
    if (entries.length !== 1 || JSON.stringify(entries[0].payload) !== JSON.stringify(original))
      fail('Q16: restored retry changed or duplicated the original payload')
    else pass('Q16 changed tab identity and failed first read recover with the exact original submission')
    await session.detach()
  }

  // Q17: bottom-edge drafts must aim from their final, height-clamped position.
  {
    const failuresBefore = failed
    await p.keyboard.press('Escape')
    await p.setViewportSize({ width: 1200, height: 800 })
    await p.evaluate(() => {
      document.getElementById('wrap').innerHTML = '<div id="tip-target" style="position:fixed;left:400px;top:650px;width:240px;height:18px">Marked note</div>'
    })
    for (const left of [400, 900]) {
      await p.evaluate(left => document.getElementById('tip-target').style.left = left + 'px', left)
      await arm()
      await click('tip-target')
      for (const lines of [1, 12, 3]) {
        await p.locator('.composer textarea').fill(Array(lines).fill('A draft that grows beside the marked note.').join('\n'))
        await sleep(300)
        const g = await p.evaluate(() => {
          const root = document.getElementById('__groundworks-nudge-host').shadowRoot
          const tip = root.querySelector('.tip').getBoundingClientRect()
          const box = root.querySelector('.composer').getBoundingClientRect()
          const mark = document.getElementById('tip-target').getBoundingClientRect()
          return { error: Math.abs((tip.top + tip.bottom - mark.top - mark.bottom) / 2), bottom: box.bottom,
            correctSide: mark.left < box.left ? tip.left < box.left : tip.right > box.right }
        })
        console.log('Q17 tip geometry:', JSON.stringify({ left, lines, ...g }))
        if (g.error > 2 || g.bottom > 792 || !g.correctSide) fail('Q17: pointer missed the marked note or escaped the viewport')
      }
    }
    if (failed === failuresBefore) pass('Q17 measured arrow alignment for growing/shrinking drafts on both sides')
    await p.keyboard.press('Escape')
  }

  console.log(failed ? `\nSuite Q — Reload resilience: ${failed} FAILED` : '\nSuite Q — Reload resilience: ALL PASS')
} catch (e) {
  fail(e.message || String(e))
} finally {
  try { await ctx?.close() } catch { /* already gone */ }
  try { pageSrv.close() } catch { /* already closed */ }
}
process.exit(failed ? 1 : 0)
