import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveAgentId,
  resolveAgentRuntime,
  resolveAgentSurface,
  resolveStoreDir,
  resolveWake,
} from '../../agent/runtime.mjs'

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-runtime-'))

describe('runtime-neutral store', () => {
  it('uses the explicit store override first', () => {
    expect(resolveStoreDir({ env: { NUDGE_STORE: '/tmp/nudge-explicit' }, home: '/unused' })).toBe('/tmp/nudge-explicit')
  })

  it('uses a neutral path for a fresh installation and preserves a legacy installation', () => {
    const fresh = tempHome()
    expect(resolveStoreDir({ env: {}, home: fresh })).toBe(path.join(fresh, '.nudge'))

    const legacy = tempHome()
    fs.mkdirSync(path.join(legacy, '.claude', 'nudge'), { recursive: true })
    expect(resolveStoreDir({ env: {}, home: legacy })).toBe(path.join(legacy, '.claude', 'nudge'))
  })

  it('accepts a legacy symlink to the neutral store but refuses split-brain data', () => {
    const linked = tempHome()
    fs.mkdirSync(path.join(linked, '.nudge'), { recursive: true })
    fs.mkdirSync(path.join(linked, '.claude'), { recursive: true })
    fs.symlinkSync(path.join(linked, '.nudge'), path.join(linked, '.claude', 'nudge'))
    expect(resolveStoreDir({ env: {}, home: linked })).toBe(path.join(linked, '.nudge'))

    const conflict = tempHome()
    fs.mkdirSync(path.join(conflict, '.nudge'), { recursive: true })
    fs.mkdirSync(path.join(conflict, '.claude', 'nudge'), { recursive: true })
    expect(() => resolveStoreDir({ env: {}, home: conflict })).toThrow(/store conflict/i)
  })
})

describe('runtime-neutral agent identity', () => {
  it('normalizes generic, Codex, and Claude identities in priority order', () => {
    const codexThread = '123e4567-e89b-12d3-a456-426614174000'
    expect(resolveAgentId({ NUDGE_AGENT_ID: 'generic', CODEX_THREAD_ID: 'thread', CLAUDE_CODE_SESSION_ID: 'claude' })).toBe('generic')
    expect(resolveAgentId({ CODEX_THREAD_ID: codexThread, CODEX_SESSION_ID: 'session' })).toBe(codexThread)
    expect(resolveAgentId({ CODEX_SESSION_ID: 'session' })).toBe('session')
    expect(resolveAgentId({ CLAUDE_CODE_SESSION_ID: '1234567890' })).toBe('1234567890')
    expect(resolveAgentId({ NUDGE_AGENT_ID: 'x'.repeat(200) })).toHaveLength(128)
    expect(resolveAgentId({})).toBeNull()
  })

  it('keeps runtime, surface, and wake capability independent', () => {
    const env = { CODEX_THREAD_ID: 't', ZED_ENVIRONMENT: '1' }
    expect(resolveAgentRuntime(env)).toBe('Codex')
    expect(resolveAgentSurface(env)).toBe('Zed')
    expect(resolveWake(env)).toBe('pull')
    expect(resolveWake({ NUDGE_WAKE: 'push' })).toBe('push')
    expect(resolveWake({ NUDGE_WAKE: 'invalid' })).toBe('pull')
  })
})
