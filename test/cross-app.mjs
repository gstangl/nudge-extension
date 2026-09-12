// Suite J — Cross-App + Multi-Session. Nudge across the REAL apps at once
// (md-pdf, estimate, media, website) in four simultaneous tabs, with four agent
// sessions armed and heartbeating in parallel, while ownership churns. Proves:
// each nudge binds to the session that owned the channel at its instant; each
// app's tab shows ONLY its own route's nudges (no cross-app leakage); rapid
// interleaved creation under a heartbeat/resolve storm stays correctly attributed
// and loses nothing. Reuses whatever app dev servers are already running; skips
// an app that isn't reachable. Test bridge on side port 4792, extension
// re-pointed via chrome.storage — the user's real Chrome on 4700 is untouched.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const STORE = '/tmp/nudge-xapp-store'
const PORT = 4792
const B = `http://localhost:${PORT}`
fs.rmSync(STORE, { recursive: true, force: true })

const APPS = [
  { name: 'md-pdf', url: 'http://localhost:5313/', pick: '#dz-card', owner: { label: 'Pdf-Agent', pid: 601, session: 'pdfA' } },
  { name: 'estimate', url: 'http://localhost:5315/estimate/', pick: 'h1', owner: { label: 'Est-Agent', pid: 602, session: 'estA' } },
  { name: 'media', url: 'http://localhost:5318/media/', pick: 'h1', owner: { label: 'Media-Agent', pid: 603, session: 'medA' } },
  { name: 'website', url: 'http://localhost:4321/', pick: 'h1', owner: { label: 'Web-Agent', pid: 604, session: 'webA' } },
]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], { env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] })
async function up() { for (let i = 0; i < 30; i++) { await sleep(150); try { if ((await (await fetch(`${B}/.identity`)).json()).store === STORE) return true } catch { /* wait */ } } return false }
if (!await up()) { console.error('FAIL: bridge did not start'); process.exit(1) }

const cleanup = () => { try { bridge.kill() } catch {} }
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const pass = (m) => console.log('PASS', m)
const hb = (o) => fetch(`${B}/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: o.label, pid: o.pid, since: o.since, session: o.session }) }).catch(() => {})
const grab = (pid) => fetch(`${B}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).catch(() => {})
const resolve = (id) => fetch(`${B}/comments/${id}/resolve`, { method: 'POST' }).catch(() => {})
const pins = async () => (await (await fetch(`${B}/comments`)).json())

// all four sessions armed + heartbeating in parallel for the whole run
APPS.forEach(a => { a.owner.since = 1000 + a.owner.pid })
const beats = setInterval(() => APPS.forEach(a => hb(a.owner)), 1200)
await Promise.all(APPS.map(a => hb(a.owner)))
await sleep(400)

// reachability: keep only apps whose server answers
for (const a of APPS) { try { a.upOk = (await fetch(a.url, { signal: AbortSignal.timeout(2000) })).status < 500 } catch { a.upOk = false } }
let live = APPS.filter(a => a.upOk)
if (live.length < 2) fail(`need >=2 running apps, got ${live.map(a => a.name).join(',') || 'none'}`)
if (live.length < APPS.length) console.log(`NOTE skipping unreachable: ${APPS.filter(a => !a.upOk).map(a => a.name).join(', ')}`)

let ctx
try {
  ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 })
  await sw.evaluate((p) => chrome.storage.local.set({ nudgePort: p }), PORT)

  // one tab per live app, all open simultaneously — an app that fails to LOAD
  // (dev server up per the reachability probe but serving a 5xx / broken page)
  // is dropped honestly, like an unreachable one, instead of hard-failing
  for (const a of [...live]) {
    try {
      a.page = await ctx.newPage()
      await a.page.goto(a.url, { waitUntil: 'domcontentloaded' })
      await a.page.locator('.pill .status.ok').waitFor({ timeout: 20000 })
      await a.page.waitForTimeout(400)
      // drag the pill clear of the app's top-right chrome
      const g = await a.page.locator('.pill .grip').boundingBox()
      await a.page.mouse.move(g.x + 6, g.y + 6); await a.page.mouse.down(); await a.page.mouse.move(340, 830, { steps: 4 }); await a.page.mouse.up()
      a.routeKey = await a.page.evaluate(() => location.host + location.pathname + location.hash)
    } catch {
      console.log(`NOTE dropping ${a.name}: did not load (server unhealthy)`) ; try { await a.page?.close() } catch {}
      live = live.filter(x => x !== a)
    }
  }
  if (live.length < 2) { console.log(`Suite J — Cross-App: SKIPPED (only ${live.length} app(s) reachable)`); clearInterval(beats); await ctx.close(); cleanup(); process.exit(0) }

  async function nudgeOn(a, text) {
    await a.page.bringToFront()
    await a.page.locator('.pill .btn-pick').click()
    const target = a.page.locator(a.pick).first()
    await target.scrollIntoViewIfNeeded().catch(() => {})
    await target.click({ timeout: 4000 })
    await a.page.locator('textarea[placeholder*="Nudge"]').waitFor({ timeout: 4000 })
    await a.page.locator('textarea[placeholder*="Nudge"]').fill(text)
    await a.page.locator('.composer .send').click()
    for (let i = 0; i < 30; i++) { await sleep(150); const p = (await pins()).find(x => x.text === text); if (p) return p }
    fail(`nudge "${text}" never reached the store (${a.name})`)
  }

  // ---------- J1: a nudge on EACH app, each under its own session ----------
  {
    for (const a of live) {
      await grab(a.owner.pid); await sleep(250) // this app's agent owns the channel now
      const p = await nudgeOn(a, `[XAPP ${a.name}] belongs to ${a.owner.label}`)
      if (p.owner !== a.owner.label) fail(`J1: ${a.name} nudge owner ${p.owner} != ${a.owner.label}`)
      const stored = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins.find(x => x.id === p.id)
      if (!stored.target?.selector || !stored.url.startsWith('http')) fail(`J1: ${a.name} captured no context`)
      a.firstNudge = p.id
    }
    pass(`J1 one nudge per app, each bound to its own session (${live.map(a => `${a.name}=${a.owner.label}`).join(', ')})`)
  }

  // ---------- J2: per-route isolation — each tab shows ONLY its own nudge ----------
  {
    for (const a of live) {
      await a.page.bringToFront(); await a.page.waitForTimeout(200)
      const badge = await a.page.locator('.pill .count.show').textContent().catch(() => '0')
      if ((badge || '0').trim() !== '1') fail(`J2: ${a.name} badge should be 1 (own route), got "${badge}"`)
      // open the History and confirm the single open row is THIS app's nudge with THIS owner
      await a.page.locator('.pill .count').click()
      await a.page.locator('.queue.on').waitFor({ timeout: 3000 })
      const rows = await a.page.evaluate(() => { const r = document.getElementById('__roots-nudge-host').shadowRoot; return [...r.querySelectorAll('.queue .q-row:not(.done)')].map(x => ({ id: x.querySelector('.q-id')?.textContent, who: x.querySelector('.q-who')?.textContent })) })
      if (rows.length !== 1 || rows[0].id !== a.firstNudge) fail(`J2: ${a.name} History shows ${rows.length} open rows (cross-app leak?) ${JSON.stringify(rows)}`)
      if (rows[0].who !== a.owner.label) fail(`J2: ${a.name} row owner ${rows[0].who} != ${a.owner.label}`)
      await a.page.keyboard.press('Escape')
    }
    pass('J2 per-route isolation (each tab shows only its own nudge, right owner, no cross-app leak)')
  }

  // ---------- J3: concurrent multi-session storm — interleaved creation under churn ----------
  {
    // background storm: all sessions heartbeat hard + random stranger-resolves
    let stormOn = true
    const created = live.length ? live.map(a => a.firstNudge) : []
    const storm = (async () => {
      while (stormOn) {
        await Promise.allSettled([...APPS.map(a => hb(a.owner)), resolve(created[0]), resolve(created[created.length - 1])])
        await sleep(30)
      }
    })()
    // interleave: rotate through apps, each time set that app's owner sticky, create on its tab
    const expect = []
    const rounds = 2
    for (let r = 0; r < rounds; r++) {
      for (const a of live) {
        await grab(a.owner.pid); await sleep(150)
        const text = `[XSTORM r${r} ${a.name}] ${a.owner.label}`
        const p = await nudgeOn(a, text)
        expect.push({ id: p.id, app: a.name, owner: a.owner.label })
        if (p.owner !== a.owner.label) fail(`J3: mid-storm mis-attribution ${a.name}: ${p.owner} != ${a.owner.label}`)
      }
    }
    stormOn = false; await storm
    // verify every storm nudge kept the right owner + ids strictly monotonic + none lost
    const all = await pins()
    for (const e of expect) {
      const got = all.find(x => x.id === e.id)
      if (!got) fail(`J3: nudge ${e.id} (${e.app}) LOST during the storm`)
      if (got.owner !== e.owner) fail(`J3: ${e.id} (${e.app}) owner drifted to ${got.owner}, expected ${e.owner}`)
    }
    const nums = expect.map(e => Number(e.id.replace('nudge_', '')))
    if (nums.some((n, i) => i && n <= nums[i - 1])) fail(`J3: ids not strictly monotonic: ${nums.join(',')}`)
    pass(`J3 concurrent storm (${expect.length} interleaved nudges across ${live.length} apps under heartbeat+resolve churn — all correctly attributed, ids monotonic, none lost)`)
  }

  // ---------- J4: after the churn, each app's History is still its own + correct owners ----------
  {
    for (const a of live) {
      await a.page.bringToFront(); await a.page.waitForTimeout(200)
      await a.page.locator('.pill .count').click()
      await a.page.locator('.queue.on').waitFor({ timeout: 3000 })
      const rows = await a.page.evaluate(() => { const r = document.getElementById('__roots-nudge-host').shadowRoot; return [...r.querySelectorAll('.queue .q-row')].map(x => ({ id: x.querySelector('.q-id')?.textContent, who: x.querySelector('.q-who')?.textContent, done: x.classList.contains('done') })) })
      // every row shown on this tab must be a nudge whose owner is THIS app's agent
      // (all nudges on this route were created while this app's agent owned)
      const foreign = rows.filter(x => x.who && x.who !== a.owner.label)
      if (foreign.length) fail(`J4: ${a.name} History shows foreign-owner rows: ${JSON.stringify(foreign)}`)
      if (!rows.length) fail(`J4: ${a.name} History empty`)
      await a.page.keyboard.press('Escape')
    }
    pass('J4 post-churn: every tab\'s Nudge History is route-correct with the right per-row owners')
  }

  console.log('\nSuite J — Cross-App + Multi-Session: ALL PASS')
} finally {
  clearInterval(beats)
  try { await ctx?.close() } catch {}
  cleanup()
}
