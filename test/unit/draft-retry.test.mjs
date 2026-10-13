import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const content = fs.readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf8')
const sendBlock = content.slice(content.indexOf('  let pendingSubmission = null'), content.indexOf('  // feedback feed:'))
const snapshotBlock = content.slice(content.indexOf('  function saveSnapNow()'), content.indexOf("  addEventListener('pagehide', saveSnapNow)"))
const replyBlock = content.slice(content.indexOf('  async function boundedReply('), content.indexOf('  let browserSource = null'))
const sourceBlock = content.slice(content.indexOf('  async function boundedReply('), content.indexOf('  // Bridge endpoints.'))
afterEach(() => vi.useRealTimers())

function fixture() {
  const snapshots = new Map(), stored = new Map(), submitted = []
  const button = { disabled: false }, textarea = { value: 'Keep this draft', selectionStart: 0, selectionEnd: 0 }
  const target = { rect: { left: 0, top: 0, width: 20, height: 20 }, frozen: { selector: '#target' } }
  const local = {
    get: vi.fn(async key => key === null ? Object.fromEntries(stored) : { [key]: stored.get(key) }),
    set: vi.fn(async entries => { for (const [key, value] of Object.entries(entries)) stored.set(key, value) }),
    remove: vi.fn(async key => stored.delete(key)),
  }
  const env = {
    crypto, Date, Promise, setTimeout, clearTimeout, snapTimer: 0, dead: false,
    sourceReady: Promise.resolve(), ensureSource: vi.fn(async () => true), browserSource: { tab: 'test_tab' },
    chrome: { runtime: { getURL: () => '' }, storage: { local } },
    picked: target, composer: { style: { display: 'block' }, querySelector: () => button }, ta: textarea,
    document: { title: 'Fixture' }, window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 },
    location: { href: 'http://localhost/fixture' }, samePage: url => url === 'http://localhost/fixture', navigator: { userAgent: 'test' },
    author: 'test', contextOf: t => t.frozen, multiTargets: () => null, getConsole: async () => [],
    notify: vi.fn(), agentLive: false, agentWake: null, mode: 'composing',
    root: { activeElement: textarea }, multi: [], pillWant: {},
    queue: { classList: { contains: () => false } }, qExpanded: [], qAmendDraft: [],
    pinCache: [], agentLabel: null, agents: [], SNAP_KEY: 'snapshot',
    sessionStorage: { setItem: (key, value) => snapshots.set(key, value) },
    queueRequest: vi.fn(async (_action, { payload }) => { submitted.push(payload); return { ok: true, id: 'nudge_1' } }),
    queueReason: value => value,
    setMode: () => { env.picked = null; env.composer.style.display = 'none' },
  }
  const api = vm.runInNewContext(`${replyBlock}\n${sendBlock}\n${snapshotBlock}\n({send, saveSnapNow, setRestore(ref) { pendingRestore = {target:picked, ref, text:ta.value.trim()} }})`, env)
  return { api, env, stored, submitted, local, snapshot: () => JSON.parse(snapshots.get('snapshot')) }
}

describe('draft retry persistence', () => {
  it('retries a failed restoration read and replays the original submission', async () => {
    const f = fixture()
    f.env.queueRequest.mockRejectedValueOnce(new Error('ack lost'))
    await f.api.send()
    const original = structuredClone([...f.stored.values()][0])
    const restored = fixture()
    restored.stored.set('nudgeDraftRetry-test_tab', original)
    restored.api.setRestore(original.ref)
    restored.local.get.mockRejectedValueOnce(new Error('worker waking'))
    await restored.api.send()
    expect(restored.submitted).toHaveLength(0)
    await restored.api.send()
    expect(restored.submitted).toEqual([original.payload])
  })

  it('finds the exact retry under its previous browser tab identity', async () => {
    const f = fixture()
    f.env.queueRequest.mockRejectedValueOnce(new Error('ack lost'))
    await f.api.send()
    const original = structuredClone([...f.stored.values()][0])
    const restored = fixture()
    restored.stored.set('nudgeDraftRetry-previous_tab', original)
    restored.api.setRestore(original.ref)
    await restored.api.send()
    expect(restored.submitted).toEqual([original.payload])
  })

  it('keeps a missing or mismatched restored reference blocked', async () => {
    const f = fixture()
    f.api.setRestore('missing_retry_ref')
    f.stored.set('nudgeDraftRetry-previous_tab', { ref: 'missing_retry_ref', payload: { text: 'Keep this draft', url: 'http://localhost/other' } })
    await f.api.send()
    expect(f.submitted).toHaveLength(0)
    expect(f.env.picked).not.toBeNull()
  })

  it('does not persist an unsaved retry reference on pagehide after a storage failure', async () => {
    const f = fixture()
    f.local.set.mockRejectedValueOnce(new Error('quota exceeded'))
    await f.api.send()
    f.api.saveSnapNow() // pagehide after the failed send
    expect(f.submitted).toHaveLength(0)
    expect(f.snapshot().composer.text).toBe('Keep this draft')
    expect(f.snapshot().composer.retryRef).toBeNull()
    expect(f.env.composer.querySelector().disabled).toBe(false)
    await f.api.send()
    expect(f.submitted).toHaveLength(1)
  })

  it('retains the exact submission after an ambiguous acknowledgement', async () => {
    const f = fixture()
    f.env.queueRequest.mockRejectedValueOnce(new Error('ack lost'))
    await f.api.send()
    const first = [...f.stored.values()][0]
    expect(f.snapshot().composer.retryRef).toBe(first.ref)
    await f.api.send()
    expect(f.submitted[0].submissionId).toBe(first.payload.submissionId)
    expect(f.stored.size).toBe(0)
  })

  it('never sends when the page snapshot cannot be saved', async () => {
    const f = fixture()
    f.env.sessionStorage.setItem = () => { throw new Error('blocked') }
    await f.api.send()
    expect(f.submitted).toHaveLength(0)
    expect(f.env.picked).not.toBeNull()
  })

  it('preserves an unresolved restored reference across another pagehide', async () => {
    const f = fixture()
    f.api.setRestore('previous_retry_ref')
    f.api.saveSnapNow()
    expect(f.snapshot().composer.retryRef).toBe('previous_retry_ref')
    await f.api.send()
    expect(f.submitted).toHaveLength(0)
  })

  it('keeps an unregistered draft sendable without a phantom retry reference', async () => {
    const f = fixture()
    f.env.ensureSource.mockResolvedValueOnce(null)
    await f.api.send()
    f.api.saveSnapNow()
    expect(f.snapshot().composer.retryRef).toBeNull()
    expect(f.local.set).not.toHaveBeenCalled()
    await f.api.send()
    expect(f.submitted).toHaveLength(1)
  })

  it('retries failed registration and coalesces concurrent callers', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('startup race'))
      .mockResolvedValue({ ok: true, source: { tab: 'test_tab' } })
    const api = vm.runInNewContext(`${sourceBlock}\n;({ensureSource, sourceReady})`, {
      chrome: { runtime: { sendMessage } }, documentToken: 'test_document', Promise, setTimeout, clearTimeout,
    })
    expect(await api.sourceReady).toBeNull()
    const a = api.ensureSource(), b = api.ensureSource()
    expect(a).toBe(b)
    expect(await a).toEqual({ tab: 'test_tab' })
    await api.ensureSource()
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('releases Send after a preparation exception and keeps the draft retryable', async () => {
    const f = fixture()
    f.env.contextOf = vi.fn().mockImplementationOnce(() => { throw new Error('detached target') })
      .mockReturnValue({ selector: '#target' })
    await f.api.send()
    expect(f.env.composer.querySelector().disabled).toBe(false)
    expect(f.env.ta.value).toBe('Keep this draft')
    expect(f.submitted).toHaveLength(0)
    await f.api.send()
    expect(f.submitted).toHaveLength(1)
  })

  it('recovers from a storage call that never replies without submitting', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.local.set.mockImplementationOnce(() => new Promise(() => {}))
    const sending = f.api.send()
    await vi.advanceTimersByTimeAsync(3001)
    await sending
    expect(f.env.composer.querySelector().disabled).toBe(false)
    expect(f.submitted).toHaveLength(0)
    f.api.saveSnapNow()
    expect(f.snapshot().composer.retryRef).toBeNull()
    await f.api.send()
    expect(f.submitted).toHaveLength(1)
  })

  it('bounds a missing queue reply and ignores its late acknowledgement after retry', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let finish
    f.env.queueRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const sending = f.api.send()
    await vi.advanceTimersByTimeAsync(20001)
    await sending
    expect(f.env.composer.querySelector().disabled).toBe(false)
    const original = [...f.stored.values()][0].payload.submissionId
    expect(f.env.picked).not.toBeNull()
    await f.api.send()
    expect(f.submitted[0].submissionId).toBe(original)
    finish({ ok: true, id: 'late_ack' })
    await Promise.resolve()
    expect(f.submitted).toHaveLength(1)
    expect(f.env.notify.mock.calls.some(call => String(call[1]).includes('late_ack'))).toBe(false)
  })

  it('allows registration to retry after a missing startup reply', async () => {
    vi.useFakeTimers()
    const sendMessage = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ ok: true, source: { tab: 'test_tab' } })
    const api = vm.runInNewContext(`${sourceBlock}\n;({ensureSource, sourceReady})`, {
      chrome: { runtime: { sendMessage } }, documentToken: 'test_document', Promise, setTimeout, clearTimeout,
    })
    await vi.advanceTimersByTimeAsync(3001)
    expect(await api.sourceReady).toBeNull()
    expect(await api.ensureSource()).toEqual({ tab: 'test_tab' })
  })

  it.each(['{broken', '{"not":"an array"}'])('settles malformed page-console context: %s', async detail => {
    const block = content.slice(content.indexOf('  function getConsole()'), content.indexOf('  // ---------- capture helpers'))
    const listeners = new Map()
    const api = vm.runInNewContext(`${block};({getConsole})`, {
      setTimeout, clearTimeout, JSON, Promise,
      CustomEvent: class {},
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name),
      dispatchEvent: () => listeners.get('groundworks-nudge-console-res')({ detail }),
    })
    expect(await api.getConsole()).toEqual([])
    expect(listeners.size).toBe(0)
  })
})
