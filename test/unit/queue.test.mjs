import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs'

const context = vm.createContext({ URL, AbortSignal, fetch, crypto, Date })
vm.runInContext(fs.readFileSync(new URL('../../extension/queue.js', import.meta.url), 'utf8'), context)
const NOW = Date.parse('2026-01-10T12:00:00Z')
const copy = value => structuredClone(value)
const payload = (n = 1, extra = {}) => ({ submissionId: `submission_${n}`, submissionCreatedAt: new Date(NOW).toISOString(), text: `Prompt ${n}`, url: 'http://localhost:5322/', target: { selector: '#target' }, ...extra })
const submit = value => ({ action: 'submit', payload: value })
function fixture(initial) {
  const state = { data: initial === undefined ? {} : { nudgeQueue: copy(initial) }, writes: 0, requests: [], sent: [], failWrite: 0, offline: false, loseResponse: false, status: 201, body: null, capability: true }
  const receipts = new Map()
  const storage = {
    async get(key) { return { [key]: copy(state.data[key]) } },
    async set(update) { state.writes++; if (state.failWrite === state.writes) throw new Error('QUOTA_BYTES'); state.data = { ...state.data, ...copy(update) } },
  }
  let serial = 0
  const request = async (url, options) => {
    state.requests.push(url)
    if (state.offline) throw new Error('offline')
    if (url.endsWith('/.identity')) return { ok: true, json: async () => ({ app: 'groundworks-nudge', capabilities: { submissionIdempotency: state.capability ? 1 : 0 } }) }
    const p = JSON.parse(options.body)
    state.sent.push(p)
    if (!receipts.has(p.submissionId)) receipts.set(p.submissionId, { id: `nudge_${receipts.size + 1}`, replay: false })
    const receipt = receipts.get(p.submissionId)
    if (state.loseResponse) { state.loseResponse = false; throw new Error('response lost after commit') }
    return { ok: state.status < 400, status: state.status, json: async () => state.body || receipt }
  }
  const restart = () => context.NudgeQueue.create({ storage, fetch: request, endpoint: async () => 'http://localhost:4822', now: () => NOW, uuid: () => `migration_${++serial}` })
  return { state, storage, receipts, restart, owner: restart() }
}

describe('serialized durable browser submission queue', () => {
  it('persists before transport and acknowledges only a validated delivered response', async () => {
    const { owner, state } = fixture()
    const reply = await owner.handle(submit(payload()))
    expect(reply).toMatchObject({ ok: true, queued: false, id: 'nudge_1' })
    expect(state.writes).toBe(2)
    expect(state.data.nudgeQueue.entries).toEqual([])
  })
  it('serializes two visible-window submissions and concurrent flushes without loss or duplicates', async () => {
    const { owner, state } = fixture()
    state.offline = true
    await Promise.all(Array.from({ length: 10 }, (_, i) => owner.handle(submit(payload(i)))))
    expect(state.data.nudgeQueue.entries.map(e => e.payload.text)).toEqual(Array.from({ length: 10 }, (_, i) => `Prompt ${i}`))
    state.offline = false
    await Promise.all(Array.from({ length: 4 }, () => owner.handle({ action: 'flush' })))
    expect(state.sent.map(p => p.text)).toEqual(Array.from({ length: 10 }, (_, i) => `Prompt ${i}`))
    expect(state.data.nudgeQueue.entries).toEqual([])
  })
  it('keeps the stable payload across a post-commit network loss and worker restart', async () => {
    const { owner, state, restart, receipts } = fixture()
    state.loseResponse = true
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, queued: true })
    expect(await restart().handle({ action: 'flush' })).toMatchObject({ ok: true, delivered: [{ id: 'nudge_1' }] })
    expect(state.sent[0]).toEqual(state.sent[1])
    expect(receipts.size).toBe(1)
  })
  it('rejects initial storage failure before sending, and recovers its serialized owner', async () => {
    const { owner, state } = fixture()
    state.failWrite = 1
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: false, error: 'storage_unavailable' })
    expect(state.requests).toHaveLength(0)
    expect(state.data).toEqual({})
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, id: 'nudge_1' })
  })
  it('retains already durable work when acknowledgment deletion fails', async () => {
    const { owner, state, restart, receipts } = fixture()
    state.failWrite = 2
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, queued: true, reason: 'storage_unavailable' })
    expect(state.data.nudgeQueue.entries[0].payload).toEqual(payload())
    expect(await restart().handle({ action: 'flush' })).toMatchObject({ ok: true, delivered: [{ id: 'nudge_1' }] })
    expect(receipts.size).toBe(1)
  })
  it('preserves all 25 accepted items and rejects number 26 without eviction', async () => {
    const { owner, state } = fixture()
    state.offline = true
    for (let n = 0; n < 25; n++) expect(await owner.handle(submit(payload(n)))).toMatchObject({ ok: true, queued: true })
    const before = copy(state.data)
    expect(await owner.handle(submit(payload(26)))).toMatchObject({ ok: false, error: 'queue_full' })
    expect(state.data).toEqual(before)
    expect(await owner.handle(submit(payload(0)))).toMatchObject({ ok: true, queued: true })
  })
  it('refuses reuse of a durable token with different content', async () => {
    const { owner, state } = fixture()
    state.offline = true
    await owner.handle(submit(payload()))
    expect(await owner.handle(submit(payload(1, { text: 'different' })))).toMatchObject({ ok: false, error: 'submission_conflict' })
    expect(state.data.nudgeQueue.entries[0].payload.text).toBe('Prompt 1')
  })
  it.each([400, 409, 500])('keeps the queue on HTTP %i', async status => {
    const { owner, state } = fixture()
    state.status = status
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, queued: true })
    expect(state.data.nudgeQueue.entries).toHaveLength(1)
  })
  it.each([{}, { id: 1 }, { id: 'not-a-nudge' }])('keeps the queue on malformed response %j', async body => {
    const { owner, state } = fixture()
    state.body = body
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, queued: true, reason: 'invalid_response' })
    expect(state.data.nudgeQueue.entries).toHaveLength(1)
  })
  it('does not replay against an old bridge lacking idempotency', async () => {
    const { owner, state } = fixture()
    state.capability = false
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, queued: true, reason: 'idempotency_unavailable' })
    expect(state.sent).toHaveLength(0)
  })
  it('migrates legacy order/content without invented age or provenance and requires explicit action', async () => {
    const originals = [{ text: 'old prompt', screenshot: 'data:image/png;base64,AAAA' }, payload(2)]
    const { owner, state, restart } = fixture(originals)
    expect(await owner.handle({ action: 'flush' })).toMatchObject({ ok: true, reason: 'legacy_delivery_unknown' })
    expect(state.sent).toHaveLength(0)
    const saved = copy(state.data.nudgeQueue)
    expect(saved.entries[0].payload).toEqual({ ...originals[0], submissionId: 'migration_1' })
    expect(saved.entries[1].payload).toEqual(originals[1])
    expect(await restart().handle({ action: 'status' })).toMatchObject({ entries: [{ pending: 'legacy_delivery_unknown' }, { pending: null }] })
    expect(state.data.nudgeQueue).toEqual(saved)
    await owner.handle({ action: 'discard', submissionId: 'migration_1' })
    expect(await owner.handle({ action: 'flush' })).toMatchObject({ delivered: [{ submissionId: 'submission_2' }] })
  })
  it('preserves originals when interrupted before migration write and tokens after it', async () => {
    const originals = [{ text: 'first' }, { text: 'second' }]
    const { owner, state, restart } = fixture(originals)
    state.failWrite = 1
    expect(await owner.handle({ action: 'flush' })).toMatchObject({ ok: false, error: 'storage_unavailable' })
    expect(state.data.nudgeQueue).toEqual(originals)
    expect(state.requests).toHaveLength(0)
    await restart().handle({ action: 'status' })
    const migrated = copy(state.data.nudgeQueue)
    await restart().handle({ action: 'flush' })
    expect(state.data.nudgeQueue).toEqual(migrated)
    expect(state.sent).toHaveLength(0)
  })
  it('keeps expired and future items pending without changing creation time', async () => {
    const expired = payload(1, { submissionCreatedAt: new Date(NOW - 7 * 86400e3 - 1).toISOString() })
    const { owner, state } = fixture([expired])
    expect(await owner.handle({ action: 'flush' })).toMatchObject({ reason: 'retry_expired' })
    expect(state.data.nudgeQueue.entries[0].payload).toEqual(expired)
    expect(state.sent).toHaveLength(0)
    expect(await owner.handle(submit(expired))).toMatchObject({ ok: false, error: 'invalid_submission' })
    expect(await owner.handle(submit(payload(2, { submissionCreatedAt: new Date(NOW + 300001).toISOString() })))).toMatchObject({ ok: false, error: 'invalid_submission' })
  })
  it('preserves unsupported envelopes rather than overwriting them', async () => {
    const original = { version: 99, entries: [{ future: true }] }
    const { owner, state } = fixture(original)
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: false, error: 'queue_version_unsupported' })
    expect(state.data.nudgeQueue).toEqual(original)
    expect(state.writes).toBe(0)
  })
  it('accepts a withdrawn receipt without resurrecting the prompt', async () => {
    const { owner, state } = fixture()
    state.body = { id: 'nudge_1', replay: true, withdrawn: true }
    expect(await owner.handle(submit(payload()))).toMatchObject({ ok: true, id: 'nudge_1', withdrawn: true, queued: false })
    expect(state.data.nudgeQueue.entries).toEqual([])
  })
})

describe('local content-script HTTP transport', () => {
  function installed() {
    const f = fixture()
    let listener
    const calls = []
    let lostTab = null
    let invalidResponse = false
    const api = {
      runtime: { id: 'test-extension', onMessage: { addListener(fn) { listener = fn } } },
      storage: { local: f.storage },
      tabs: { async sendMessage(tabId, request, options) {
        calls.push({ tabId, request, options })
        if (tabId === lostTab) throw new Error('Could not establish connection: tab closed')
        if (invalidResponse) return { ok: true, status: 500, body: { id: 'nudge_1' } }
        if (request.method === 'GET') return { ok: true, status: 200, body: { app: 'groundworks-nudge', capabilities: { submissionIdempotency: 1 } } }
        return { ok: true, status: 201, body: { id: `nudge_${tabId}` } }
      } },
    }
    context.NudgeQueue.install(api, { bridgePort: 4822 })
    const sender = id => ({ id: api.runtime.id, tab: { id }, frameId: 0, url: 'http://localhost:5322/' })
    const send = (message, from = sender(1)) => new Promise(resolve => listener({ type: 'nudge-queue', ...message }, from, resolve))
    return { ...f, calls, send, sender, loseTab(id) { lostTab = id }, invalidate() { invalidResponse = true } }
  }
  it('keeps concurrent request transports bound to each actual sender tab', async () => {
    const f = installed()
    // Use current creation time: install deliberately uses the real clock.
    const fresh = n => payload(n, { submissionCreatedAt: new Date().toISOString() })
    const replies = await Promise.all([f.send(submit(fresh(1)), f.sender(1)), f.send(submit(fresh(2)), f.sender(2))])
    expect(replies.map(r => r.id)).toEqual(['nudge_1', 'nudge_2'])
    expect(f.calls.map(c => [c.tabId, c.request.method])).toEqual([[1, 'GET'], [1, 'POST'], [2, 'GET'], [2, 'POST']])
    expect(f.calls.every(c => c.options.frameId === 0)).toBe(true)
    expect(f.calls[1].request.url).toBe('http://localhost:4822/comments')
    expect(JSON.parse(f.calls[1].request.body).submissionId).toBe('submission_1')
  })
  it('retains durable work when its transport tab closes and retries from a new local tab', async () => {
    const f = installed()
    f.loseTab(1)
    const p = payload(1, { submissionCreatedAt: new Date().toISOString() })
    expect(await f.send(submit(p))).toMatchObject({ ok: true, queued: true, reason: 'bridge_offline' })
    expect(f.state.data.nudgeQueue.entries[0].payload).toEqual(p)
    expect(await f.send({ action: 'flush' }, f.sender(2))).toMatchObject({ delivered: [{ id: 'nudge_2', submissionId: 'submission_1' }] })
    expect(JSON.parse(f.calls.at(-1).request.body)).toEqual(p)
  })
  it('rejects malformed transport results without dropping durable work', async () => {
    const f = installed()
    f.invalidate()
    expect(await f.send(submit(payload(1, { submissionCreatedAt: new Date().toISOString() })))).toMatchObject({ ok: true, queued: true, reason: 'transport_response_invalid' })
    expect(f.state.data.nudgeQueue.entries).toHaveLength(1)
  })
  it('rejects other extensions, nonlocal origins, child frames and missing browser tab IDs', async () => {
    const f = installed()
    const baseline = f.sender(1)
    for (const from of [{ ...baseline, id: 'other' }, { ...baseline, url: 'https://example.com/' }, { ...baseline, frameId: 1 }, { ...baseline, tab: null }, { ...baseline, frameId: undefined }]) {
      expect(await f.send({ action: 'status' }, from)).toMatchObject({ ok: false, error: 'queue_sender_rejected' })
    }
    expect(f.calls).toHaveLength(0)
  })
})
