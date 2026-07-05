import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const EXT = '/Users/gst/Developer/roots-apps/nudge/extension'
const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
const page = ctx.pages()[0]
await page.goto('http://localhost:4700/demo')
await page.locator('.pill .status.ok').waitFor({ timeout: 8000 })
await page.locator('.pill .btn-pick').click()
await page.locator('#card-conversion').click()
const ta = page.locator('textarea[placeholder*="Prompt"]')
await ta.waitFor(); await ta.fill('[TEST-FEED] Feed-Optik-Probe')
await page.locator('.composer .send').click()
await page.locator('.feed .item').first().waitFor({ timeout: 8000 })
const id = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/nudge/store.json'), 'utf8')).pins.at(-1).id
await fetch(`http://localhost:4700/comments/${id}/resolve`, { method: 'POST' })
await page.locator('.feed .item', { hasText: 'erledigt' }).waitFor({ timeout: 6000 })
await page.screenshot({ path: '/tmp/feed-shot.png', clip: { x: 900, y: 0, width: 500, height: 220 } })
// cleanup test pin
const f = path.join(os.homedir(), '.claude/nudge/store.json')
const s = JSON.parse(fs.readFileSync(f, 'utf8'))
s.pins = s.pins.filter(p => p.id !== id)
fs.writeFileSync(f, JSON.stringify(s, null, 2))
for (const x of [`inbox/${id}.md`, `shots/${id}.png`, `shots/${id}_full.jpg`, `shots/${id}_after.png`]) fs.rmSync(path.join(os.homedir(), '.claude/nudge', x), { force: true })
console.log('shot ok, cleanup', id)
void ctx.close().catch(() => {})
setTimeout(() => process.exit(0), 800)
