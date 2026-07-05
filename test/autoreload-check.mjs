// Verify dev auto-reload: touch a file in extension/ -> bridge broadcasts ->
// extension reloads itself -> localhost tab reloads with the fresh code.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.join(HERE, '../extension')
const bridge = spawn('node', [path.join(HERE, '../bridge/bridge.mjs')], {
  env: { ...process.env, NUDGE_STORE: '/tmp/pin-reload-store' },
  stdio: ['ignore', 'ignore', 'inherit'],
})
await new Promise(r => setTimeout(r, 600))
const fail = (m) => { console.error('FAIL:', m); bridge.kill(); process.exit(1) }
let ctx
try {
  ctx = await chromium.launchPersistentContext('', {
    headless: false, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:4700/demo')
  await page.locator('.pill .status.ok').waitFor({ timeout: 5000 })

  const reloaded = page.waitForEvent('load', { timeout: 10000 }) // tab refresh = proof
  fs.writeFileSync(path.join(EXT, 'version.txt'), new Date().toISOString()) // simulate a code change
  await reloaded
  await page.locator('.pill .status.ok').waitFor({ timeout: 8000 }) // fresh overlay came back
  console.log('PASS auto-reload: file change -> extension reload -> tab refresh -> overlay reconnected')
} catch (e) {
  fail(e.message || String(e))
} finally {
  await ctx?.close()
  bridge.kill()
}
