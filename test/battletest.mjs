// Suite I — Kidnap Battletest (END-TO-END through the REAL extension).
// A nudge is created through the actual browser UI (pick + type + send) while
// one agent owns the channel. Then 3-4 attacker agents STORM the bridge trying
// to kidnap the channel AND the nudge — newest-wins heartbeats, /agent/owner
// grabs, stranger resolves, forged-owner posts, all concurrently for seconds.
// The nudge's binding and the exact context it captured must not budge. This is
// the "rock solid" proof (Gerald 2026-07-05). New app: the Tailwind Gauntlet
// fixture on a side port; test bridge on 4793; extension re-pointed via storage.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const FIXTURES = path.join(HERE, 'fixtures')
const STORE = '/tmp/nudge-battle-store'
const PORT = 4793
const PAGEPORT = 5321
const B = `http://localhost:${PORT}`
fs.rmSync(STORE, { recursive: true, force: true })

const statics = spawn('python3', ['-m', 'http.server', String(PAGEPORT), '-d', FIXTURES], { stdio: 'ignore' })
let bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch { /* wait */ } } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const cleanup = () => { try { bridge.kill() } catch {} ; try { statics.kill() } catch {} }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)
const hb = (label, pid, since, session) => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, pid, since, session }) }).catch(() => {})
const grab = (pid) => fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).catch(() => {})
const forged = (a) => fetch(`${B}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `forged by ${a.label}`, url: `${B}/x`, target: { selector: '#x' }, owner: { label: a.label, session: a.session } }) }).catch(() => {})
const resolve = (id) => fetch(`${B}/comments/${id}/resolve`, { method: 'POST' }).catch(() => {})
const pins = async () => (await (await fetch(`${B}/comments`)).json())
const pinById = async (id) => (await pins()).find(p => p.id === id)
const ownerOf = async (id) => (await pinById(id))?.owner

// the owning agent: a live heartbeat loop, session "own-alpha"
const OWNER = { label: 'Owner-Alpha', pid: 500, since: 1000, session: 'ownalpha' }
const ownerBeat = setInterval(() => hb(OWNER.label, OWNER.pid, OWNER.since, OWNER.session), 1500)
await hb(OWNER.label, OWNER.pid, OWNER.since, OWNER.session)
await grab(OWNER.pid) // make Alpha the sticky channel owner
await sleep(300)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((p) => chrome.storage.local.set({ nudgePort: p }), PORT)
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(`http://localhost:${PAGEPORT}/tailwind-gauntlet.html`, { waitUntil: 'domcontentloaded' })
  await page.locator('.pill .status.ok').waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)
  // drag the pill off the nav button (fixture puts one top-right)
  { const g = await page.locator('.pill .grip').boundingBox(); await page.mouse.move(g.x + 6, g.y + 6); await page.mouse.down(); await page.mouse.move(320, 840, { steps: 4 }); await page.mouse.up() }

  // ---------- I1: create a nudge through the REAL extension under Owner-Alpha ----------
  let nudgeId, captured
  {
    await page.locator('.pill .btn-pick').click()
    await page.locator('#g-brand').click() // pick a concrete element
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
    await page.locator('textarea[placeholder*="Nudge"]').fill('[BATTLE] dieser Nudge gehört Owner-Alpha')
    await page.locator('.composer .send').click()
    // wait for it in the store
    for (let i = 0; i < 30 && !nudgeId; i++) { await sleep(200); const p = (await pins()).find(x => x.text?.includes('[BATTLE]')); if (p) nudgeId = p.id }
    if (!nudgeId) fail('I1: nudge never reached the store')
    const stored = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins.find(p => p.id === nudgeId)
    captured = { selector: stored.target?.selector, xpath: stored.target?.xpath, innerText: stored.target?.innerText, url: stored.url, owner: stored.owner?.label }
    if (captured.owner !== 'Owner-Alpha') fail(`I1: nudge owner should be Owner-Alpha, got ${captured.owner}`)
    // the captured context must point at the picked element
    const hits = await page.evaluate((sel) => { try { const el = document.querySelector(sel); return el && el.id === 'g-brand' } catch { return false } }, captured.selector)
    if (!hits) fail(`I1: captured selector "${captured.selector}" does not resolve to #g-brand`)
    if (!captured.innerText?.includes('Gauntlet')) fail(`I1: captured innerText wrong (${captured.innerText})`)
    if (!captured.url.includes('tailwind-gauntlet')) fail(`I1: captured url wrong (${captured.url})`)
    pass(`I1 nudge created via the real extension, owned by Owner-Alpha, context captured (${captured.selector})`)
  }

  // ---------- I2: 3-4 agents STORM the bridge to kidnap channel + nudge ----------
  {
    const attackers = [1, 2, 3, 4].map(i => ({ label: `Kidnap-${i}`, pid: 900 + i, session: `kid${i}`, since: 5000 + i }))
    const until = Date.now() + 5000
    let rounds = 0
    while (Date.now() < until) {
      const salvo = []
      for (const a of attackers) {
        a.since += 10 // ever-newer, fighting newest-wins
        salvo.push(hb(a.label, a.pid, a.since, a.session)) // become newest
        salvo.push(grab(a.pid))                            // sticky-steal the channel
        salvo.push(resolve(nudgeId))                       // stranger-resolve the target nudge
        salvo.push(forged(a))                              // forge a nudge claiming ownership
        salvo.push(fetch(`${B}/comments/${nudgeId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: { label: a.label } }) }).catch(() => {})) // bogus mutate attempt
      }
      await Promise.allSettled(salvo)
      rounds++
      // mid-storm assertion: the binding never even flickers
      if (await ownerOf(nudgeId) !== 'Owner-Alpha') fail(`I2: nudge KIDNAPPED mid-storm (round ${rounds})`)
      await sleep(40)
    }
    // final assertions: owner + captured context intact
    const after = await pinById(nudgeId)
    if (after.owner !== 'Owner-Alpha') fail(`I2: owner changed after storm (${after.owner})`)
    const stored = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins.find(p => p.id === nudgeId)
    if (stored.target?.selector !== captured.selector || stored.target?.innerText !== captured.innerText || stored.url !== captured.url)
      fail('I2: captured context mutated during the storm')
    pass(`I2 kidnap storm survived (${rounds} rounds × 4 agents × 5 attack types) — owner + context rock solid`)
  }

  // ---------- I3: a kidnapper now owns the CHANNEL — new nudge is theirs, the old one is NOT ----------
  {
    await grab(904) // Kidnap-4 explicitly grabs the channel
    await sleep(300)
    const idn = await (await fetch(`${B}/.identity`)).json()
    if (idn.agentLabel !== 'Kidnap-4') fail(`I3 setup: channel owner should be Kidnap-4, got ${idn.agentLabel}`)
    // create a NEW nudge through the extension → belongs to the current owner (Kidnap-4)
    await page.locator('.pill .btn-pick').click()
    await page.locator('#g-deep-title').scrollIntoViewIfNeeded()
    await page.locator('#g-deep-title').click()
    await page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
    await page.locator('textarea[placeholder*="Nudge"]').fill('[BATTLE2] neuer Nudge unter Kidnap-4')
    await page.locator('.composer .send').click()
    let n2 = null
    for (let i = 0; i < 30 && !n2; i++) { await sleep(200); const p = (await pins()).find(x => x.text?.includes('[BATTLE2]')); if (p) n2 = p }
    if (!n2) fail('I3: second nudge never stored')
    if (n2.owner !== 'Kidnap-4') fail(`I3: new nudge should belong to the current owner Kidnap-4, got ${n2.owner}`)
    if (await ownerOf(nudgeId) !== 'Owner-Alpha') fail('I3: the FIRST nudge must still belong to Owner-Alpha')
    pass('I3 channel ownership is reassignable, but each nudge keeps ITS owner (old=Alpha, new=Kidnap-4)')
  }

  // ---------- I4: the Nudge History UI shows the true per-row owner, not the header owner ----------
  {
    await page.locator('#g-brand').scrollIntoViewIfNeeded()
    await page.locator('.pill .count').click()
    await page.locator('.queue.on').waitFor({ timeout: 3000 })
    await page.waitForTimeout(300)
    const rows = await page.evaluate(() => {
      const root = document.getElementById('__roots-nudge-host').shadowRoot
      return [...root.querySelectorAll('.queue .q-row')].map(r => ({ id: r.querySelector('.q-id')?.textContent, who: r.querySelector('.q-who')?.textContent }))
    })
    const first = rows.find(r => r.id === nudgeId)
    if (!first || first.who !== 'Owner-Alpha') fail(`I4: History row for ${nudgeId} must show Owner-Alpha, got "${first?.who}"`)
    pass('I4 Nudge History shows each nudge\'s true owner per row (header owner is a kidnapper, the row is not)')
  }

  // ---------- I5: the inbox file an agent READS carries owner + captured context ----------
  {
    const md = fs.readFileSync(path.join(STORE, 'inbox', `${nudgeId}.md`), 'utf8')
    if (!md.includes('agent: Owner-Alpha')) fail('I5: inbox mirror missing the owning agent')
    if (!md.includes(captured.selector)) fail('I5: inbox mirror missing the captured selector')
    if (!md.includes('tailwind-gauntlet')) fail('I5: inbox mirror missing the captured url')
    pass('I5 inbox mirror (what the agent reads) carries owner + captured selector + url — no kidnapper can claim it')
  }

  console.log('\nSuite I — Kidnap Battletest: ALL PASS (the bridge is rock solid)')
} finally {
  clearInterval(ownerBeat)
  try { await ctx?.close() } catch {}
  cleanup()
}
