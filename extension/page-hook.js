// MAIN-world hook (document_start): ring buffer of the page's recent console
// errors/warnings + uncaught errors + network failures. The isolated-world
// content script requests it via CustomEvents right before sending a nudge.
//
// KNOWN TRADE-OFF: because this wraps console.error/warn, Chrome attributes
// every page warning/error passing through to the extension - they show up on
// chrome://extensions -> Errors (dev-mode error collection only). Cosmetic;
// the alternative (inline page injection) is blocked by CSP on many setups.
;(() => {
  if (window.top !== window) return
  const buf = []
  const fmt = (a) => {
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }
  const push = (kind, args) => {
    buf.push(`[${kind}] ${args.map(fmt).join(' ')}`.slice(0, 400))
    if (buf.length > 20) buf.shift()
  }
  const origError = console.error, origWarn = console.warn
  console.error = (...a) => { push('error', a); origError.apply(console, a) }
  console.warn = (...a) => { push('warn', a); origWarn.apply(console, a) }
  addEventListener('error', (e) => push('uncaught', [`${e.message} @ ${e.filename}:${e.lineno}`]))
  addEventListener('unhandledrejection', (e) => push('unhandledrejection', [String(e.reason)]))

  // network failures: fetch + XHR with status >= 400 or thrown errors
  const reqInfo = (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url || String(input))
    const method = (init?.method || input?.method || 'GET').toUpperCase()
    return `${method} ${url}`
  }
  const origFetch = window.fetch
  window.fetch = async function (input, init) {
    try {
      const res = await origFetch.call(this, input, init)
      if (res.status >= 400) push('net', [`${reqInfo(input, init)} -> ${res.status}`])
      return res
    } catch (err) {
      push('net', [`${reqInfo(input, init)} -> ${err}`])
      throw err
    }
  }
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('loadend', () => {
      if (this.status >= 400 || this.status === 0) push('net', [`${String(method).toUpperCase()} ${url} -> ${this.status || 'failed'}`])
    })
    return origOpen.call(this, method, url, ...rest)
  }
  addEventListener('groundworks-nudge-console-req', () => {
    dispatchEvent(new CustomEvent('groundworks-nudge-console-res', { detail: JSON.stringify(buf) }))
  })
})()
