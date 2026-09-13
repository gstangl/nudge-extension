// Default is a real Safari run. --smoke explicitly limits proof to resources.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.argv.includes('--smoke')) {
  await import('./browser-parity.mjs')
} else {
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = path.join(ROOT, 'artifacts', 'safari')
fs.mkdirSync(smokeRoot, { recursive: true })
const out = fs.mkdtempSync(path.join(smokeRoot, 'smoke-'))
try {
  execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'test', '--bridge-port', '4820', '--out', path.relative(ROOT, out)], { cwd: ROOT, stdio: 'pipe' })
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
  assert(!manifest.permissions.includes('nativeMessaging'), 'Safari test manifest must omit nativeMessaging')
  assert.equal(manifest.background.service_worker, 'safari-sw.js')
  assert(manifest.content_scripts.filter(s => s.world !== 'MAIN').every(s => s.js[0] === 'platform.js'), 'platform.js must run before isolated content scripts')
  assert(manifest.content_scripts.filter(s => s.world === 'MAIN').every(s => !s.js.includes('platform.js')), 'MAIN world must not receive platform/native authority')
  assert.equal(fs.readFileSync(path.join(out, 'platform.js'), 'utf8').includes('"nativeAutostart":false'), true)
  assert.equal(fs.readFileSync(path.join(out, 'platform.js'), 'utf8').includes('"bridgePort":4820'), true)
  assert(fs.existsSync(path.join(out, 'RESOURCE-SHA256')), 'resource digest must be produced')
  const release = () => execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'release', '--out', path.relative(ROOT, out)], { cwd: ROOT, stdio: 'pipe' })
  release()
  const first = fs.readFileSync(path.join(out, 'RESOURCE-SHA256'), 'utf8')
  release()
  assert.equal(fs.readFileSync(path.join(out, 'RESOURCE-SHA256'), 'utf8'), first, 'identical release inputs must produce identical resource bytes')
  const config = fs.readFileSync(path.join(out, 'platform.js'), 'utf8')
  assert(config.includes('"bridgePort":null') && config.includes('"developmentReload":false') && config.includes('"nativeAutostart":false'))
  assert(fs.existsSync(path.join(out,'vendor/finder-LICENSE.txt')), 'vendored library license is distributed')
  for (const extra of [['--bridge-port','4820'], ['--use-storage-port']]) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/package-safari.mjs','--mode','release','--out',path.relative(ROOT,out),...extra], {cwd:ROOT,stdio:'pipe'}))
    assert.equal(fs.readFileSync(path.join(out, 'RESOURCE-SHA256'), 'utf8'), first, 'invalid packaging input must not alter the output')
  }
  console.log('PASS Safari resource smoke (isolated test config, reproducible release bytes, no test port/native/reload leakage, licenses)')
} finally {
  fs.rmSync(out, { recursive: true, force: true })
}
}
