import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs'

const worker = fs.readFileSync(new URL('../../extension/sw.js', import.meta.url), 'utf8').split('// Dev auto-reload:')[0]
const event = () => {
  const listeners = []
  return { addListener: listener => listeners.push(listener), emit: (...args) => listeners.forEach(listener => listener(...args)), listeners }
}
const sender = (id = 1, document = 'runtime_document_1') => ({ id: 'extension-test', frameId: 0, documentId: document, url: 'http://localhost:5322/route?query=1#hash', tab: { id, windowId: 10, url: 'http://localhost:5322/route?query=1#hash' } })
function harness({ session = {}, local = {}, sessionAvailable = true, windowsAvailable = true } = {}) {
  const state = { active: 1, focused: true, url: sender().url, captures: 0, grabbed: 0, captureHook: null, encodeHook: null, queueInstalled: 0, currentDocuments: {}, probeHook: null }
  const storage = { async get(key) { return { [key]: structuredClone(session[key]) } }, async set(update) { Object.assign(session, structuredClone(update)) } }
  const tabs = { onActivated: event(), onUpdated: event(), onRemoved: event(),
    async query() { return [{ id: state.active, windowId: 10, url: state.url }] },
    async captureVisibleTab() { state.captures++; await state.captureHook?.(); return 'data:image/png;base64,AAAA' },
    async sendMessage(tabId, message, options) {
      if (message.type === 'nudge-grabbed') state.grabbed++
      if (message.type === 'nudge-document-current') {
        expect(options).toEqual({ frameId: 0 })
        if (state.probeHook) return state.probeHook()
        return { document: state.currentDocuments[tabId] || `content_document_${tabId}`, url: state.url }
      }
    },
  }
  const windows = { onFocusChanged: event(), async get() { return { focused: state.focused } } }
  const localStorage = {async get(key) {return key === null ? structuredClone(local) : {[key]:structuredClone(local[key])}},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete local[key]}}
  const api = { runtime: { id: 'extension-test', onMessage: event() }, storage: { session: sessionAvailable ? storage : undefined, local:localStorage }, tabs, windows: windowsAvailable ? windows : undefined }
  class Canvas {
    getContext() { return { drawImage() {} } }
    async convertToBlob() { await state.encodeHook?.(); return {} }
  }
  class Reader { readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload() } }
  const context = vm.createContext({ chrome: api, crypto, URL, console, setTimeout, clearTimeout, importScripts() {},
    __nudgePlatform: { browser: 'safari-test' }, NudgeQueue: { install() { state.queueInstalled++ } },
    fetch: async () => ({ blob: async () => ({}) }), createImageBitmap: async () => ({ width: 1000, height: 800 }),
    OffscreenCanvas: Canvas, FileReader: Reader,
  })
  vm.runInContext(worker, context)
  const message = (request, from = sender()) => new Promise((resolve, reject) => {
    try { api.runtime.onMessage.listeners.forEach(listener => listener(request, from, resolve)) } catch (error) { reject(error) }
  })
  const register = async (from = sender(), document = 'content_document_1') => message({ type: 'nudge-source-register', document }, from)
  const capture = (source, from = sender()) => message({ type: 'nudge-capture', browserSource: source, token: 'capture_1', rect: { x: 10, y: 10, w: 50, h: 50 }, vw: 1000, vh: 800 }, from)
  return { state, tabs, windows, session, api, message, register, capture }
}

describe('privileged browser identity and capture continuity', () => {
  it('retains same-session ambiguous retries, cleans closed/restarted tab leftovers and never deletes the offline queue', async () => {
    const first=harness(), initial=await first.register()
    const key=`nudgeDraftRetry-${initial.source.tab}`
    const local = {[key]:{payload:{browserSource:initial.source,submissionCreatedAt:new Date().toISOString()}},nudgeQueue:{entries:['preserved']}}
    const resumed=harness({session:first.session,local})
    await resumed.register()
    expect(local[key]).toBeTruthy()
    resumed.tabs.onRemoved.emit(1)
    await resumed.register(sender(2),'content_document_2') // drain serialized removal
    expect(local[key]).toBeUndefined()
    local[key]={payload:{browserSource:initial.source,submissionCreatedAt:new Date().toISOString()}}
    await harness({local}).register()
    expect(local[key]).toBeUndefined()
    expect(local.nudgeQueue).toEqual({entries:['preserved']})
  })
  it('installs one background queue owner', () => { expect(harness().state.queueInstalled).toBe(1) })
  it('serializes concurrent allocation with one session and distinct tab identities', async () => {
    const h = harness()
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => h.register(sender(i + 1), `content_document_${i + 1}`)))
    expect(results.every(r => r.ok)).toBe(true)
    expect(new Set(results.map(r => r.source.session)).size).toBe(1)
    expect(new Set(results.map(r => r.source.tab)).size).toBe(12)
    expect(Object.keys(h.session.nudgeBrowserIdentity.tabs)).toHaveLength(12)
  })
  it('preserves identities across worker suspension using session storage', async () => {
    const first = harness()
    const initial = await first.register()
    const restarted = harness({ session: first.session })
    expect(await restarted.register()).toEqual(initial)
    expect(await restarted.capture(initial.source)).toMatchObject({ ok: true })
  })
  it('never reuses persistent identities across browser restart or missing session API', async () => {
    const first = await harness().register()
    const fresh = await harness().register()
    expect(fresh.source.session).not.toBe(first.source.session)
    const session = {}
    const a = await harness({ session, sessionAvailable: false }).register()
    const b = await harness({ session, sessionAvailable: false }).register()
    expect(a.source.session).not.toBe(b.source.session)
    expect(session).toEqual({})
  })
  it('does not reuse a closed tab token when its browser numeric ID is reused', async () => {
    const h = harness()
    const first = await h.register()
    h.tabs.onRemoved.emit(1)
    h.state.currentDocuments[1] = 'content_document_2'
    const next = await h.register(sender(1, 'runtime_document_2'), 'content_document_2')
    expect(next.source.tab).not.toBe(first.source.tab)
    expect(next.source.session).toBe(first.source.session)
  })
  it('rejects copied source tokens from another tab and mismatched runtime document IDs', async () => {
    const h = harness()
    const first = await h.register()
    await h.register(sender(2), 'content_document_1')
    expect(await h.capture(first.source, sender(2))).toMatchObject({ ok: false })
    expect(await h.capture(first.source, sender(1, 'runtime_other'))).toMatchObject({ ok: false })
    expect(h.state.captures).toBe(0)
  })
  it('rejects old documents after navigation and allows a registered successor in the same tab', async () => {
    const h = harness()
    const old = await h.register()
    h.tabs.onUpdated.emit(1, { status: 'loading' })
    h.state.currentDocuments[1] = 'content_document_2'
    expect(await h.capture(old.source)).toMatchObject({ ok: false })
    const from = sender(1, 'runtime_document_2')
    const fresh = await h.register(from, 'content_document_2')
    expect(fresh.source.tab).toBe(old.source.tab)
    expect(await h.capture(fresh.source, from)).toMatchObject({ ok: true })
    expect(await h.capture(old.source)).toMatchObject({ ok: false })
    expect(await h.register()).toMatchObject({ ok: false })
  })
  it('preserves a proven current document through same-document loading/hash navigation', async () => {
    const h = harness()
    const original = await h.register()
    const changed = { ...sender(), url: 'http://localhost:5322/route?query=1#next' }
    h.state.url = changed.url
    h.tabs.onUpdated.emit(1, { status: 'loading', url: changed.url })
    expect(await h.capture(original.source, changed)).toMatchObject({ ok: true })
    expect(h.session.nudgeBrowserIdentity.tabs[1]).toMatchObject({ document: original.source.document, navigationPending: false })
    expect(await h.register(changed)).toEqual(original)
  })
  it('recovers a pending same-document navigation without browser documentId support', async () => {
    const h = harness()
    const from = { ...sender(), documentId: undefined, documentLifecycle: undefined }
    const original = await h.register(from)
    h.tabs.onUpdated.emit(1, { status: 'loading' })
    h.state.probeHook = () => { throw new Error('transition temporarily has no receiver') }
    expect(await h.capture(original.source, from)).toMatchObject({ ok: false })
    expect(h.session.nudgeBrowserIdentity.tabs[1].navigationPending).toBe(true)
    h.state.probeHook = null
    expect(await h.capture(original.source, from)).toMatchObject({ ok: true })
    expect(h.session.nudgeBrowserIdentity.tabs[1].tab).toBe(original.source.tab)
  })
  it('rejects an old document trying to reclaim registration during and after a successor navigation', async () => {
    const h = harness()
    const original = await h.register()
    h.tabs.onUpdated.emit(1, { status: 'loading' })
    h.state.currentDocuments[1] = 'content_document_2'
    expect(await h.register()).toMatchObject({ ok: false })
    expect(await h.capture(original.source)).toMatchObject({ ok: false })
    const freshSender = sender(1, 'runtime_document_2')
    const successor = await h.register(freshSender, 'content_document_2')
    expect(successor.ok).toBe(true)
    expect(await h.register()).toMatchObject({ ok: false })
    expect(await h.capture(original.source)).toMatchObject({ ok: false })
    expect(await h.capture(successor.source, freshSender)).toMatchObject({ ok: true })
  })
  it('rejects a document probe at a different route, preserving the query-string exclusion', async () => {
    const h = harness()
    const original = await h.register()
    h.state.probeHook = () => ({ document: original.source.document, url: 'http://localhost:5322/other#hash' })
    expect(await h.capture(original.source)).toMatchObject({ ok: false })
    h.state.probeHook = () => ({ document: original.source.document, url: 'http://localhost:5322/route?different=1#hash' })
    expect(await h.capture(original.source)).toMatchObject({ ok: true })
  })
  it('rejects navigation occurring while a current-document probe is in flight', async () => {
    const h = harness()
    h.state.probeHook = () => {
      h.tabs.onUpdated.emit(1, { status: 'loading' })
      return { document: 'content_document_1', url: h.state.url }
    }
    expect(await h.register()).toMatchObject({ ok: false })
  })
  it('rejects a replacement registration without a navigation boundary', async () => {
    const h = harness()
    const old = await h.register()
    expect(await h.register(sender(1, 'runtime_document_2'), 'content_document_2')).toMatchObject({ ok: false })
    expect(await h.capture(old.source)).toMatchObject({ ok: true })
  })
  it('checks active tab and focused window without activating either', async () => {
    const h = harness()
    const { source } = await h.register()
    h.state.active = 2
    expect(await h.capture(source)).toMatchObject({ ok: false })
    h.state.active = 1
    h.state.focused = false
    expect(await h.capture(source)).toMatchObject({ ok: false })
    expect(h.state.captures).toBe(0)
  })
  it('checks route before capture while deliberately excluding query strings', async () => {
    const h = harness()
    const { source } = await h.register()
    h.state.url = 'http://localhost:5322/route?query=2#hash'
    expect(await h.capture(source)).toMatchObject({ ok: true })
    h.state.url = 'http://localhost:5322/other#hash'
    expect(await h.capture(source)).toMatchObject({ ok: false })
    expect(h.state.captures).toBe(1)
  })
  it.each(['activation', 'focus', 'navigation'])('rejects %s away-and-back races during capture, but restores overlays immediately', async kind => {
    const h = harness()
    const { source } = await h.register()
    h.state.captureHook = () => {
      if (kind === 'activation') { h.tabs.onActivated.emit({ windowId: 10, tabId: 2 }); h.tabs.onActivated.emit({ windowId: 10, tabId: 1 }) }
      if (kind === 'focus') { h.windows.onFocusChanged.emit(20); h.windows.onFocusChanged.emit(10) }
      if (kind === 'navigation') { h.tabs.onUpdated.emit(1, { url: 'http://localhost:5322/other' }); h.tabs.onUpdated.emit(1, { url: h.state.url }) }
    }
    expect(await h.capture(source)).toMatchObject({ ok: false })
    expect(h.state.grabbed).toBe(1)
  })
  it('also checks continuity after asynchronous image encoding', async () => {
    const h = harness()
    const { source } = await h.register()
    h.state.encodeHook = () => h.tabs.onActivated.emit({ windowId: 10, tabId: 1 })
    expect(await h.capture(source)).toMatchObject({ ok: false })
    expect(h.state.grabbed).toBe(1)
  })
  it('restores through the content timeout if screenshot API itself rejects', async () => {
    const h = harness()
    const { source } = await h.register()
    h.state.captureHook = () => { throw new Error('permission denied') }
    expect(await h.capture(source)).toMatchObject({ ok: false })
    expect(h.state.grabbed).toBe(0)
  })
  it('supports a missing windows API explicitly, without swallowing a present API failure', async () => {
    const absent = harness({ windowsAvailable: false })
    expect(await absent.capture((await absent.register()).source)).toMatchObject({ ok: true })
    const broken = harness()
    broken.windows.get = async () => { throw new Error('window access denied') }
    expect(await broken.capture((await broken.register()).source)).toMatchObject({ ok: false })
    expect(broken.state.captures).toBe(0)
  })
  it('rejects foreign extensions, non-local documents, child frames and unbounded tokens', async () => {
    const h = harness()
    for (const from of [{ ...sender(), id: 'another-extension' }, { ...sender(), frameId: 1 }, { ...sender(), url: 'https://example.com/' }, { ...sender(), documentLifecycle: 'cached' }]) {
      expect(await h.register(from)).toMatchObject({ ok: false })
    }
    expect(await h.register(sender(), 'x'.repeat(129))).toMatchObject({ ok: false })
    expect(await h.register(sender(), '')).toMatchObject({ ok: false })
  })
})
