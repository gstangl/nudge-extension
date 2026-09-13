// One durable queue owner per extension installation. Loaded by importScripts;
// content scripts never mutate nudgeQueue or choose the bridge endpoint.
(() => {
  const KEY = 'nudgeQueue'
  const VERSION = 1
  const CAPACITY = 25
  const HORIZON = 7 * 24 * 60 * 60 * 1000
  const CLOCK_ALLOWANCE = 5 * 60 * 1000
  const clone = value => JSON.parse(JSON.stringify(value))
  const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  const problem = (code, message = code) => Object.assign(new Error(message), { code })

  function create({ storage, fetch: request = globalThis.fetch.bind(globalThis), endpoint,
    now = Date.now, uuid = () => crypto.randomUUID().replaceAll('-', '') }) {
    let tail = Promise.resolve()
    // A rejected mutation must not poison the owner for later requests.
    const serialize = work => {
      const operation = tail.then(work)
      tail = operation.catch(() => {})
      return operation
    }
    const write = async envelope => {
      try { await storage.set({ [KEY]: envelope }) }
      catch { throw problem('storage_unavailable', 'Queue storage failed — prompt kept') }
    }
    function ageReason(payload) {
      const at = Date.parse(payload?.submissionCreatedAt || '')
      if (!Number.isFinite(at)) return 'creation_time_unknown'
      if (at > now() + CLOCK_ALLOWANCE) return 'creation_time_future'
      if (at < now() - HORIZON) return 'retry_expired'
      return null
    }
    async function read() {
      const value = (await storage.get(KEY))[KEY]
      if (value === undefined) return { version: VERSION, entries: [] }
      if (value?.version === VERSION && Array.isArray(value.entries)) {
        // Never rewrite an unknown or malformed envelope and lose its originals.
        if (value.entries.some(entry => !entry || !token(entry.payload?.submissionId))) throw problem('queue_invalid')
        return clone(value)
      }
      if (!Array.isArray(value)) throw problem('queue_version_unsupported')
      const envelope = { version: VERSION, entries: value.map(original => {
        const payload = original && typeof original === 'object' && !Array.isArray(original)
          ? clone(original) : { legacyPayload: clone(original) }
        const established = token(payload.submissionId) && Number.isFinite(Date.parse(payload.submissionCreatedAt || ''))
        if (!token(payload.submissionId)) payload.submissionId = uuid()
        // A newly assigned token cannot prove that a legacy send was not already
        // delivered. In particular, never invent a creation time for old work.
        return { payload, pending: established ? ageReason(payload) : 'legacy_delivery_unknown' }
      }) }
      // Atomic whole-key replacement. No fetch occurs before this succeeds;
      // suspension afterwards reuses precisely these assigned tokens.
      await write(envelope)
      return envelope
    }
    async function json(transport, url, options = {}) {
      const response = await transport(url, { ...options, signal: AbortSignal.timeout(8000) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw problem(response.status === 409 ? 'submission_conflict' : 'bridge_rejected', body?.error || `HTTP ${response.status}`)
      return body
    }
    async function flush(envelope, transport) {
      const delivered = []
      let reason = null
      if (!envelope.entries.length) return { delivered, reason }
      let base
      try {
        base = await endpoint()
        // Defence in depth even when a test injects an endpoint provider.
        const parsed = new URL(base)
        if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw problem('invalid_endpoint')
        base = parsed.origin
        const identity = await json(transport, base + '/.identity')
        if (identity?.app !== 'groundworks-nudge' || !identity.capabilities?.submissionIdempotency) return { delivered, reason: 'idempotency_unavailable' }
      } catch (error) { return { delivered, reason: error.code || 'bridge_offline' } }
      // Strict FIFO: ambiguous/expired work is never silently bypassed.
      while (envelope.entries.length) {
        const entry = envelope.entries[0]
        reason = entry.pending || ageReason(entry.payload)
        if (reason) break
        try {
          const body = await json(transport, base + '/comments', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.payload),
          })
          if (!body || typeof body.id !== 'string' || !/^nudge_\d+$/.test(body.id)) throw problem('invalid_response')
          const next = { ...envelope, entries: envelope.entries.slice(1) }
          // If deletion fails after server commit, keep the original durable
          // payload/token: the next attempt safely obtains the same receipt.
          await write(next)
          envelope.entries = next.entries
          delivered.push({ submissionId: entry.payload.submissionId, id: body.id, withdrawn: body.withdrawn === true })
        } catch (error) { reason = error.code || 'bridge_offline'; break }
      }
      return { delivered, reason }
    }
    function summary(envelope) {
      return envelope.entries.map(({ payload, pending }) => ({
        submissionId: payload.submissionId, submissionCreatedAt: payload.submissionCreatedAt || null,
        text: payload.text || '', url: payload.url || '', pending: pending || ageReason(payload),
      }))
    }
    return { handle: (message, { fetch: transport = request } = {}) => serialize(async () => {
      try {
        const envelope = await read()
        if (message.action === 'status') return { ok: true, entries: summary(envelope), capacity: CAPACITY }
        if (message.action === 'discard') {
          const entries = envelope.entries.filter(entry => entry.payload.submissionId !== message.submissionId)
          await write({ ...envelope, entries })
          return { ok: true, removed: envelope.entries.length - entries.length }
        }
        if (!['submit', 'flush'].includes(message.action)) throw problem('unknown_queue_action')
        if (message.action === 'submit') {
          const payload = clone(message.payload)
          if (!token(payload?.submissionId) || ageReason(payload)) throw problem('invalid_submission', 'Submission needs a valid stable token and creation time')
          const existing = envelope.entries.find(entry => entry.payload.submissionId === payload.submissionId)
          if (existing && canonical(existing.payload) !== canonical(payload)) throw problem('submission_conflict')
          if (!existing) {
            if (envelope.entries.length >= CAPACITY) throw problem('queue_full', 'Queue full — prompt kept')
            envelope.entries.push({ payload, pending: null })
            await write(envelope)
          }
        }
        const result = await flush(envelope, transport)
        const own = result.delivered.find(item => item.submissionId === message.payload?.submissionId)
        return { ok: true, queued: message.action === 'submit' && !own, id: own?.id || null,
          withdrawn: own?.withdrawn || false, ...result, entries: summary(envelope) }
      } catch (error) { return { ok: false, error: error.code || 'queue_failed', message: error.message } }
    }) }
  }

  function install(api, platform = globalThis.__nudgePlatform || {}) {
    const owner = create({ storage: api.storage.local, endpoint: async () => {
      const { nudgePort } = await api.storage.local.get('nudgePort')
      const port = platform.bridgePort || nudgePort || 4700
      if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw problem('invalid_endpoint')
      return `http://localhost:${port}`
    } })
    api.runtime.onMessage.addListener((message, sender, reply) => {
      if (message?.type !== 'nudge-queue') return
      // Only an actual top-level local content script can supply HTTP transport.
      // The bridge retains its localhost-origin fence; extension-origin POSTs
      // are not admitted. Queue ownership and endpoint selection remain here.
      let local = false
      try {
        const url = new URL(sender.url || sender.tab?.url)
        local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      } catch { /* malformed sender URL is rejected below */ }
      if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !local) {
        reply({ ok: false, error: 'queue_sender_rejected' }); return
      }
      // This closure belongs to this RPC, not a shared mutable "current tab".
      // Concurrent windows queue their own transport along with their mutation.
      const tabId = sender.tab.id
      const transport = async (url, options) => {
        const signal = options.signal
        let onAbort
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(problem('transport_timeout'))
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        })
        try {
          const result = await Promise.race([aborted, api.tabs.sendMessage(tabId, {
            type: 'nudge-queue-http', url, method: options.method || 'GET', body: options.body || null,
          }, { frameId: 0 })])
          if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599 || typeof result.ok !== 'boolean' || result.ok !== (result.status >= 200 && result.status < 300)) throw problem('transport_response_invalid')
          return { ok: result.ok, status: result.status, json: async () => result.body }
        } finally { signal.removeEventListener('abort', onAbort) }
      }
      owner.handle(message, { fetch: transport }).then(reply)
      return true
    })
    return owner
  }
  globalThis.NudgeQueue = Object.freeze({ create, install })
})()
