import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// store.mjs freezes STORE_DIR from NUDGE_STORE at import time (store.mjs:21).
// Set it BEFORE the module loads, and use a dynamic import so the env is in
// place when the top-level const is evaluated.
const STORE = path.join(os.tmpdir(), `nudge-store-unit-${process.pid}`)
process.env.NUDGE_STORE = STORE
const store = await import('../../bridge/store.mjs')

// Force store.mjs's mtime-cache to reload after we write store.json behind its
// back: same-millisecond writes could otherwise keep a stale cache and flake.
function bumpMtime(file) {
  const future = new Date(Date.now() + 2000)
  fs.utimesSync(file, future, future)
}
const storeFile = () => path.join(STORE, 'store.json')

beforeEach(() => {
  // Wipe the whole store dir. Next load() sees a missing file, invalidates its
  // mtime cache and starts empty (seq 0, no inbox) — a clean per-test reset.
  fs.rmSync(STORE, { recursive: true, force: true })
})

describe('store.mjs — pin lifecycle', () => {
  it('issues sequential nudge_N ids and never reuses one after delete', () => {
    expect(store.addPin({ text: 'a', url: 'https://x/' }, null).id).toBe('nudge_1')
    expect(store.addPin({ text: 'b', url: 'https://x/' }, null).id).toBe('nudge_2')
    store.deletePin('nudge_2')
    // seq is untouched by delete → the freed number is NOT reused
    expect(store.addPin({ text: 'c', url: 'https://x/' }, null).id).toBe('nudge_3')
  })

  it('caps oversized client fields', () => {
    const pin = store.addPin({ text: 'x'.repeat(5000), url: 'u'.repeat(3000), author: 'a'.repeat(200) }, null)
    expect(pin.text).toHaveLength(4000)
    expect(pin.url).toHaveLength(2000)
    expect(pin.author).toHaveLength(80)
  })

  it('advances seq past any existing pin number so a hand-edited store cannot cause id reuse', () => {
    store.addPin({ text: 'a', url: 'https://x/' }, null) // nudge_1
    fs.writeFileSync(storeFile(), JSON.stringify({
      seq: 1,
      pins: [{ id: 'nudge_50', status: 'open', createdAt: new Date().toISOString(), text: 'hand', url: 'u' }],
    }))
    bumpMtime(storeFile())
    // Math.max(seq, max-existing-id) + 1 → past nudge_50, not seq+1
    expect(store.addPin({ text: 'b', url: 'https://x/' }, null).id).toBe('nudge_51')
  })

  it('prunes old resolved pins but never open ones', () => {
    const open = store.addPin({ text: 'open', url: 'https://x/' }, null)
    const done = store.addPin({ text: 'done', url: 'https://x/' }, null)
    store.resolvePin(done.id, null)
    // age the resolved pin far past the 7-day window
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    for (const p of data.pins) if (p.status === 'resolved') p.resolvedAt = new Date(Date.now() - 30 * 24 * 3600e3).toISOString()
    fs.writeFileSync(storeFile(), JSON.stringify(data))
    bumpMtime(storeFile())
    expect(store.pruneResolved()).toBe(1)
    expect(store.getPin(open.id)).toBeTruthy()
    expect(store.getPin(done.id)).toBeUndefined()
  })
})

describe('store.mjs — owner provenance (bulletproof binding)', () => {
  it('stamps the server-decided owner and ignores any owner in the payload', () => {
    const pin = store.addPin(
      { text: 't', url: 'https://x/', owner: { label: 'SPOOFED', session: 'evil' } },
      { label: 'Gerald S.', session: 'sess-1' },
    )
    expect(pin.owner).toEqual({ label: 'Gerald S.', session: 'sess-1' })
  })

  it('caps owner label to 60 and session to 32', () => {
    const pin = store.addPin({ text: 't', url: 'https://x/' }, { label: 'L'.repeat(100), session: 'S'.repeat(50) })
    expect(pin.owner.label).toHaveLength(60)
    expect(pin.owner.session).toHaveLength(32)
  })

  it('keeps an owned pin immutable on resolve, but attributes the resolver when the pin was unowned', () => {
    const owned = store.addPin({ text: 'owned', url: 'https://x/' }, { label: 'Owner A', session: 's1' })
    expect(store.resolvePin(owned.id, { label: 'Resolver B', session: 's2' }).owner.label).toBe('Owner A')

    const orphan = store.addPin({ text: 'orphan', url: 'https://x/' }, null)
    const r = store.resolvePin(orphan.id, { label: 'Resolver B', session: 's2' })
    expect(r.owner.label).toBe('Resolver B')
    expect(r.status).toBe('resolved')
  })
})

describe('store.mjs — corrupt-store recovery', () => {
  it('backs up a wrong-shape store.json, restarts empty, and floors seq from the inbox mirror', () => {
    store.addPin({ text: 'a', url: 'https://x/' }, null) // nudge_1 → inbox/nudge_1.md
    store.addPin({ text: 'b', url: 'https://x/' }, null) // nudge_2 → inbox/nudge_2.md
    // valid JSON, WRONG shape (the class of bug that once crash-looped the bridge)
    fs.writeFileSync(storeFile(), JSON.stringify({ pins: 'not an array', seq: 'x' }))
    bumpMtime(storeFile())
    // seq floored from the inbox (max nudge_2) → never reuses 1 or 2
    expect(store.addPin({ text: 'c', url: 'https://x/' }, null).id).toBe('nudge_3')
    // the unusable store was preserved, not silently wiped
    expect(fs.readdirSync(STORE).some(f => f.startsWith('store.json.corrupt-'))).toBe(true)
  })
})

describe('store.mjs — sanitizing + projections', () => {
  it('keeps multi-element targets only for 2+ elements and caps the count at 12', () => {
    expect(store.addPin({ text: 't', url: 'https://x/', targets: [{ selector: '.a' }] }, null).targets).toBeNull()
    const many = store.addPin(
      { text: 't', url: 'https://x/', targets: Array.from({ length: 20 }, (_, i) => ({ selector: `.s${i}` })) },
      null,
    )
    expect(many.targets).toHaveLength(12)
  })

  it('projects a speaking mark label and a client view that passes owner through', () => {
    const pin = store.addPin(
      { text: '', url: 'https://x/y', target: { selector: '.btn', innerText: 'Save' } },
      { label: 'Gerald S.', session: 's' },
    )
    expect(store.markLabel(pin)).toBe('Mark: “Save”')
    const view = store.pinForClient(pin)
    expect(view.owner).toEqual({ label: 'Gerald S.', session: 's' })
    expect(view.target.selector).toBe('.btn')
  })
})
