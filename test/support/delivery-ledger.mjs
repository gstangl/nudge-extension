// Independent expectations: no bridge/store/queue implementation imports.
import assert from 'node:assert/strict'
export class DeliveryLedger {
  constructor() { this.attempts = [] }
  attempt(input) {
    assert.equal(typeof input.submissionId, 'string', 'submission identity required')
    assert(!this.attempts.some(a => a.submissionId === input.submissionId), 'duplicate attempt identity')
    assert(Number.isFinite(input.t0) && input.t0 >= 0, 'invalid T0')
    const attempt = { ...input, status: 'pending', observations: [] }; this.attempts.push(attempt); return attempt
  }
  reconcile(pins, { requireWatcher = true } = {}) {
    assert(this.attempts.length, 'empty run')
    assert.equal(pins.length, this.attempts.length, 'stored effect count differs from attempted work')
    for (const attempt of this.attempts) {
      const matches = pins.filter(p => p.submissionId === attempt.submissionId)
      assert.equal(matches.length, 1, `lost or duplicated submission ${attempt.submissionId}`)
      const pin = matches[0]
      assert.equal(pin.text, attempt.text, 'payload drift')
      assert.equal(pin.url, attempt.url, 'source drift')
      if (attempt.targetSelector) assert.equal(pin.target?.selector, attempt.targetSelector, 'wrong DOM target')
      if (attempt.browserSource) assert.deepEqual(pin.browserSource, attempt.browserSource, 'browser provenance drift')
      assert.equal(pin.owner?.session ?? null, attempt.owner, 'wrong owner')
      if (requireWatcher) {
        const receipts = attempt.observations.filter(o => o.kind === 'watcher')
        assert.equal(receipts.length, 1, 'missing or duplicate watcher receipt')
        assert.equal(receipts[0].id, pin.id, 'wrong watcher pin identity')
        assert.equal(receipts[0].session, attempt.owner, 'wrong watcher session')
        assert(receipts[0].at >= attempt.t0 && Number.isFinite(receipts[0].at), 'invalid watcher clock')
        assert(receipts[0].at - attempt.t0 <= (attempt.deadlineMs || 5000), 'watcher deadline exceeded')
      }
      assert.notEqual(attempt.status, 'pending', 'unterminated attempt')
    }
    return { attempted: this.attempts.length, stored: pins.length, failed: this.attempts.filter(a => a.status !== 'passed').length }
  }
}
export function summary(attempts, scheduledCount = attempts.length) {
  assert.equal(attempts.length, scheduledCount, 'omitted scheduled attempt')
  assert(attempts.length, 'empty timings')
  const values = attempts.filter(a => a.status === 'passed').map(a => {
    assert(Number.isFinite(a.latencyMs) && a.latencyMs > 0, 'invalid timing'); return a.latencyMs
  }).sort((a, b) => a - b)
  assert(attempts.every(a => ['passed', 'failed', 'timeout'].includes(a.status)), 'missing terminal outcome')
  const p = q => values.length ? values[Math.ceil(values.length * q) - 1] : null
  return { attempts: attempts.length, successful: values.length, failed: attempts.length - values.length, p50: p(.5), p95: p(.95), p99: p(.99), max: values.at(-1) ?? null }
}
