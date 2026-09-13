import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const worker = fs.readFileSync(new URL('../../extension/sw.js', import.meta.url), 'utf8')
const event = () => {
  const listeners = []
  return { addListener: listener => listeners.push(listener), listeners, emit: (...args) => Promise.all(listeners.map(listener => listener(...args))) }
}
function harness({ brokenIcon = false, callbackIcon = false, rejectMessage = false } = {}) {
  const sent = []
  const api = {
    runtime: { onMessage: event() }, storage: {},
    tabs: {
      onActivated: event(), onUpdated: event(), onRemoved: event(),
      async query() { return [{ id: 7 }] },
      async sendMessage(id, message) { sent.push({ id, message }); if (rejectMessage) throw new Error('No content script') },
    },
    action: {
      onClicked: event(), setIcon() { return callbackIcon ? undefined : Promise.resolve() }, async setBadgeBackgroundColor() {}, async setBadgeText() {},
    },
    commands: { onCommand: event() },
  }
  class Canvas {
    constructor() { if (brokenIcon) throw new Error('Icon renderer unavailable') }
    getContext() { return { scale() {}, stroke() {}, getImageData() { return {} } } }
  }
  let startupError
  try {
    vm.runInNewContext(worker, {
      chrome: api, crypto, URL, console, setTimeout, clearTimeout,
      importScripts() {}, __nudgePlatform: { browser: 'safari-test', nativeAutostart: false, developmentReload: false },
      NudgeQueue: { install() {} }, OffscreenCanvas: Canvas, Path2D: class {},
    })
  } catch (error) { startupError = error }
  return { api, sent, startupError }
}

describe('native toolbar activation startup', () => {
  it('registers action and shortcut handlers before fallible icon initialization', async () => {
    const h = harness({ brokenIcon: true })
    expect(h.startupError).toBeUndefined()
    expect(h.api.action.onClicked.listeners).toHaveLength(1)
    expect(h.api.commands.onCommand.listeners).toHaveLength(1)
    await h.api.action.onClicked.emit({ id: 7 })
    await h.api.commands.onCommand.emit('toggle-nudge')
    expect(h.sent).toEqual([{ id: 7, message: { type: 'nudge-toggle' } }, { id: 7, message: { type: 'nudge-toggle' } }])
  })
  it('registers each activation once and ignores unrelated commands or missing tabs', async () => {
    const h = harness()
    expect(h.startupError).toBeUndefined()
    expect(h.api.action.onClicked.listeners).toHaveLength(1)
    expect(h.api.commands.onCommand.listeners).toHaveLength(1)
    await h.api.action.onClicked.emit({})
    await h.api.commands.onCommand.emit('_execute_action')
    expect(h.sent).toEqual([])
    await h.api.action.onClicked.emit({ id: 7 })
    expect(h.sent).toHaveLength(1)
  })
  it('contains missing-content-script delivery failures', async () => {
    const h = harness({ rejectMessage: true })
    await expect(h.api.action.onClicked.emit({ id: 7 })).resolves.toBeDefined()
    await expect(h.api.commands.onCommand.emit('toggle-nudge')).resolves.toBeDefined()
    expect(h.sent).toHaveLength(2)
  })
  it('does not require a promise from the startup icon API', async () => {
    const h = harness({ callbackIcon: true })
    expect(h.startupError).toBeUndefined()
    await h.api.commands.onCommand.emit('toggle-nudge')
    expect(h.sent).toEqual([{ id: 7, message: { type: 'nudge-toggle' } }])
  })
})
