import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-selection-unit-'))
process.env.NUDGE_STORE = STORE
const store = await import('../../bridge/store.mjs')
const source = { browser: 'safari', session: 'session1', tab: 'tab1', document: 'document1' }
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg=='
const full = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z'
const marked = extra => ({ url: 'http://localhost:5322/route?query=1#hash', browserSource: source, selectionGeneration: 'generation1', target: { selector: '#first' }, keepShot: false, ...extra })
const selectionFile = path.join(STORE, 'selection.json')
const bytes = () => {
  const result = {}
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else result[path.relative(STORE, file)] = fs.readFileSync(file).toString('base64')
    }
  }
  walk(STORE)
  return result
}
beforeEach(() => {
  for (const entry of fs.readdirSync(STORE)) fs.rmSync(path.join(STORE, entry), { recursive: true, force: true })
})
afterAll(() => fs.rmSync(STORE, { recursive: true, force: true }))

describe('source and generation bound current selection', () => {
  it('publishes a fresh data-only mark, then accepts its matching asynchronous image', () => {
    const first = store.setSelection(marked())
    expect(first.screenshot).toBeUndefined()
    const next = store.setSelection(marked({ keepShot: true, screenshot: image, screenshotFull: full }))
    expect(next).toMatchObject({ browserSource: source, selectionGeneration: 'generation1', screenshot: 'shots/selection.png', screenshotFull: 'shots/selection_full.jpg' })
    expect(fs.readFileSync(path.join(STORE, next.screenshot))).toEqual(Buffer.from(image.split(',')[1], 'base64'))
  })
  it('can create a new mark with pixels in a single initial publication', () => {
    expect(store.setSelection(marked({ screenshot: image })).screenshot).toBe('shots/selection.png')
  })
  it('inherits images on ancestor retarget only for the same mark and route, excluding query', () => {
    store.setSelection(marked({ screenshot: image, screenshotFull: full }))
    const next = store.setSelection(marked({ keepShot: true, target: { selector: '#parent' }, url: 'http://localhost:5322/route?query=2#hash' }))
    expect(next).toMatchObject({ selector: '#parent', screenshot: 'shots/selection.png', screenshotFull: 'shots/selection_full.jpg' })
  })
  it.each([
    { selectionGeneration: 'generation2' },
    { browserSource: { ...source, browser: 'chromium' } },
    { browserSource: { ...source, session: 'session2' } },
    { browserSource: { ...source, tab: 'tab2' } },
    { browserSource: { ...source, document: 'document2' } },
    { url: 'http://127.0.0.1:5322/route?query=1#hash' },
    { url: 'http://localhost:5323/route?query=1#hash' },
    { url: 'http://localhost:5322/other?query=1#hash' },
    { url: 'http://localhost:5322/route?query=1#other' },
  ])('rejects a late/mismatched image without touching selection or image bytes: %j', change => {
    store.setSelection(marked({ screenshot: image, screenshotFull: full }))
    const before = bytes()
    const writes = vi.spyOn(fs, 'writeFileSync')
    try {
      expect(store.setSelection(marked({ ...change, keepShot: true, screenshot: 'data:image/png;base64,Ag==' }))).toEqual({ error: 'selection_conflict' })
      expect(writes).not.toHaveBeenCalled()
      expect(bytes()).toEqual(before)
    } finally { writes.mockRestore() }
  })
  it('rejects an older mark image after a new generation becomes current', () => {
    store.setSelection(marked({ screenshot: image }))
    const latest = marked({ selectionGeneration: 'generation2', target: { selector: '#second' } })
    store.setSelection(latest)
    expect(store.getSelection().screenshot).toBeUndefined()
    const before = bytes()
    expect(store.setSelection(marked({ keepShot: true, screenshot: full }))).toEqual({ error: 'selection_conflict' })
    expect(store.getSelection().selector).toBe('#second')
    expect(bytes()).toEqual(before)
    expect(store.setSelection({ ...latest, keepShot: true, screenshot: image }).screenshot).toBe('shots/selection.png')
  })
  it('requires an initial publication before accepting a modern asynchronous image', () => {
    expect(store.setSelection(marked({ keepShot: true, screenshot: image }))).toEqual({ error: 'selection_conflict' })
    expect(bytes()).toEqual({})
  })
  it('rejects source/generation omissions and invalid bounded tokens without mutation', () => {
    const cases = [
      { browserSource: null }, { selectionGeneration: null }, { selectionGeneration: 12 },
      { selectionGeneration: 'x'.repeat(129) }, { selectionGeneration: 'bad token' },
      { browserSource: { ...source, tab: 'x'.repeat(129) } },
      { browserSource: { ...source, browser: 'x'.repeat(33) } },
      { url: 'not a URL' }, { url: 'http://localhost/' + 'x'.repeat(2000) },
    ]
    for (const change of cases) expect(store.setSelection(marked(change))).toEqual({ error: 'selection_conflict' })
    expect(bytes()).toEqual({})
  })
  it('validates both image inputs before writing either file', () => {
    store.setSelection(marked({ screenshot: image }))
    const before = bytes()
    for (const invalid of ['not-an-image', 'data:image/png;base64,', 'data:image/png;base64,%%%', 42]) {
      expect(store.setSelection(marked({ keepShot: true, screenshot: full, screenshotFull: invalid }))).toEqual({ error: 'invalid_selection_image' })
      expect(bytes()).toEqual(before)
    }
  })
  it('retains legacy same-route inheritance but never inherits a source-aware mark', () => {
    const legacy = { url: 'http://localhost:5322/route', selector: '#legacy', screenshot: image, keepShot: false }
    store.setSelection(legacy)
    expect(store.setSelection({ url: legacy.url, selector: '#parent' }).screenshot).toBe('shots/selection.png')
    expect(store.setSelection({ url: 'http://localhost:5322/other', selector: '#other' }).screenshot).toBeUndefined()
    store.setSelection(marked({ screenshot: image }))
    const before = bytes()
    expect(store.setSelection({ url: marked().url, selector: '#legacy-update', keepShot: true })).toEqual({ error: 'selection_conflict' })
    expect(bytes()).toEqual(before)
    const fresh = store.setSelection({ url: marked().url, selector: '#legacy-new', keepShot: false })
    expect(fresh.browserSource).toBeNull()
    expect(fresh.selectionGeneration).toBeNull()
    expect(fresh.screenshot).toBeUndefined()
  })
  it('does not inherit legacy images when a modern mark begins', () => {
    store.setSelection({ url: marked().url, screenshot: image, keepShot: false })
    expect(store.setSelection(marked()).screenshot).toBeUndefined()
  })
  it('caps string, target, style and finite geometry fields', () => {
    const selection = store.setSelection(marked({
      title: 'x'.repeat(600), target: { selector: 's'.repeat(600), source: 's'.repeat(600), xpath: 'x'.repeat(600), innerText: 't'.repeat(600), outerHTML: 'h'.repeat(1400), styles: { oversized: 's'.repeat(21000) }, rect: { x: 1, y: NaN, w: Infinity } },
      viewport: { w: 800, h: 'bad', dpr: 2 },
    }))
    expect(selection.title).toHaveLength(300)
    expect(selection.selector).toHaveLength(500)
    expect(selection.source).toHaveLength(500)
    expect(selection.xpath).toHaveLength(500)
    expect(selection.innerText).toHaveLength(300)
    expect(selection.outerHTML).toHaveLength(1200)
    expect(selection.styles).toBeNull()
    expect(selection.rect).toEqual({ x: 1 })
    expect(selection.viewport).toEqual({ w: 800, dpr: 2 })
  })
  it('treats malformed persisted selection shapes as absent without rewriting them', () => {
    for (const value of [null, [], 12, 'bad']) {
      fs.writeFileSync(selectionFile, JSON.stringify(value))
      expect(store.getSelection()).toBeNull()
      expect(JSON.parse(fs.readFileSync(selectionFile, 'utf8'))).toEqual(value)
    }
  })
})
