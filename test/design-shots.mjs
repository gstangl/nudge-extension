// Capture every UI state of the Nudge overlay for design review.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const OUT = '/tmp/pin-design-review'
const STORE = '/tmp/pin-design-store'
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(STORE, { recursive: true, force: true })

const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], {
  env: { ...process.env, NUDGE_STORE: STORE }, stdio: ['ignore', 'ignore', 'inherit'],
})
await new Promise(r => setTimeout(r, 600))
const ctx = await chromium.launchPersistentContext('', {
  headless: false, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const page = ctx.pages()[0]
const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') })
try {
  await page.goto('http://localhost:4700/demo')
  await page.locator('.pill .status.ok').waitFor({ timeout: 5000 })
  await shot('1-idle')

  // picking: hover highlight + chip
  await page.locator('.pill .btn-pick').click()
  await page.locator('#card-conversion').hover()
  await page.waitForTimeout(150)
  await shot('2-picking-highlight')

  // composer with layer chips
  await page.locator('#card-conversion').click()
  await page.locator('textarea[placeholder*="Prompt"]').waitFor()
  await page.locator('textarea[placeholder*="Prompt"]').fill('The card needs more space from the title.')
  await page.waitForTimeout(150)
  await shot('3-composer-chips')
  await page.getByText('Send').click()
  await page.locator('.feed .item', { hasText: 'nudge_1' }).waitFor({ timeout: 8000 })
  await shot('4-toast-badge') // fire-and-forget: toast + badge, no marker on the page

  // lasso stroke mid-draw + its composer
  await page.locator('.pill .btn-draw').click()
  const bb = await page.locator('.banner').boundingBox()
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2
  const rx = bb.width / 2 + 30, ry = bb.height / 2 + 25
  await page.mouse.move(cx + rx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
  await page.mouse.up()
  await page.locator('textarea[placeholder*="Prompt"]').waitFor()
  await page.locator('textarea[placeholder*="Prompt"]').fill('Banner looks lost.')
  await page.waitForTimeout(150)
  await shot('6-lasso-composer')
  await page.getByText('Send').click()
  await page.locator('.feed .item', { hasText: 'pin_2' }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
  await shot('7-idle-in-flight') // badge shows prompts in flight; page otherwise untouched

  console.log('shots:', fs.readdirSync(OUT).join(', '))
} finally {
  await ctx.close()
  bridge.kill()
}
