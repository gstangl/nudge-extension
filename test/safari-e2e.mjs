// Safari resource smoke check. `--real` deliberately refuses to claim browser
// proof until Safari has an enabled extension installed from these resources.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = path.join(ROOT, 'artifacts', 'safari')
fs.mkdirSync(smokeRoot, { recursive: true })
const out = fs.mkdtempSync(path.join(smokeRoot, 'smoke-'))
try {
  execFileSync(process.execPath, ['scripts/package-safari.mjs', '--mode', 'test', '--bridge-port', '4820', '--out', path.relative(ROOT, out)], { cwd: ROOT, stdio: 'pipe' })
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
  assert(!manifest.permissions.includes('nativeMessaging'), 'Safari test manifest must omit nativeMessaging')
  assert.equal(manifest.background.service_worker, 'safari-sw.js')
  assert(manifest.content_scripts.every(s => s.js[0] === 'platform.js'), 'platform.js must run before every content script')
  assert.equal(fs.readFileSync(path.join(out, 'platform.js'), 'utf8').includes('"nativeAutostart":false'), true)
  assert.equal(fs.readFileSync(path.join(out, 'platform.js'), 'utf8').includes('"bridgePort":4820'), true)
  assert(fs.existsSync(path.join(out, 'RESOURCE-SHA256')), 'resource digest must be produced')
  console.log('PASS Safari resource smoke (isolated manifest and deterministic resource digest)')
  if (process.argv.includes('--real')) {
    // Safari temporary-extension loading requires explicit developer/permission
    // state. We verify the driver binary but do not label this a browser pass.
    execFileSync('/usr/bin/safaridriver', ['--version'], { stdio: 'pipe' })
    if (!process.env.NUDGE_SAFARI_EXTENSION_READY) throw new Error('SafariDriver is present, but no enabled temporary/packaged extension was supplied. Set NUDGE_SAFARI_EXTENSION_READY only after loading this staged resource directory in Safari.')
    throw new Error('Real Safari assertions are not implemented until a loaded extension session can be observed.')
  }
} finally {
  fs.rmSync(out, { recursive: true, force: true })
}
