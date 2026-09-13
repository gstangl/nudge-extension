import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const worker = fs.readFileSync(new URL('../../extension/sw.js', import.meta.url), 'utf8')
const start = worker.indexOf('// ---------- toolbar icon as status display ----------')
const end = worker.indexOf('// ---------- bridge lifecycle via native messaging ----------')
if (start < 0 || end <= start) throw new Error('Toolbar action worker section not found')
const event = () => {
  const listeners = []
  return { addListener: listener => listeners.push(listener), emit: (...args) => listeners.forEach(listener => listener(...args)) }
}
const live = { type: 'nudge-state', active: true, bridgeOk: true, agentLive: true, open: 1 }
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness() {
  const state = { canvases: 0, icons: [], colors: [], badges: [], requests: [], iconHook: null }
  const api = {
    runtime: { onMessage: event() },
    action: {
      setIcon(value) { state.icons.push(value); return state.iconHook?.(value) ?? Promise.resolve() },
      async setBadgeBackgroundColor(value) { state.colors.push(value) },
      async setBadgeText(value) { state.badges.push(value) },
    },
    tabs: { onUpdated: event(), onRemoved: event(), async sendMessage(...args) { state.requests.push(args) } },
  }
  class Canvas {
    constructor(width, height) { state.canvases++; this.width = width; this.height = height }
    getContext() { return { scale() {}, stroke() {}, getImageData: () => ({ width: this.width, height: this.height }) } }
  }
  vm.runInNewContext(worker.slice(start, end), { chrome: api, OffscreenCanvas: Canvas, Path2D: class {} })
  const send = (message = live, tabId = 1) => api.runtime.onMessage.emit(message, { tab: { id: tabId } })
  return { state, api, send }
}

describe('bounded toolbar action rendering', () => {
  it('coalesces identical states during a roster storm and reuses the three icon sizes', () => {
    const h = harness()
    for (let i = 0; i < 1000; i++) h.send({ ...live, agentLabel: `Roster update ${i}` })
    expect(h.state.icons).toHaveLength(2) // one global default, one tab update
    expect(h.state.colors).toHaveLength(1)
    expect(h.state.badges).toHaveLength(1)
    expect(h.state.canvases).toBe(6)
    expect(Object.keys(h.state.icons[1].imageData)).toEqual(['16', '32', '48'])
  })

  it('renders every changed badge and connection state without rerasterizing an existing color', () => {
    const h = harness()
    h.send()
    h.send({ ...live, open: 2 })
    h.send({ ...live, bridgeOk: false })
    h.send({ ...live, agentLive: false })
    h.send({ ...live, active: false })
    h.send()
    expect(h.state.badges.map(b => b.text)).toEqual(['1', '2', '1', '1', '', '1'])
    expect(h.state.colors.map(b => b.color)).toEqual(['#3fa34d', '#3fa34d', '#d0342c', '#d9a441', '#9a948b', '#3fa34d'])
    expect(h.state.canvases).toBe(12) // four bounded colors, three sizes each
  })

  it('keeps per-tab state independent while sharing immutable color bitmaps', () => {
    const h = harness()
    h.send(live, 1)
    h.send(live, 2)
    h.send(live, 1)
    expect(h.state.badges.map(b => b.tabId)).toEqual([1, 2])
    expect(h.state.icons[1].imageData).toBe(h.state.icons[2].imageData)
    expect(h.state.canvases).toBe(6)
  })

  it('repaints after navigation resets, including same-document URLs and completed loads', () => {
    const h = harness(), url = 'http://localhost:5322/next'
    h.send()
    h.api.tabs.onUpdated.emit(1, { url }, { url })
    h.send()
    h.api.tabs.onUpdated.emit(1, { status: 'complete' }, { url })
    h.send()
    expect(h.state.requests).toEqual([[1, { type: 'nudge-state-req' }], [1, { type: 'nudge-state-req' }]])
    expect(h.state.badges).toHaveLength(3)
    expect(h.state.canvases).toBe(6)
  })

  it('does not repaint for title changes and clears state when a tab closes or starts loading', () => {
    const h = harness()
    h.send()
    h.api.tabs.onUpdated.emit(1, { title: 'Changed' }, { url: 'http://localhost:5322/' })
    h.send()
    expect(h.state.badges).toHaveLength(1)
    h.api.tabs.onRemoved.emit(1)
    h.send()
    h.api.tabs.onUpdated.emit(1, { status: 'loading' }, { url: 'https://example.test/' })
    h.send()
    expect(h.state.badges).toHaveLength(3)
    expect(h.state.requests).toHaveLength(0)
  })

  it('retries an identical state after a rejected action API call', async () => {
    const h = harness()
    h.state.iconHook = () => Promise.reject(new Error('Tab temporarily unavailable'))
    h.send()
    await tick()
    h.state.iconHook = null
    h.send()
    h.send()
    expect(h.state.icons).toHaveLength(3)
    expect(h.state.badges).toHaveLength(2)
  })

  it('does not let a late failure invalidate a newer successfully rendered state', async () => {
    const h = harness()
    let reject
    h.state.iconHook = () => new Promise((_, fail) => { reject = fail })
    h.send()
    h.state.iconHook = null
    h.send({ ...live, open: 2 })
    reject(new Error('Old tab update failed'))
    await tick()
    h.send({ ...live, open: 2 })
    expect(h.state.badges).toHaveLength(2)
  })

  it('contains synchronous API failures and retries the next report', () => {
    const h = harness()
    h.state.iconHook = () => { throw new Error('Action unavailable') }
    expect(() => h.send()).not.toThrow()
    h.state.iconHook = null
    h.send()
    h.send()
    expect(h.state.icons).toHaveLength(3)
    expect(h.state.badges).toHaveLength(1)
  })

  it('ignores unrelated messages and reports without a sender tab', () => {
    const h = harness()
    h.send({ type: 'nudge-queue' })
    h.api.runtime.onMessage.emit(live, {})
    expect(h.state.icons).toHaveLength(1)
    expect(h.state.badges).toHaveLength(0)
  })
})
