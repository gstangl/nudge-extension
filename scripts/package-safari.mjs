#!/usr/bin/env node
// Deterministically stages the browser resources consumed by Safari. It does
// not invoke Xcode and never writes back into extension/.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(ROOT, 'extension')
const overlay = JSON.parse(fs.readFileSync(path.join(ROOT, 'safari/manifest-overrides.json'), 'utf8'))
const usage = 'Usage: node scripts/package-safari.mjs --mode test|release --out artifacts/safari/<directory> [--bridge-port <port> | --use-storage-port]'
const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] }
const mode = value('--mode')
const outArg = value('--out')
const port = value('--bridge-port')
const storagePort = args.includes('--use-storage-port')
if (!['test', 'release'].includes(mode) || !outArg || (port !== null && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))) {
  console.error(usage); process.exit(2)
}
if ((mode === 'release' && (port !== null || storagePort)) || (storagePort && port !== null)) {
  console.error('Release resources cannot contain a test bridge port.'); process.exit(2)
}
const out = path.resolve(ROOT, outArg)
const artifactRoot = path.join(ROOT, 'artifacts', 'safari')
if (!out.startsWith(artifactRoot + path.sep)) throw new Error('Output must be a child of artifacts/safari/.')
for (let dir = out; dir !== ROOT; dir = path.dirname(dir)) {
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Output must not traverse symlinks.')
}
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

const files = [
  'manifest.json', 'platform.js', 'sw.js', 'queue.js', 'content.js', 'page-hook.js', 'styles.js', 'options.html', 'options.js',
  'vendor/finder.js', 'vendor/finder-LICENSE.txt', 'vendor/lucide-LICENSE.txt', 'fonts/rn-sans.woff2', 'fonts/rn-sans-italic.woff2', 'fonts/rn-mono.woff2',
  'fonts/README.md', 'fonts/OFL-IBMPlexSans.txt',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
  'icons/circle-grey-16.png', 'icons/circle-grey-32.png', 'icons/circle-grey-48.png', 'icons/circle-grey-128.png',
]
for (const file of files) {
  const from = path.join(source, file)
  if (!fs.existsSync(from)) throw new Error(`Allowlisted resource is missing: ${file}`)
  const to = path.join(out, file)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
manifest.permissions = (manifest.permissions || []).filter(p => !overlay.removePermissions.includes(p))
for (const script of manifest.content_scripts || []) {
  if (script.world !== 'MAIN') script.js = [...new Set([...overlay.prependContentScripts, ...script.js])]
}
// importScripts executes the capability surface before service-worker startup;
// this is what prevents a test package from calling Chrome native messaging.
manifest.background = { service_worker: 'safari-sw.js' }
const cfg = { ...overlay[mode], bridgePort: mode === 'test' && !storagePort ? Number(port || 4820) : null }
const platform = `globalThis.__nudgePlatform = ${JSON.stringify(cfg)}\n` + fs.readFileSync(path.join(source, 'platform.js'), 'utf8')
fs.writeFileSync(path.join(out, 'platform.js'), platform)
fs.writeFileSync(path.join(out, 'safari-sw.js'), `importScripts('platform.js', 'sw.js')\n`)
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const hashes = []
const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(entry => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return visit(full)
  const rel = path.relative(out, full).split(path.sep).join('/')
  hashes.push(`${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}  ${rel}`)
})
visit(out)
fs.writeFileSync(path.join(out, 'RESOURCE-SHA256'), hashes.join('\n') + '\n')
console.log(JSON.stringify({ mode, out: path.relative(ROOT, out), bridgePort: cfg.bridgePort, files: hashes.length, resourceHash: crypto.createHash('sha256').update(hashes.join('\n')).digest('hex') }, null, 2))
