#!/usr/bin/env node
// Candidate identity includes untracked implementation files. It intentionally
// excludes generated artifacts and the ledger it reports into, avoiding a
// self-referential digest.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ignored = new Set(['node_modules', 'artifacts', '.git', 'safari-port-status.md'])
const roots = ['extension', 'bridge', 'agent', 'scripts', 'safari', 'test', 'docs', 'CHANGELOG.md', 'INSTALL.md', 'README.md', '.github']
const files = []
function visit(relative) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return
  const stat = fs.statSync(absolute)
  if (stat.isFile()) { files.push(relative); return }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue
    visit(path.join(relative, entry.name))
  }
}
for (const entry of roots) visit(entry)
const lines = files.sort().map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')}  ${file.split(path.sep).join('/')}`)
const digest = crypto.createHash('sha256').update(lines.join('\n')).digest('hex')
if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, process.argv[process.argv.indexOf('--write') + 1]), lines.join('\n') + '\n')
console.log(JSON.stringify({ files: lines.length, sha256: digest }, null, 2))
