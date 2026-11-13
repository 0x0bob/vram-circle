import type { BlobStore } from './store'

// Claude Haiku 5.5 list price per million tokens, prompts up to 100K tokens (cached 2026-10-06 from the Claude API docs).
// TODO(verify): confirm current pricing before relying on the dollar numbers; the calls-per-day cap does not depend on them.
export const PRICE_INPUT_PER_MTOK = 0.1
export const PRICE_OUTPUT_PER_MTOK = 0.5

export function costUsd(u: { input: number; output: number }): number {
  return (u.input * PRICE_INPUT_PER_MTOK + u.output * PRICE_OUTPUT_PER_MTOK) / 1_000_000
}

/** Worst case for one call: 1 token per 3 characters of input (conservative) plus the full output cap. */
export function estimateUsd(inputChars: number, maxOutputTokens: number): number {
  return costUsd({ input: Math.ceil(inputChars / 3), output: maxOutputTokens })
}

export interface RateResult {
  allowed: boolean
  retryAfterMs: number
}

/**
 * Sliding-window rate limiter, in memory. Serverless instances do not share memory, so this is a best-effort brake on one
 * client, not a global guarantee: the spend ledger below is the hard cap.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private lastSweep = 0

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateResult {
    const t = this.now()
    this.sweep(t)
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return { allowed: false, retryAfterMs: Math.max(1, recent[0]! + this.windowMs - t) }
    }
    recent.push(t)
    this.hits.set(key, recent)
    return { allowed: true, retryAfterMs: 0 }
  }

  size(): number {
    return this.hits.size
  }

  private sweep(t: number) {
    if (t - this.lastSweep < this.windowMs) return
    this.lastSweep = t
    for (const [k, v] of this.hits) if (v.every((x) => x <= t - this.windowMs)) this.hits.delete(k)
  }
}

export type SpendCheck = { ok: true } | { ok: false; reason: 'daily_cap' | 'daily_calls' | 'ledger_unavailable' }

/**
 * Daily AI spend ledger kept in the store, so every serverless instance sees the same total. One tiny file per call, with the
 * cost in micro-dollars in its name, so the total is the sum of the listing. Not atomic: concurrent calls can overshoot the
 * cap by the handful of calls in flight. FAILS CLOSED: if the ledger cannot be read, no AI call is made.
 * (A Redis counter would make it atomic; see docs/agent.md.)
 */
export class SpendLedger {
  private readonly store: BlobStore
  private readonly capMicro: number
  private readonly maxCalls: number
  private readonly now: () => number

  constructor(o: { store: BlobStore; capUsd: number; maxCalls: number; now?: () => number }) {
    this.store = o.store
    this.capMicro = Math.round(o.capUsd * 1e6)
    this.maxCalls = o.maxCalls
    this.now = o.now ?? Date.now
  }

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  async check(estimateUsd: number): Promise<SpendCheck> {
    try {
      const files = await this.store.list(`spend/${this.day()}/`)
      if (files.length >= this.maxCalls) return { ok: false, reason: 'daily_calls' }
      const spent = files.reduce((sum, f) => sum + (Number(/-(\d+)\.json$/.exec(f)?.[1]) || 0), 0)
      if (spent + Math.round(estimateUsd * 1e6) > this.capMicro) return { ok: false, reason: 'daily_cap' }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'ledger_unavailable' }
    }
  }

  async record(usd: number): Promise<void> {
    const micro = Math.max(1, Math.round(usd * 1e6))
    const id = `${this.now()}-${Math.random().toString(36).slice(2, 10)}`
    await this.store.put(`spend/${this.day()}/${id}-${micro}.json`, JSON.stringify({ usd }))
  }
}
