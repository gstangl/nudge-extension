import { test, expect } from 'vitest'
import { DeliveryLedger, summary } from '../support/delivery-ledger.mjs'
const pin = { id: 'nudge_1', submissionId: 'fixture_submission', text: 'Reference text', url: 'http://alpha.localhost/', owner: { session: 'session_alpha' } }
function fixture() {
  const ledger = new DeliveryLedger()
  const a = ledger.attempt({ ...pin, owner: 'session_alpha', t0: 10 }); a.status = 'passed'; a.latencyMs = 5
  a.observations.push({ kind: 'watcher', id: 'nudge_1', session: 'session_alpha', at: 15 })
  return ledger
}
test('H01 positive reference and deliberately dropped/duplicated/misrouted effects', () => {
  expect(fixture().reconcile([pin])).toEqual({ attempted: 1, stored: 1, failed: 0 })
  expect(() => fixture().reconcile([])).toThrow('stored effect count')
  expect(() => fixture().reconcile([pin, { ...pin, id: 'nudge_2' }])).toThrow('stored effect count')
  expect(() => fixture().reconcile([{ ...pin, owner: { session: 'session_beta' } }])).toThrow('wrong owner')
})
test('H02/H03/H07 missing attempt, clock, receipt, identity and timing controls', () => {
  expect(() => new DeliveryLedger().reconcile([])).toThrow('empty run')
  const l = fixture(); expect(() => l.attempt(l.attempts[0])).toThrow('duplicate attempt')
  l.attempts[0].observations = []; expect(() => l.reconcile([pin])).toThrow('watcher receipt')
  const badClock = fixture(); badClock.attempts[0].observations[0].at = 9
  expect(() => badClock.reconcile([pin])).toThrow('clock')
  expect(() => summary([])).toThrow('empty timings')
  for (const latencyMs of [0, -1, NaN, Infinity]) expect(() => summary([{status:'passed',latencyMs}])).toThrow('invalid timing')
  expect(summary([{status:'passed',latencyMs:5},{status:'timeout'}])).toMatchObject({attempts:2,successful:1,failed:1,p95:5})
  expect(() => summary([{status:'pending'}])).toThrow('terminal outcome')
})
