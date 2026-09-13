import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { validateImage } from '../../bridge/images.mjs'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}
function png({ width = 1, height = 1, depth = 8, colour = 6, interlace = 0, raw = Buffer.from([0, 20, 180, 90, 255]), compressed, before = [], after = [] } = {}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4)
  header[8] = depth; header[9] = colour; header[12] = interlace
  return Buffer.concat([signature, chunk('IHDR', header), ...before, chunk('IDAT', compressed || deflateSync(raw)), ...after, chunk('IEND')])
}
const url = (bytes, type = 'png') => `data:image/${type};base64,${bytes.toString('base64')}`
// A real one-pixel JPEG emitted by Chromium canvas; no synthetic entropy stream.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z'

describe('actual image admission', () => {
  it('fully decodes a valid PNG and returns its exact original bytes', () => {
    const bytes = png()
    expect(validateImage(url(bytes))).toEqual({ type: 'png', bytes, width: 1, height: 1, validation: 'decoded' })
  })
  it.each([0, 1, 2, 3, 4])('reconstructs PNG filter %i', filter => {
    const raw = Buffer.from([filter, 20, 180, 90, 255, filter, 20, 180, 90, 255])
    expect(validateImage(url(png({ height: 2, raw })))?.validation).toBe('decoded')
  })
  it.each([
    { colour: 0, depth: 1, raw: Buffer.from([0, 128]) },
    { colour: 0, depth: 8, raw: Buffer.from([0, 20]) },
    { colour: 0, depth: 16, raw: Buffer.from([0, 20, 0]) },
    { colour: 2, depth: 8, raw: Buffer.from([0, 20, 180, 90]) },
    { colour: 2, depth: 16, raw: Buffer.from([0, 20, 0, 180, 0, 90, 0]) },
    { colour: 4, depth: 8, raw: Buffer.from([0, 20, 255]) },
    { colour: 6, depth: 16, raw: Buffer.from([0, 20, 0, 180, 0, 90, 0, 255, 255]) },
  ])('validates standard noninterlaced sample format %j', format => {
    expect(validateImage(url(png(format)))?.validation).toBe('decoded')
  })
  it('checks decoded palette indices, including packed low-bit-depth samples', () => {
    const before = [chunk('PLTE', Buffer.from([20, 180, 90]))]
    expect(validateImage(url(png({ colour: 3, depth: 1, before, raw: Buffer.from([0, 0]) })))?.validation).toBe('decoded')
    expect(validateImage(url(png({ colour: 3, depth: 1, before, raw: Buffer.from([0, 128]) })))).toBeNull()
    expect(validateImage(url(png({ colour: 3, raw: Buffer.from([0, 0]) })))).toBeNull()
  })
  it('rejects malformed, noncanonical, empty and signature-only base64', () => {
    for (const value of [null, '', 'data:image/png;base64,', 'data:image/png;base64,AA==', 'data:image/png;base64,AB==', 'data:image/png;base64,%%%=', url(signature), url(png()).replace('==', '=')]) {
      expect(validateImage(value)).toBeNull()
    }
  })
  it('rejects every truncation of a valid PNG and trailing bytes', () => {
    const bytes = png()
    for (let length = 0; length < bytes.length; length++) expect(validateImage(url(bytes.subarray(0, length)))).toBeNull()
    expect(validateImage(url(Buffer.concat([bytes, Buffer.from([0])])))).toBeNull()
  })
  it('rejects corrupt chunk CRC and compressed streams even when container CRC is correct', () => {
    const corrupt = png(); corrupt[corrupt.length - 1] ^= 1
    expect(validateImage(url(corrupt))).toBeNull()
    const compressed = deflateSync(Buffer.from([0, 20, 180, 90, 255])); compressed[compressed.length - 1] ^= 1
    expect(validateImage(url(png({ compressed })))).toBeNull()
    expect(validateImage(url(png({ compressed: Buffer.from([1, 2, 3]) })))).toBeNull()
  })
  it('rejects wrong decoded lengths, invalid filters and extra compressed members', () => {
    for (const raw of [Buffer.from([0]), Buffer.from([0, 20, 180, 90, 255, 0]), Buffer.from([5, 20, 180, 90, 255])]) expect(validateImage(url(png({ raw })))).toBeNull()
    const compressed = Buffer.concat([deflateSync(Buffer.from([0, 20, 180, 90, 255])), deflateSync(Buffer.from([0]))])
    expect(validateImage(url(png({ compressed })))).toBeNull()
  })
  it('rejects chunk-order errors, unknown critical chunks, unsupported interlace and oversized output', () => {
    expect(validateImage(url(png({ before: [chunk('ABCD')] })))).toBeNull()
    expect(validateImage(url(png({ after: [chunk('tEXt'), chunk('IDAT', deflateSync(Buffer.from([0])))] })))).toBeNull()
    expect(validateImage(url(png({ interlace: 1 })))).toBeNull()
    expect(validateImage(url(png({ width: 32768, height: 32768 })))).toBeNull()
    expect(validateImage(url(png({ width: 0 })))).toBeNull()
    expect(validateImage(url(png({ raw: Buffer.alloc(1024 * 1024) })))).toBeNull()
  })
  it('accepts a real browser JPEG only with an explicit structural-validation label', () => {
    expect(validateImage(JPEG)).toMatchObject({ type: 'jpeg', width: 1, height: 1, validation: 'structure-only' })
  })
  it('rejects JPEG truncation, signatures alone, corrupt segment length and trailing garbage', () => {
    const bytes = Buffer.from(JPEG.split(',')[1], 'base64')
    for (let length = 0; length < bytes.length; length++) expect(validateImage(url(bytes.subarray(0, length), 'jpeg'))).toBeNull()
    expect(validateImage(url(Buffer.from([255, 216, 255, 217]), 'jpeg'))).toBeNull()
    const corrupt = Buffer.from(bytes); corrupt.writeUInt16BE(65535, 4)
    expect(validateImage(url(corrupt, 'jpeg'))).toBeNull()
    expect(validateImage(url(Buffer.concat([bytes, Buffer.from([0])]), 'jpeg'))).toBeNull()
  })
  it('does not confuse the declared MIME with the file format', () => {
    expect(validateImage(url(png(), 'jpeg'))).toBeNull()
    expect(validateImage(JPEG.replace('image/jpeg', 'image/png'))).toBeNull()
  })
})
