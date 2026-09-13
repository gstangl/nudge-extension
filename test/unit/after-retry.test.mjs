import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

// Execute the actual content-script scheduling block with only browser IO
// replaced. Keep request arbitration in production code, not a copied model.
const content = fs.readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf8')
const block = content.slice(content.indexOf('  const afterAttempted = new Set()'), content.indexOf('  // ---------- prompt tracking ----------'))
const pin = { id: 'nudge_1', browserSource: { browser: 'chromium', session: 'session_one', tab: 'tab_one', document: 'document_one' }, url: 'http://localhost/fixture', isRegion: true, target: { rect: { x: 10, y: 20, w: 100, h: 100 } } }
function fixture() {
  vi.useFakeTimers()
  const environment = {
    document: { hidden: false, querySelector: () => null },
    bridgeCapabilities: { sourceBoundEvidence: 1 }, browserSource: pin.browserSource,
    dead: false, HTTP: 'http://localhost:4821', samePage: () => true,
    captureRegion: vi.fn().mockResolvedValue({ dataUrl: 'new pixels' }),
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    setTimeout, clearTimeout,
  }
  const api = vm.runInNewContext(`${block}\n({ captureAfter, latestAfterRequests, afterAttempted })`, environment)
  return { ...api, environment }
}
afterEach(() => { vi.useRealTimers() })
describe('source-bound after-request arbitration', () => {
  it('ignores a pre-navigation grab signal while a successor capture is hidden', () => {
    const start=content.indexOf('    const token = `cap_')
    const correlation=content.slice(start,content.indexOf('    chrome.runtime.onMessage.addListener(onGrabbed)',start))
    const setup=documentToken=>{
      const restore=vi.fn()
      const api=vm.runInNewContext(`let captureSeq=0, grabbedClean=false, restored=false;${correlation};({token,onGrabbed})`,{documentToken,restore})
      return {...api,restore}
    }
    const old=setup('old_document'),next=setup('successor_document')
    expect(next.token).not.toBe(old.token)
    next.onGrabbed({type:'nudge-grabbed',token:old.token})
    expect(next.restore).not.toHaveBeenCalled()
    next.onGrabbed({type:'nudge-grabbed',token:next.token})
    expect(next.restore).toHaveBeenCalledTimes(1)
  })
  it('coalesces private replacement tokens while old pixels are in flight', async () => {
    const f = fixture()
    let finish
    f.environment.captureRegion.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const original = f.captureAfter(pin, 'old-request')
    await f.captureAfter(pin, 'middle-request')
    await f.captureAfter(pin, 'newest-request')
    finish({ dataUrl: 'obsolete pixels' }); await original
    expect(f.environment.fetch).not.toHaveBeenCalled()
    await vi.runOnlyPendingTimersAsync()
    expect(f.environment.captureRegion).toHaveBeenCalledTimes(2)
    expect(f.environment.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(f.environment.fetch.mock.calls[0][1].body).requestId).toBe('newest-request')
    expect(f.afterAttempted.has(pin.id)).toBe(true)
  })
  it('cancels a scheduled retry when a fresh request arrives', async () => {
    const f = fixture()
    f.environment.captureRegion.mockResolvedValueOnce(null)
    await f.captureAfter(pin, 'old-request')
    await f.captureAfter(pin, 'fresh-request')
    await vi.runOnlyPendingTimersAsync()
    expect(f.environment.captureRegion).toHaveBeenCalledTimes(2)
    expect(f.environment.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(f.environment.fetch.mock.calls[0][1].body).requestId).toBe('fresh-request')
  })
  it('a deferred timer cannot re-register an older token over a newer hidden-tab request', async () => {
    const f = fixture()
    let finish
    f.environment.captureRegion.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const original = f.captureAfter(pin, 'original')
    await f.captureAfter(pin, 'superseded')
    finish(null); await original
    f.environment.document.hidden = true
    await f.captureAfter(pin, 'latest-hidden')
    await vi.runOnlyPendingTimersAsync()
    expect(f.latestAfterRequests.get(pin.id).requestId).toBe('latest-hidden')
    expect(f.environment.captureRegion).toHaveBeenCalledTimes(1)
    expect(f.environment.fetch).not.toHaveBeenCalled()
  })
  it('uses the replacement after the bridge rejects an already-posted old token', async () => {
    const f = fixture()
    let rejectOld
    f.environment.fetch.mockReturnValueOnce(new Promise(resolve => { rejectOld = resolve }))
    const original = f.captureAfter(pin, 'old-request')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.environment.fetch).toHaveBeenCalledTimes(1)
    await f.captureAfter(pin, 'fresh-request')
    rejectOld({ ok: false }); await original
    expect(f.afterAttempted.has(pin.id)).toBe(false)
    await vi.runOnlyPendingTimersAsync()
    expect(f.environment.fetch.mock.calls.map(call => JSON.parse(call[1].body).requestId)).toEqual(['old-request', 'fresh-request'])
    expect(f.afterAttempted.has(pin.id)).toBe(true)
  })
})
