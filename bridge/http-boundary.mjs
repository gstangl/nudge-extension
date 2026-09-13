// Shared HTTP and WebSocket admission. Loopback binding does not make a
// foreign DNS name safe: same-origin requests may omit Origin entirely.
export const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function admissionError(req) {
  const hosts = (req.rawHeaders || []).filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host')
  const host = req.headers.host
  const match = typeof host === 'string' && /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(host)
  if (hosts.length !== 1 || !match || (match[2] && (+match[2] < 1 || +match[2] > 65535))) return 'foreign or malformed host rejected'
  // This is an origin server, never an HTTP proxy. Reject absolute/network-path
  // targets before URL normalization can hide their authority or backslashes.
  if (!/^\/(?!\/)/.test(req.url || '') || /[\\#]/.test(req.url)) return 'invalid request target'
  const origin = req.headers.origin
  if (origin !== undefined && (typeof origin !== 'string' || !ORIGIN_OK.test(origin))) return 'foreign origin rejected'
  return null
}

// Buffer bytes until the complete request is available. Decoding each network
// chunk independently corrupts umlauts/emoji split across packet boundaries.
export function readJsonBody(req, res, maxBytes, json, onJson) {
  let chunks = [], size = 0, refused = false
  req.on('data', chunk => {
    if (refused) return
    size += chunk.length
    if (size > maxBytes) {
      refused = true; chunks = []
      json(res, 413, { error: 'body too large' })
      res.socket?.end()
    } else chunks.push(chunk)
  })
  req.on('end', () => {
    if (refused) return
    let value
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) }
    catch { return json(res, 400, { error: 'invalid JSON or UTF-8' }) }
    try { onJson(value) } catch (error) {
      if (!res.headersSent) json(res, 400, { error: String(error) })
    }
  })
}
