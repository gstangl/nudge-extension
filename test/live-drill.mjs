// LIVE chain drill — runs against the REAL bridge (port 4700, global store) and
// the REAL estimate app (:5185) plus a throwaway generic web app. This is the
// bidirectional + rapid-fire acceptance run; test pins are cleaned afterwards.
// Requires: bridge running, estimate dev server on :5185, native host installed.
import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXT = '/Users/gst/Developer/roots-apps/nudge/extension'
const PIN = path.join(os.homedir(), '.claude', 'nudge')
const api = async (p) => (await fetch(`http://localhost:4700${p}`)).json()
const results = []
const leg = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` — ${note}` : ''}`) }
const until = async (fn, ms, what) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { if (await fn()) return true } catch { /* retry */ } await new Promise(r => setTimeout(r, 300)) }
  console.log(`TIMEOUT: ${what}`)
  return false
}

// throwaway generic web app (plain static page, no framework)
fs.mkdirSync('/tmp/pin-generic', { recursive: true })
fs.writeFileSync('/tmp/pin-generic/index.html', `<!doctype html><html><body>
  <h1 id="generic-title">Generische App</h1>
  <button id="generic-btn" style="padding:12px 24px;background:#246;color:#fff">Kauf mich</button>
</body></html>`)
const statics = spawn('python3', ['-m', 'http.server', '8907', '-d', '/tmp/pin-generic'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 800))

// user-data-dir with the native host manifest: Playwright's Chromium resolves
// native messaging hosts from <user-data-dir>/NativeMessagingHosts (macOS) —
// required for the self-healing leg
const UDD = '/tmp/pin-drill-udd'
fs.rmSync(UDD, { recursive: true, force: true })
fs.mkdirSync(path.join(UDD, 'NativeMessagingHosts'), { recursive: true })
fs.copyFileSync(
  path.join(os.homedir(), 'Library/Application Support/Chromium/NativeMessagingHosts/energy.roots.nudge.json'),
  path.join(UDD, 'NativeMessagingHosts/energy.roots.nudge.json'),
)
const ctx = await chromium.launchPersistentContext(UDD, {
  headless: false, viewport: { width: 1600, height: 1000 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const page = ctx.pages()[0] || await ctx.newPage()
const ta = page.locator('textarea[placeholder*="Prompt"]')
const testIds = []

try {
  // ---- Leg 1: estimate app — pick = mark, context instantly (bidirectional a) ----
  await page.goto('http://localhost:5185/estimate/?editor=v2#/')
  await page.locator('.pill .status').waitFor({ timeout: 8000 })
  await page.locator('.pill .btn-pick').click()
  await page.locator('.lib-btn').first().click()
  const selOk = await until(async () => {
    const s = await api('/selection')
    return s.selector?.includes('lib-btn') && Date.now() - Date.parse(s.at) < 10000
  }, 5000, 'selection on :5185')
  // the agent-side view: the user-level hook must surface it as AKTUELLE MARKIERUNG
  const hookOut = execSync(`echo '{}' | node ${os.homedir()}/.claude/hooks/nudge-context.mjs`).toString()
  leg('estimate: pick → selection + hook context', selOk && hookOut.includes('AKTUELLE MARKIERUNG'),
    `hook sieht Markierung: ${hookOut.includes('AKTUELLE MARKIERUNG')}`)
  await page.locator('.composer .cancel').click()

  // ---- Leg 2: rapid-fire — 3 prompts in quick succession, order preserved ----
  // route the pins land on (pathname+hash; query is ignored for route identity)
  const routeOpen = async () => {
    const u = new URL(page.url())
    const key = u.pathname + u.hash
    return (await api('/comments')).filter(p => p.status === 'open' && (() => { try { const x = new URL(p.url); return x.pathname + x.hash === key } catch { return false } })())
  }
  const before = (await api('/comments')).length
  for (let i = 1; i <= 3; i++) {
    await page.locator('.pill .btn-pick').click()
    await page.locator('.lib-btn').first().click()
    await ta.waitFor({ timeout: 3000 })
    await ta.fill(`[TEST-RF${i}] Rapid-Fire-Probe ${i} — bitte ignorieren`)
    await page.locator('.composer .send').click()
    // wait on the STORE, not on a toast (the toast lingers and matches loosely)
    if (!(await until(async () => (await api('/comments')).length === before + i, 8000, `store hat RF${i}`))) break
  }
  const fresh = (await api('/comments')).slice(before)
  testIds.push(...fresh.map(p => p.id))
  const nums = fresh.map(p => Number(p.id.replace(/^(?:pin|nudge)_/, '')))
  const ordered = fresh.length === 3 &&
    nums.every((n, i) => i === 0 || n > nums[i - 1]) &&
    fresh.every((p, i) => p.text.includes(`RF${i + 1}`))
  // badge == open prompts on this route per the store (robust vs. pre-existing state)
  const expected = (await routeOpen()).length
  const badgeOk = await until(async () => (Number(await page.locator('.pill .count').textContent().catch(() => '0')) || 0) === expected, 5000, 'badge == route open count')
  leg('rapid-fire: 3 Prompts, Reihenfolge + Badge', ordered && badgeOk, `ids ${fresh.map(p => p.id).join(',')} · badge==${expected}`)

  // ---- Leg 3: resolve loop — feed chip on the live page. These are element
  //      pins (DOM-only, no screenshot) → no after-shot expected; the chip +
  //      badge-drop is the closure. (Kreis evidence loop is covered in Suite A.)
  const openBeforeResolve = (await routeOpen()).length
  await fetch(`http://localhost:4700/comments/${testIds[0]}/resolve`, { method: 'POST' })
  const chipOk = await page.locator('.feed .item', { hasText: `${testIds[0]} erledigt` }).waitFor({ timeout: 6000 }).then(() => true).catch(() => false)
  const droppedOk = await until(async () =>
    (Number(await page.locator('.pill .count').textContent().catch(() => '0')) || 0) === openBeforeResolve - 1, 5000, 'badge dropped by 1')
  const noShot = !(await api('/comments')).find(p => p.id === testIds[0])?.hasEvidence
  leg('resolve: Feed-Chip + Badge fällt (Element = kein Screenshot)', chipOk && droppedOk && noShot)

  // ---- Leg 4: generic web app (framework-free static page) ----
  await page.goto('http://localhost:8907/')
  await page.locator('.pill .status').waitFor({ timeout: 8000 })
  await page.locator('.pill .btn-pick').click()
  await page.locator('#generic-btn').click()
  const genOk = await until(async () => (await api('/selection')).selector === '#generic-btn', 5000, 'generic selection')
  await ta.waitFor({ timeout: 3000 })
  await ta.fill('[TEST-GEN] Prompt aus generischer App — bitte ignorieren')
  await page.locator('.composer .send').click()
  // chip text depends on live agent state (watcher heartbeat): „Agent arbeitet"
  // with one, „gespeichert — kein Agent" without — both mean "prompt landed"
  await page.locator('.feed .item', { hasText: /Agent arbeitet|kein Agent/ }).waitFor({ timeout: 8000 })
  const genPin = (await api('/comments')).at(-1)
  if (genPin.text.includes('TEST-GEN')) testIds.push(genPin.id)
  leg('generisch: Pick + Prompt auf fremder App', genOk && genPin.text.includes('TEST-GEN') && genPin.url.includes('8907'))

  // ---- Leg 5: self-healing — kill the bridge, Chrome revives it (native host) ----
  execSync('lsof -tnP -iTCP:4700 -sTCP:LISTEN | xargs kill 2>/dev/null || true')
  await new Promise(r => setTimeout(r, 500))
  const healed = await until(async () => (await api('/.identity')).app === 'roots-nudge', 35000, 'self-heal')
  leg('self-healing: Bridge stirbt → Extension belebt sie (Native Host)', healed)
} finally {
  // hard watchdog: ctx.close() can hang on an open native-messaging port; the
  // browser dies with the process anyway, results matter more than grace
  const watchdog = setTimeout(() => { console.log('watchdog exit'); process.exit(results.every(r => r.ok) ? 0 : 1) }, 8000)
  watchdog.unref?.()
  statics.kill()
  // cleanup: drop test pins (NEVER reset seq), age the selection out of the window
  try {
    const storeFile = path.join(PIN, 'store.json')
    const s = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
    s.pins = s.pins.filter(p => !testIds.includes(p.id))
    fs.writeFileSync(storeFile, JSON.stringify(s, null, 2))
    for (const id of testIds) {
      for (const f of [`inbox/${id}.md`, `shots/${id}.png`, `shots/${id}_full.jpg`, `shots/${id}_after.png`])
        fs.rmSync(path.join(PIN, f), { force: true })
    }
    const selFile = path.join(PIN, 'selection.json')
    const sel = JSON.parse(fs.readFileSync(selFile, 'utf8'))
    sel.at = new Date(Date.now() - 3600_000).toISOString() // hide the test mark from the 15-min window
    fs.writeFileSync(selFile, JSON.stringify(sel, null, 2))
    console.log(`cleanup: ${testIds.join(', ')} entfernt, Selektion gealtert`)
  } catch (e) { console.log('cleanup issue:', e.message) }
  console.log('\n== ERGEBNIS ==')
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}`)
  void ctx.close().catch(() => {})
  setTimeout(() => process.exit(results.every(r => r.ok) ? 0 : 1), 1000)
}
