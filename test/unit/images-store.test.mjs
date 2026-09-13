import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-image-store-'))
process.env.NUDGE_STORE = directory
const store = await import('../../bridge/store.mjs')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg=='
const CORRUPT = PNG.slice(0, -8) + 'AAAAAAAA'
beforeEach(() => {
  for (const name of fs.readdirSync(directory)) fs.rmSync(path.join(directory, name), { recursive: true, force: true })
})
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

describe('image admission at store evidence boundary', () => {
  it('rejects malformed supplied modern images before allocating a pin or durable receipt', () => {
    const payload={text:'keep my image',submissionId:'bad_image_submission',submissionCreatedAt:new Date().toISOString()}
    for (const images of [{screenshot:'data:image/png;base64,AA=='},{screenshot:PNG,screenshotFull:'data:image/jpeg;base64,/9j/2Q=='}]) {
      expect(store.submitPin({...payload,...images},null)).toEqual({error:'invalid_submission_image'})
      expect(fs.existsSync(path.join(directory,'store.json'))).toBe(false)
      expect(fs.existsSync(path.join(directory,'shots'))).toBe(false)
    }
    expect(store.submitPin({...payload,screenshot:PNG},null).id).toBe('nudge_1')
  })
  it('retains a legacy prompt but drops malformed before-images rather than asserting proof', () => {
    const pin = store.addPin({ text: 'legacy prompt', screenshot: 'data:image/png;base64,AA==', screenshotFull: 'data:image/jpeg;base64,/9j/2Q==' }, null)
    expect(pin.text).toBe('legacy prompt')
    expect(pin.screenshot).toBeNull()
    expect(pin.screenshotFull).toBeNull()
    expect(fs.existsSync(path.join(directory, 'shots'))).toBe(false)
    store.resolvePin(pin.id, null)
    expect(store.attachAfterShot(pin.id, PNG)).toEqual({ error: 'not_eligible' })
  })
  it('rejects corrupt/empty/header-only after-images before any file or cached proof mutation', () => {
    const pin = store.addPin({ text: 'proof', screenshot: PNG }, null)
    store.resolvePin(pin.id, null)
    const storedBefore = fs.readFileSync(path.join(directory, 'store.json'))
    const writes = vi.spyOn(fs, 'writeFileSync')
    try {
      for (const bad of [CORRUPT, 'data:image/png;base64,AA==', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,', 'data:image/jpeg;base64,/9j/2Q==']) {
        expect(store.attachAfterShot(pin.id, bad)).toEqual({ error: 'invalid_image' })
        expect(store.getPin(pin.id).screenshotAfter).toBeUndefined()
        expect(store.getPin(pin.id).afterImageHash).toBeUndefined()
        expect(fs.existsSync(path.join(directory, 'shots', pin.id + '_after.png'))).toBe(false)
      }
      expect(writes).not.toHaveBeenCalled()
      expect(fs.readFileSync(path.join(directory, 'store.json'))).toEqual(storedBefore)
    } finally { writes.mockRestore() }
  })
  it('never lets a corrupt retry overwrite an accepted decoded PNG or its cached hash', () => {
    const pin = store.addPin({ text: 'proof', screenshot: PNG }, null)
    store.resolvePin(pin.id, null)
    expect(store.attachAfterShot(pin.id, PNG).duplicate).toBe(false)
    const after = fs.readFileSync(path.join(directory, pin.screenshotAfter))
    const hash = pin.afterImageHash
    expect(store.attachAfterShot(pin.id, CORRUPT)).toEqual({ error: 'invalid_image' })
    expect(fs.readFileSync(path.join(directory, pin.screenshotAfter))).toEqual(after)
    expect(store.getPin(pin.id).afterImageHash).toBe(hash)
    expect(store.attachAfterShot(pin.id, PNG).duplicate).toBe(true)
  })
})
