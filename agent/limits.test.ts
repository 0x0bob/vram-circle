import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store'
import { RateLimiter, SpendLedger, costUsd, estimateUsd } from './limits'

describe('RateLimiter (sliding window)', () => {
  it('allows up to max per window per key, then reports when to retry', () => {
    let t = 1_000
    const rl = new RateLimiter(3, 60_000, () => t)
    expect(rl.check('ip1').allowed).toBe(true)
    expect(rl.check('ip1').allowed).toBe(true)
    expect(rl.check('ip1').allowed).toBe(true)
    const blocked = rl.check('ip1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000)
    expect(rl.check('ip2').allowed).toBe(true) // other keys are independent
  })
  it('frees the slot after the window', () => {
    let t = 0
    const rl = new RateLimiter(1, 1000, () => t)
    expect(rl.check('k').allowed).toBe(true)
    expect(rl.check('k').allowed).toBe(false)
    t = 1001
    expect(rl.check('k').allowed).toBe(true)
  })
  it('does not grow without bound for many distinct keys', () => {
    let t = 0
    const rl = new RateLimiter(1, 1000, () => t)
    for (let i = 0; i < 5000; i++) rl.check(`k${i}`)
    t = 5000
    rl.check('trigger-cleanup')
    expect(rl.size()).toBeLessThan(10)
  })
})

describe('cost maths (Claude Haiku 5.5 list price: $0.10 / $0.50 per million tokens)', () => {
  it('prices actual usage', () => {
    expect(costUsd({ input: 1_000_000, output: 0 })).toBeCloseTo(0.1, 6)
    expect(costUsd({ input: 0, output: 1_000_000 })).toBeCloseTo(0.5, 6)
    expect(costUsd({ input: 900, output: 120 })).toBeCloseTo(0.00009 + 0.00006, 8)
  })
  it('estimates the worst case from the input size and the output cap, rounding up', () => {
    expect(estimateUsd(30_000, 4_000)).toBeGreaterThan(costUsd({ input: 7_500, output: 4_000 }) - 1e-12)
  })
})

describe('SpendLedger (daily cap, persisted in the store, never trusts the client)', () => {
  const day = (iso: string) => () => new Date(iso).getTime()

  it('allows spending under the cap and refuses once the recorded spend would exceed it', async () => {
    const store = new MemoryStore()
    const ledger = new SpendLedger({ store, capUsd: 0.01, maxCalls: 100, now: day('2026-11-13T10:00:00Z') })
    expect((await ledger.check(0.004)).ok).toBe(true)
    await ledger.record(0.004)
    expect((await ledger.check(0.004)).ok).toBe(true)
    await ledger.record(0.004)
    const r = await ledger.check(0.004)
    expect(r).toEqual({ ok: false, reason: 'daily_cap' })
  })

  it('enforces a calls-per-day cap independent of the dollar cap', async () => {
    const store = new MemoryStore()
    const ledger = new SpendLedger({ store, capUsd: 100, maxCalls: 2, now: day('2026-11-13T10:00:00Z') })
    await ledger.record(0.0001)
    await ledger.record(0.0001)
    expect(await ledger.check(0.0001)).toEqual({ ok: false, reason: 'daily_calls' })
  })

  it('starts a fresh budget on a new UTC day', async () => {
    const store = new MemoryStore()
    const d1 = new SpendLedger({ store, capUsd: 0.001, maxCalls: 100, now: day('2026-11-13T23:59:00Z') })
    await d1.record(0.001)
    expect((await d1.check(0.0005)).ok).toBe(false)
    const d2 = new SpendLedger({ store, capUsd: 0.001, maxCalls: 100, now: day('2026-11-14T00:01:00Z') })
    expect((await d2.check(0.0005)).ok).toBe(true)
  })

  it('shares the ledger between instances through the store (serverless instances do not each get a fresh cap)', async () => {
    const store = new MemoryStore()
    const a = new SpendLedger({ store, capUsd: 0.002, maxCalls: 100, now: day('2026-11-13T10:00:00Z') })
    const b = new SpendLedger({ store, capUsd: 0.002, maxCalls: 100, now: day('2026-11-13T10:00:00Z') })
    await a.record(0.002)
    expect((await b.check(0.001)).ok).toBe(false)
  })

  it('fails closed: if the store cannot be read, no AI call is allowed', async () => {
    const store = new MemoryStore()
    store.list = async () => {
      throw new Error('blob outage')
    }
    const ledger = new SpendLedger({ store, capUsd: 100, maxCalls: 100, now: day('2026-11-13T10:00:00Z') })
    expect(await ledger.check(0.0001)).toEqual({ ok: false, reason: 'ledger_unavailable' })
  })
})
