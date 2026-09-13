import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { admissionError, readJsonBody } from '../../bridge/http-boundary.mjs'

const request = (host, origin, url = '/comments') => ({
  url, headers: { host, ...(origin === undefined ? {} : { origin }) },
  rawHeaders: host === undefined ? [] : ['Host', host],
})

describe('loopback admission shared by HTTP and WebSocket', () => {
  it.each(['localhost', 'localhost:4700', '127.0.0.1:4799', 'LOCALHOST:4700'])('allows local tools and local pages on %s', host => {
    for (const origin of [undefined, 'http://localhost:4886', 'https://127.0.0.1:443']) expect(admissionError(request(host, origin))).toBeNull()
  })
  it.each([undefined, '', 'elsewhere.example', 'localhost.evil', 'localhost@evil', 'localhost:0', 'localhost:65536', 'localhost:abc', '127.1', '[::1]', 'localhost,localhost', 'localhost.'])('rejects missing/foreign/malformed Host %s without Origin', host => {
    expect(admissionError(request(host))).toBeTruthy()
  })
  it('rejects duplicate Host', () => {
    const req = request('localhost')
    req.rawHeaders.push('Host', 'elsewhere.example')
    expect(admissionError(req)).toBeTruthy()
  })
  it.each(['null', '', 'https://elsewhere.example', 'http://localhost.evil', 'http://localhost@evil', 'http://localhost, http://localhost'])('rejects Origin %s even on a valid Host', origin => {
    expect(admissionError(request('localhost:4700', origin))).toBeTruthy()
  })
  it.each(['http://elsewhere.example/comments', 'http://localhost:4700/comments', '//elsewhere.example/comments', '/\\elsewhere.example/comments', '/comments#fragment', '*'])('rejects proxy/ambiguous request target %s', url => {
    expect(admissionError(request('localhost:4700', undefined, url))).toBeTruthy()
  })
})

async function decode(chunks, limit = 4096) {
  const req = new PassThrough()
  const result = new Promise(resolve => readJsonBody(req, {}, limit,
    (_, status, value) => resolve({ status, value }), value => resolve({ status: 200, value })))
  for (const chunk of chunks) req.write(chunk)
  req.end()
  return result
}
describe('bounded UTF-8 request decoding', () => {
  it('preserves text and context at every possible byte split', async () => {
    const value = { text: 'Review: Größe 🙂', target: { innerText: 'Żółć 日本語 🌈' } }
    const body = Buffer.from(JSON.stringify(value))
    for (let i = 1; i < body.length; i++) expect(await decode([body.subarray(0, i), body.subarray(i)])).toEqual({ status: 200, value })
    expect(await decode([...body].map(byte => Buffer.from([byte])))).toEqual({ status: 200, value })
  })
  it('enforces bytes, not UTF-16 characters, with an exact inclusive limit', async () => {
    const body = Buffer.from(JSON.stringify({ text: '🙂'.repeat(100) }))
    expect((await decode([body], body.length)).status).toBe(200)
    expect((await decode([body], body.length - 1)).status).toBe(413)
  })
  it('rejects invalid/truncated UTF-8 and JSON instead of storing replacement text', async () => {
    for (const body of [Buffer.from([34, 0xc3, 34]), Buffer.from([34, 0xf0]), Buffer.from('{')]) expect((await decode([body])).status).toBe(400)
  })
})
