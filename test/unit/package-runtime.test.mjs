import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RUNTIME_FILES, auditRuntimeSources, stageRuntime, validateOutput } from '../../scripts/package-runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifacts = path.join(ROOT, 'artifacts/safari')
fs.mkdirSync(artifacts, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(artifacts, 'runtime-unit-'))
afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }))
const read = file => fs.readFileSync(file, 'utf8')

describe('portable shared runtime resource packaging', () => {
  it('audits current imports, Chrome resources, the production lock and setup assets', () => {
    const audited = auditRuntimeSources()
    expect(audited.dependency.integrity).toMatch(/^sha512-/)
    expect(audited.dependency.license).toBe('MIT')
    expect(RUNTIME_FILES).toContain('bridge/demo.html')
    expect(RUNTIME_FILES).toContain('bridge/watch-nudges.mjs')
    expect(RUNTIME_FILES).toContain('agent/NUDGE-SKILL.md')
    expect(RUNTIME_FILES).toContain('bridge/install-native-host.sh')
    expect(RUNTIME_FILES).not.toContain('bridge/native-host-wrapper.sh')
    expect(RUNTIME_FILES.every(file => !file.startsWith('test/') && !file.includes('node_modules'))).toBe(true)
  })

  it('refuses broad output, existing evidence, symlinks and dangling symlinks', () => {
    for (const out of ['.', 'artifacts', 'artifacts/safari', 'extension', '/tmp/nudge-runtime']) {
      expect(() => validateOutput(out)).toThrow(/child/)
    }
    const existing = path.join(sandbox, 'existing')
    fs.mkdirSync(existing)
    fs.writeFileSync(path.join(existing, 'evidence'), 'preserve')
    expect(() => stageRuntime({ out: existing, dependencies: 'locked' })).toThrow(/already exists/)
    expect(read(path.join(existing, 'evidence'))).toBe('preserve')
    fs.symlinkSync(existing, path.join(sandbox, 'link'))
    fs.symlinkSync(path.join(sandbox, 'missing'), path.join(sandbox, 'dangling'))
    for (const out of ['link', 'link/child', 'dangling', 'dangling/child']) {
      expect(() => validateOutput(path.join(sandbox, out))).toThrow(/symlinks/)
    }
  })

  it('stages identical inputs deterministically and labels missing installed dependencies honestly', () => {
    const first = path.join(sandbox, 'first'), second = path.join(sandbox, 'second')
    const a = stageRuntime({ out: first, dependencies: 'locked' })
    const b = stageRuntime({ out: second, dependencies: 'locked' })
    expect(a.resourceHash).toBe(b.resourceHash)
    expect(read(path.join(first, 'RUNTIME-SHA256'))).toBe(read(path.join(second, 'RUNTIME-SHA256')))
    expect(a.dependencies).toBe('lock-only-not-runnable')
    expect(a.installed).toBe(false)
    expect(a.nativeAppVerified).toBe(false)
    expect(fs.existsSync(path.join(first, 'bridge/node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(first, 'bridge/native-host-wrapper.sh'))).toBe(false)
    expect(read(path.join(first, 'extension/manifest.json'))).toBe(read(path.join(ROOT, 'extension/manifest.json')))
    for (const line of read(path.join(first, 'RUNTIME-SHA256')).trim().split('\n')) {
      const [hash, file] = line.split('  ')
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(first, file))).digest('hex')).toBe(hash)
    }
  })

  it('keeps CLI help executable after relocation without any resource path to the original payload', () => {
    const source = path.join(sandbox, 'removable-resources'), durable = path.join(sandbox, 'durable-runtime')
    stageRuntime({ out: source, dependencies: 'locked' })
    fs.cpSync(source, durable, { recursive: true })
    fs.renameSync(source, path.join(sandbox, 'removed-resources'))
    const result = execFileSync(process.execPath, [path.join(durable, 'agent/groundworks-nudge.mjs'), 'help'], {
      cwd: sandbox, timeout: 5000, encoding: 'utf8', env: { PATH: path.dirname(process.execPath), NUDGE_STORE: path.join(sandbox, 'isolated-store') },
    })
    expect(result).toContain('groundworks-nudge <command>')
    expect(result).toContain('ensure-bridge')
    expect(fs.existsSync(path.join(durable, 'agent/NUDGE-SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(sandbox, 'isolated-store'))).toBe(false)
  })

  it('rejects invalid dependency mode before creating output', () => {
    const out = path.join(sandbox, 'invalid')
    expect(() => stageRuntime({ out, dependencies: 'copy-local' })).toThrow(/install or locked/)
    expect(fs.existsSync(out)).toBe(false)
  })
})
