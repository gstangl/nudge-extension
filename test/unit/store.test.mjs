import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

// store.mjs freezes STORE_DIR from NUDGE_STORE at import time (store.mjs:21).
// Set it BEFORE the module loads, and use a dynamic import so the env is in
// place when the top-level const is evaluated.
const STORE = path.join(os.tmpdir(), `nudge-store-unit-${process.pid}`)
process.env.NUDGE_STORE = STORE
const store = await import('../../bridge/store.mjs')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg=='
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWL6z8DwHwAAAP//A3ONEwAAAAZJREFUAwAFCgIByRpMngAAAABJRU5ErkJggg=='

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

describe('store.mjs — nudge lifecycle', () => {
  it('rejects coerced non-string submission metadata before mutation', () => {
    const at=new Date().toISOString()
    for(const submissionId of [12345678,['token_1234'],{},true])
      expect(store.submitPin({submissionId,submissionCreatedAt:at},null).error).toBe('invalid_submission_id')
    for(const submissionCreatedAt of [[at],Date.now(),{},true,'x'.repeat(41)])
      expect(store.submitPin({submissionId:'typed_submission',submissionCreatedAt},null).error).toBe('invalid_submission_time')
    expect(fs.existsSync(storeFile())).toBe(false)
  })
  it('does not acknowledge uncommitted cache state after a failed store rename', () => {
    const payload={text:'disk failure',submissionId:'failed_rename_retry',submissionCreatedAt:new Date().toISOString()}
    const original=fs.renameSync
    const rename=vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(to===storeFile())throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return original(from,to)})
    try { expect(()=>store.submitPin(payload,null)).toThrow('disk full') } finally {rename.mockRestore()}
    expect(fs.existsSync(storeFile())).toBe(false)
    const result=store.submitPin(payload,null)
    expect(result.replay).toBe(false)
    expect(JSON.parse(fs.readFileSync(storeFile(),'utf8')).pins[0].id).toBe(result.id)
    expect(store.submitPin(payload,null).replay).toBe(true)
  })
  it('preserves exact legacy 0.18 receipt replay without weakening new signatures', () => {
    const payload={text:'old',url:'http://localhost/route',submissionId:'legacy_receipt_retry',submissionCreatedAt:new Date().toISOString()}
    const created=store.submitPin(payload,null)
    const saved=JSON.parse(fs.readFileSync(storeFile(),'utf8'))
    saved.receipts[0].signature=crypto.createHash('sha256').update(JSON.stringify({text:payload.text,url:payload.url,author:'',target:null,targets:null,browserSource:null,submissionCreatedAt:payload.submissionCreatedAt})).digest('hex')
    delete saved.receipts[0].signatureVersion
    fs.writeFileSync(storeFile(),JSON.stringify(saved));bumpMtime(storeFile())
    expect(store.submitPin(payload,null)).toMatchObject({id:created.id,replay:true})
    expect(store.submitPin({...payload,text:'changed'},null).error).toBe('submission_conflict')
    expect(store.getPins()).toHaveLength(1)
  })
  it('retains receipts through the retry horizon, then rejects a delayed withdrawn submission after expiry', () => {
    const now = Date.now()
    const payload = {text:'withdraw me', submissionId:'expiry_submission', submissionCreatedAt:new Date(now).toISOString()}
    const result = store.submitPin(payload,null,now)
    store.deletePin(result.id)
    const expires = now + 7 * 24 * 3600e3 + 5 * 60_000
    expect(store.pruneReceipts(expires)).toBe(0)
    expect(store.pruneReceipts(expires + 1)).toBe(1)
    expect(JSON.parse(fs.readFileSync(storeFile(),'utf8')).receipts).toEqual([])
    expect(store.submitPin(payload,null,expires+1).error).toBe('invalid_submission_time')
    expect(store.getPins()).toEqual([])
  })
  it('persists a submission and its receipt in one atomic store rename', () => {
    const rename = vi.spyOn(fs, 'renameSync')
    try {
      const payload = { text: 'once', submissionId: 'atomic_submission', submissionCreatedAt: new Date().toISOString() }
      const result = store.submitPin(payload, null)
      expect(rename.mock.calls.filter(([, to]) => to === storeFile())).toHaveLength(1)
      const saved = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
      expect(saved.pins[0].submissionId).toBe(payload.submissionId)
      expect(saved.receipts[0].id).toBe(result.id)
      expect(store.submitPin(payload, null).id).toBe(result.id)
      expect(store.getPins()).toHaveLength(1)
    } finally { rename.mockRestore() }
  })

  it('does not deduplicate changed screenshot or console evidence as identical content', () => {
    const payload = { text: 'once', submissionId: 'evidence_submission', submissionCreatedAt: new Date().toISOString(), screenshot: PNG }
    store.submitPin(payload, null)
    expect(store.submitPin({...payload, screenshot:RED_PNG}, null).error).toBe('submission_conflict')
    expect(store.submitPin({...payload, console:['changed']}, null).error).toBe('submission_conflict')
  })

  it.each(['nudge', 'pin'])('replays identical historical %s after-images without inventing provenance or rewriting', prefix => {
    const pin=store.addPin({text:'legacy proof',screenshot:PNG},null)
    store.resolvePin(pin.id,null)
    expect(store.attachAfterShot(pin.id,RED_PNG).duplicate).toBe(false)
    const saved=JSON.parse(fs.readFileSync(storeFile(),'utf8'))
    delete saved.pins[0].afterImageHash
    if(prefix==='pin') {
      saved.pins[0].id='pin_1'
      saved.pins[0].screenshotAfter='shots/pin_1_after.png'
      fs.renameSync(path.join(STORE,pin.screenshotAfter),path.join(STORE,saved.pins[0].screenshotAfter))
      pin.id=saved.pins[0].id;pin.screenshotAfter=saved.pins[0].screenshotAfter
    }
    fs.writeFileSync(storeFile(),JSON.stringify(saved));bumpMtime(storeFile())
    const before=fs.readFileSync(storeFile(),'utf8')
    expect(store.attachAfterShot(pin.id,RED_PNG)).toMatchObject({duplicate:true})
    expect(store.attachAfterShot(pin.id,PNG).error).toBe('evidence_conflict')
    expect(store.getPin(pin.id).afterBrowserSource).toBeUndefined()
    expect(store.getPin(pin.id).afterImageHash).toBeUndefined()
    expect(fs.readFileSync(storeFile(),'utf8')).toBe(before)
    fs.unlinkSync(path.join(STORE,pin.screenshotAfter))
    expect(store.attachAfterShot(pin.id,RED_PNG).error).toBe('evidence_conflict')
  })
  it('only accepts a successor with explicitly vouched original provenance', () => {
    const source = {browser:'safari',session:'session1',tab:'tab1',document:'document1'}
    const next = {...source,document:'document2'}
    const pin = store.addPin({text:'proof',browserSource:source,screenshot:PNG},null)
    store.resolvePin(pin.id,null)
    const image = RED_PNG
    expect(store.attachAfterShot(pin.id,image,{browserSource:next}).error).toBe('provenance_conflict')
    const provenance = {browserSource:next,expectedBrowserSource:source}
    expect(store.attachAfterShot(pin.id,image,provenance).duplicate).toBe(false)
    expect(store.attachAfterShot(pin.id,image,provenance).duplicate).toBe(true)
    expect(store.attachAfterShot(pin.id,PNG,provenance).error).toBe('evidence_conflict')
    expect(store.attachAfterShot(pin.id,image,{browserSource:{...source,tab:'foreign'}}).error).toBe('provenance_conflict')
  })
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

  it('advances seq past any existing nudge number so a hand-edited store cannot cause id reuse', () => {
    store.addPin({ text: 'a', url: 'https://x/' }, null) // nudge_1
    fs.writeFileSync(storeFile(), JSON.stringify({
      seq: 1,
      pins: [{ id: 'nudge_50', status: 'open', createdAt: new Date().toISOString(), text: 'hand', url: 'u' }],
    }))
    bumpMtime(storeFile())
    // Math.max(seq, max-existing-id) + 1 → past nudge_50, not seq+1
    expect(store.addPin({ text: 'b', url: 'https://x/' }, null).id).toBe('nudge_51')
  })

  it('prunes old resolved nudges but never open ones', () => {
    const open = store.addPin({ text: 'open', url: 'https://x/' }, null)
    const done = store.addPin({ text: 'done', url: 'https://x/' }, null)
    store.resolvePin(done.id, null)
    // age the resolved nudge far past the 7-day window
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
      { label: 'Real Owner', session: 'sess-1' },
    )
    expect(pin.owner).toEqual({ label: 'Real Owner', session: 'sess-1' })
  })

  it('caps owner label to 60 and session to 128', () => {
    const pin = store.addPin({ text: 't', url: 'https://x/' }, { label: 'L'.repeat(100), session: 'S'.repeat(200) })
    expect(pin.owner.label).toHaveLength(60)
    expect(pin.owner.session).toHaveLength(128)
  })

  it('keeps an owned nudge immutable on resolve, but attributes the resolver when the nudge was unowned', () => {
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
      { label: 'Real Owner', session: 's' },
    )
    expect(store.markLabel(pin)).toBe('Mark: “Save”')
    const view = store.pinForClient(pin)
    expect(view.owner).toEqual({ label: 'Real Owner', session: 's' })
    expect(view.target.selector).toBe('.btn')
  })
})

// The id counts up forever (identity: filenames, dedup, commits); the LABEL is
// the number on the pill and may wrap, because it only has to be unique among
// the handful of OPEN nudges. These two must never be conflated again.
describe('store.mjs — display label vs id', () => {
  it('wraps the label into 1..999 while the id keeps counting', () => {
    expect(store.labelOf('nudge_1')).toBe(1)
    expect(store.labelOf('nudge_999')).toBe(999)
    expect(store.labelOf('nudge_1000')).toBe(1) // wrap point — never 0
    expect(store.labelOf('nudge_1998')).toBe(999)
    expect(store.labelOf('nudge_1999')).toBe(1)
  })

  it('reads the legacy pin_ prefix and refuses to guess at a junk id', () => {
    expect(store.labelOf('pin_5')).toBe(5)
    expect(store.labelOf('bogus')).toBe(0)
    expect(store.labelOf('nudge_0')).toBe(0)
  })

  it('never lets two nudges within one pool share a label', () => {
    const seen = new Set()
    for (let n = 1; n <= 999; n++) seen.add(store.labelOf(`nudge_${n}`))
    expect(seen.size).toBe(999) // a full cycle is a bijection: no collision before the wrap
  })

  it('ships the label alongside the id in every consumer projection', () => {
    const pin = store.addPin({ text: 'hi', url: 'https://x/y' }, null)
    expect(store.pinForClient(pin).label).toBe(store.labelOf(pin.id))
    expect(store.pinSummary(pin).label).toBe(store.labelOf(pin.id))
    // the agent-facing line carries BOTH — the id is what it must open on disk
    expect(store.pinLine(pin)).toContain(pin.id)
    expect(store.pinLine(pin)).toContain(`#${store.labelOf(pin.id)}`)
  })

  it('writes both numbers into the inbox mirror heading', () => {
    const pin = store.addPin({ text: 'mirror', url: 'https://x/y' }, null)
    const md = fs.readFileSync(path.join(STORE, 'inbox', `${pin.id}.md`), 'utf8')
    expect(md.split('\n')[0]).toBe(`# ${pin.id} (#${store.labelOf(pin.id)}) - open`)
  })
})
