#!/usr/bin/env node
// Documentation tooling only. Never package this into either extension.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/toolchain.json'), 'utf8'))
const installed = path.join(root, lock.installation)
const cli = path.join(installed, 'bin/archify.mjs')
if (!fs.existsSync(cli)) throw new Error('Install the project-local Archify skill described in docs/architecture/README.md first.')
const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'))
if (pkg.version !== lock.version) throw new Error(`Archify version mismatch: expected ${lock.version}, got ${pkg.version}`)
const run = (args, capture = false) => execFileSync(process.execPath, [cli, ...args], {
  cwd: root, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8',
})
const spec = 'docs/architecture/nudge.architecture.json'
const html = 'docs/architecture/nudge.html'
run(['doctor'])
run(['validate', 'architecture', spec, '--quality', 'showcase', '--repo-root', root, '--json'])
const receipt = run(['deliver', 'architecture', spec, html, '--quality', 'showcase', '--repo-root', root, '--json'], true)
JSON.parse(receipt)
fs.writeFileSync(path.join(root, 'docs/architecture/nudge.delivery.json'), receipt)
process.stdout.write(receipt)
if (process.argv.includes('--visual')) run(['visual-check', html, '--json'])
