import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { acquireStoreLease, leaseOwnerAlive } from '../../bridge/lease.mjs'
import { compatibleIdentity, ensureBridge } from '../../bridge/lifecycle.mjs'

const identity = store => ({ app: 'groundworks-nudge', version: '0.19.0', store, capabilities: { sourceBoundEvidence: 1, submissionIdempotency: 1, lifecycleIdentity: 1 } })
const temporary = action => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-lease-unit-'))
  try { return action(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
describe('conservative single-writer lease', () => {
  it('publishes a complete lease atomically and releases only its own nonce', () => temporary(dir => {
    const originalLink = fs.linkSync
    const link = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      expect(JSON.parse(fs.readFileSync(from, 'utf8')).nonce).toMatch(/^[\w-]+$/)
      return originalLink(from, to)
    })
    let lease
    try { lease = acquireStoreLease(dir) } finally { link.mockRestore() }
    expect(() => acquireStoreLease(dir)).toThrow(/occupied/)
    const replacement = { ...JSON.parse(fs.readFileSync(lease.file, 'utf8')), nonce: 'different-owner' }
    fs.writeFileSync(lease.file, JSON.stringify(replacement))
    lease.release()
    expect(JSON.parse(fs.readFileSync(lease.file, 'utf8')).nonce).toBe('different-owner')
  }))
  it('never treats an empty/malformed lease or interrupted recovery guard as stale', () => temporary(dir => {
    const lease = path.join(dir, '.bridge-writer-lease.json')
    fs.writeFileSync(lease, '')
    expect(() => acquireStoreLease(dir)).toThrow(/cannot be proven dead/)
    expect(fs.readFileSync(lease, 'utf8')).toBe('')
    fs.writeFileSync(path.join(dir, '.bridge-writer-recovery.json'), '{}')
    expect(() => acquireStoreLease(dir)).toThrow(/recovery is locked/)
    expect(fs.readFileSync(lease, 'utf8')).toBe('')
  }))
  it('only ESRCH proves death; EPERM and unknown failures are occupied', () => {
    expect(leaseOwnerAlive({ pid: 123 }, () => {})).toBe(true)
    for (const code of ['EPERM', 'EINVAL', undefined]) expect(leaseOwnerAlive({ pid: 123 }, () => { throw { code } })).toBe(true)
    expect(leaseOwnerAlive({ pid: 123 }, () => { throw { code: 'ESRCH' } })).toBe(false)
    expect(leaseOwnerAlive({ pid: '123' })).toBe(true)
  })
})
describe('bounded bridge identity', () => {
  it('validates version/capability/store types and canonical symlink paths', () => temporary(dir => {
    const valid = identity(dir)
    expect(compatibleIdentity(valid, { store: dir })).toBe(true)
    fs.symlinkSync(dir, path.join(dir, 'alias'), 'dir')
    expect(compatibleIdentity({ ...valid, store: path.join(dir, 'alias') }, { store: dir })).toBe(true)
    for (const bad of [null, [], { ...valid, app: 'other' }, { ...valid, version: '0.18.9' }, { ...valid, version: '1.0.0' }, { ...valid, version: 19 }, { ...valid, version: '0.19.0-beta' }, { ...valid, store: {} }, { ...valid, store: 'relative' }, { ...valid, capabilities: { ...valid.capabilities, lifecycleIdentity: true } }]) {
      expect(compatibleIdentity(bad, { store: dir })).toBe(false)
    }
  }))
  it('never spawns on timeout, HTTP error, malformed JSON or incompatible identity', async () => {
    for (const fetchImpl of [
      async () => { throw new DOMException('timeout', 'TimeoutError') },
      async () => ({ ok: false, status: 503 }),
      async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON') } }),
      async () => ({ ok: true, json: async () => identity('/different') }),
    ]) {
      const spawnImpl = vi.fn()
      await expect(ensureBridge({ store: '/expected', fetchImpl, spawnImpl })).rejects.toThrow()
      expect(spawnImpl).not.toHaveBeenCalled()
    }
  })
  it('handles asynchronous spawn errors without an unhandled error event', async () => {
    const child = new EventEmitter(); child.unref = () => {}
    const spawnImpl = () => { queueMicrotask(() => child.emit('error', new Error('spawn denied'))); return child }
    const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }) }
    await expect(ensureBridge({ bridge: '/bridge.mjs', fetchImpl, spawnImpl })).rejects.toThrow(/spawn failed: spawn denied/)
  })
  it('bounds refusal polling after a successful spawn', async () => {
    const child = new EventEmitter(); child.unref = () => {}
    const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }) }
    const start = Date.now()
    await expect(ensureBridge({ bridge: '/bridge.mjs', fetchImpl, spawnImpl: () => child, timeoutMs: 150 })).rejects.toThrow(/did not become healthy/)
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
