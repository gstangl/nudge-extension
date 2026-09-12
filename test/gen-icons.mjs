// Generate the static manifest icons (extension/icons/icon-*.png) from the same
// Lucide glyph the SW draws at runtime (message-square + pen, terracotta).
// Static icons cover chrome://extensions + the default action state; sw.js still
// overrides the action icon per tab with the live connection colour.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '../extension/icons')
fs.mkdirSync(OUT, { recursive: true })

// Identity (chrome://extensions listing) = Lucide "pin" (thumbtack — kept as the brand glyph after the Nudge rename), plain black
// stroke, nothing around it (2026-07-04). Action default = grey Lucide
// CIRCLE — the status-dot convention (grey off / green active / red bridge-down)
// must not lie before sw.js paints the live colour.
const glyphSvg = (size, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
  fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 17v5"/>
  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
</svg>`
const circleSvg = (size, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
  fill="${color}" stroke="${color}" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage()
const JOBS = [
  ['icon', '#000000', glyphSvg],       // identity: black line, minimal
  ['circle-grey', '#9a948b', circleSvg], // action default (overlay off)
]
for (const [name, color, tpl] of JOBS) {
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>*{margin:0}</style>${tpl(size, color)}`)
    await page.locator('svg').screenshot({ path: path.join(OUT, `${name}-${size}.png`), omitBackground: true })
    console.log(`${name}-${size}.png`)
  }
}
await browser.close()
