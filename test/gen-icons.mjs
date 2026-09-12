// Generate the static manifest icons (extension/icons/icon-*.png) from the same
// Lucide glyph the SW draws at runtime (crosshair, status-coloured).
// Static icons cover chrome://extensions + the default action state; sw.js still
// overrides the action icon per tab with the live connection colour.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '../extension/icons')
fs.mkdirSync(OUT, { recursive: true })

// Identity (chrome://extensions listing) = Lucide "crosshair": Nudge points
// precisely at the part of a page being discussed. Action default = the same
// grey crosshair. The live icon keeps the truthful status colours (grey off /
// green active / red bridge-down) when sw.js paints it per tab.
const glyphSvg = (size, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
  fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M3 12h3m12 0h3M12 3v3m0 12v3"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage()
const JOBS = [
  ['icon', '#000000', glyphSvg],
  ['circle-grey', '#9a948b', glyphSvg], // action default (overlay off)
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
