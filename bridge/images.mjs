// Image admission for browser evidence. PNG is completely inflated and its
// scanline filters reconstructed; JPEG overview admission is STRUCTURAL ONLY,
// not entropy decoding. Callers must not describe a JPEG as decoded PNG proof.
import { inflateSync } from 'node:zlib'

const MAX_INPUT = 8 * 1024 * 1024
const MAX_OUTPUT = 64 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}
const paeth = (left, up, upperLeft) => {
  const p = left + up - upperLeft
  const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft)
  return a <= b && a <= c ? left : b <= c ? up : upperLeft
}

function png(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8, header = null, palette = null, transparency = false
  let sawData = false, dataEnded = false, complete = false
  const compressed = []
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length) return null
    const name = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(name)) return null
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return null
    const data = bytes.subarray(offset + 8, end - 4)
    if (!header && name !== 'IHDR') return null
    if (name === 'IHDR') {
      if (header || length !== 13) return null
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4)
      const depth = data[8], colour = data[9]
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width > 32768 || height > 32768 || width * height * 4 > MAX_OUTPUT || !depths[colour]?.includes(depth)) return null
      // Browser screenshot output is noninterlaced. Reject Adam7 explicitly;
      // accepting compressed bytes without decoding its passes would be false proof.
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null
      header = { width, height, depth, colour, channels: ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colour] }
    } else if (name === 'PLTE') {
      if (palette || sawData || !length || length % 3 || length > 768 || [0, 4].includes(header.colour)) return null
      palette = length / 3
      if (header.colour === 3 && palette > 2 ** header.depth) return null
    } else if (name === 'tRNS') {
      if (transparency || sawData) return null
      if (header.colour === 0 && (length !== 2 || data.readUInt16BE(0) >= 2 ** header.depth)) return null
      if (header.colour === 2 && (length !== 6 || [0, 2, 4].some(i => data.readUInt16BE(i) >= 2 ** header.depth))) return null
      if (header.colour === 3 && (!palette || !length || length > palette)) return null
      if (![0, 2, 3].includes(header.colour)) return null
      transparency = true
    } else if (name === 'IDAT') {
      if (dataEnded || (header.colour === 3 && !palette)) return null
      sawData = true
      compressed.push(data)
    } else if (name === 'IEND') {
      if (length || !sawData || end !== bytes.length) return null
      complete = true
    } else if (!(bytes[offset + 4] & 32)) return null // unknown critical chunk
    if (sawData && name !== 'IDAT') dataEnded = true
    offset = end
  }
  if (!complete) return null
  const { width, height, depth, channels, colour } = header
  const rowBytes = Math.ceil(width * depth * channels / 8), stride = rowBytes + 1
  const expected = stride * height
  if (expected > MAX_OUTPUT) return null
  const input = Buffer.concat(compressed)
  // Enforce decompression bounds while inflating, not after allocating output.
  const inflated = inflateSync(input, { maxOutputLength: expected, info: true })
  if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== input.length) return null
  const raw = inflated.buffer, bpp = Math.max(1, Math.ceil(depth * channels / 8))
  for (let row = 0; row < height; row++) {
    const start = row * stride + 1, filter = raw[start - 1]
    if (filter > 4) return null
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bpp ? raw[start + x - bpp] : 0
      const up = row ? raw[start + x - stride] : 0
      const upperLeft = row && x >= bpp ? raw[start + x - stride - bpp] : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft)
      raw[start + x] = (raw[start + x] + predictor) & 255
    }
    if (colour === 3) {
      const mask = (1 << depth) - 1
      for (let x = 0; x < width; x++) {
        const bit = x * depth
        const index = (raw[start + Math.floor(bit / 8)] >>> (8 - depth - bit % 8)) & mask
        if (index >= palette) return null
      }
    }
  }
  return { width, height, validation: 'decoded' }
}

function jpeg(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null
  let offset = 2, frame = null, scans = 0, quantization = false, huffman = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return null
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) return frame && scans && quantization && huffman && offset === bytes.length
      ? { ...frame, validation: 'structure-only' } : null
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset), end = offset + length
    if (length < 2 || end > bytes.length) return null
    const data = bytes.subarray(offset + 2, end)
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || data.length < 6 || data[0] !== 8) return null
      const height = data.readUInt16BE(1), width = data.readUInt16BE(3), count = data[5]
      if (!height || !width || width * height * 4 > MAX_OUTPUT || ![1, 3, 4].includes(count) || data.length !== 6 + count * 3) return null
      frame = { width, height }
    } else if (marker === 0xdb) {
      if (!data.length) return null
      for (let p = 0; p < data.length;) {
        const descriptor = data[p++]
        if ((descriptor >> 4) > 1 || (descriptor & 15) > 3) return null
        p += 64 * ((descriptor >> 4) + 1)
        if (p > data.length) return null
      }
      quantization = true
    } else if (marker === 0xc4) {
      if (!data.length) return null
      for (let p = 0; p < data.length;) {
        if (p + 17 > data.length || (data[p] >> 4) > 1 || (data[p] & 15) > 3) return null
        const count = data.subarray(p + 1, p + 17).reduce((sum, n) => sum + n, 0)
        if (!count || count > 256) return null
        p += 17 + count
        if (p > data.length) return null
      }
      huffman = true
    } else if (marker === 0xda) {
      if (!frame || data.length < 6 || !data[0] || data[0] > 4 || data.length !== 4 + 2 * data[0]) return null
      scans++
      offset = end
      const start = offset
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue }
        if (bytes[offset + 1] === 0 || (bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7)) { offset += 2; continue }
        break
      }
      if (offset === start) return null
      continue
    } else if (marker === 0xdd) { if (data.length !== 2) return null }
    else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) return null
    offset = end
  }
  return null
}

export function validateImage(dataUrl) {
  try {
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_INPUT * 4 / 3 + 40) return null
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/)
    if (!match) return null
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.length > MAX_INPUT || bytes.toString('base64') !== match[2]) return null
    const metadata = match[1] === 'png' ? png(bytes) : jpeg(bytes)
    return metadata ? { type: match[1], bytes, ...metadata } : null
  } catch { return null }
}
