import { describe, expect, it, vi } from 'vitest'
import { blockRanges, fetchPaged, isRateLimit } from './paginate'

describe('blockRanges', () => {
  it('splits an inclusive range into bounded chunks', () => {
    expect(blockRanges(0n, 25n, 10n)).toEqual([
      [0n, 9n],
      [10n, 19n],
      [20n, 25n],
    ])
  })

  it('returns one range when it fits in a chunk', () => {
    expect(blockRanges(5n, 5n, 1000n)).toEqual([[5n, 5n]])
  })

  it('returns nothing when from is after to', () => {
    expect(blockRanges(10n, 9n, 100n)).toEqual([])
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => blockRanges(0n, 10n, 0n)).toThrow()
  })

  it('never produces a range larger than the chunk and covers every block once', () => {
    const ranges = blockRanges(7n, 12_345n, 1000n)
    let next = 7n
    for (const [a, b] of ranges) {
      expect(a).toBe(next)
      expect(b - a + 1n).toBeLessThanOrEqual(1000n)
      next = b + 1n
    }
    expect(next).toBe(12_346n)
  })
})

describe('fetchPaged', () => {
  it('queries every chunk in order and concatenates the results', async () => {
    const calls: Array<[bigint, bigint]> = []
    const out = await fetchPaged(0n, 24n, 10n, async (a, b) => {
      calls.push([a, b])
      return [`${a}-${b}`]
    })
    expect(calls).toEqual([
      [0n, 9n],
      [10n, 19n],
      [20n, 24n],
    ])
    expect(out).toEqual(['0-9', '10-19', '20-24'])
  })

  it('halves the chunk and retries when the RPC rejects the range', async () => {
    const fn = vi.fn(async (a: bigint, b: bigint) => {
      if (b - a + 1n > 4n) throw new Error('requested range too large')
      return [`${a}-${b}`]
    })
    const out = await fetchPaged(0n, 7n, 8n, fn, { minChunk: 1n })
    expect(out).toEqual(['0-3', '4-7'])
  })

  it('gives up and rethrows once the chunk cannot shrink further', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(fetchPaged(0n, 100n, 8n, fn, { minChunk: 2n })).rejects.toThrow('boom')
  })

  it('does nothing for an empty range', async () => {
    const fn = vi.fn(async () => ['x'])
    expect(await fetchPaged(10n, 5n, 100n, fn)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})

// Regression (step 3b, 2026-11-13): production hit "rate limit exceeded" (-32005) on a ~60-chunk scan.
// A rate limit means "wait", not "ask for fewer blocks": halving would only make MORE requests.
describe('rate limits', () => {
  it('recognises rate-limit errors from viem and from raw RPC responses', () => {
    expect(isRateLimit(Object.assign(new Error('Request exceeds defined limit'), { code: -32005 }))).toBe(true)
    expect(isRateLimit(Object.assign(new Error('HTTP request failed'), { status: 429 }))).toBe(true)
    expect(isRateLimit(new Error('rate limit exceeded'))).toBe(true)
    expect(isRateLimit(new Error('Too many requests'))).toBe(true)
    expect(isRateLimit(Object.assign(new Error('wrapper'), { cause: { code: -32005 } }))).toBe(true)
    expect(isRateLimit(new Error('requested range too large'))).toBe(false)
    expect(isRateLimit(new Error('boom'))).toBe(false)
  })

  it('retries the SAME chunk after a backoff instead of halving it', async () => {
    const calls: Array<[bigint, bigint]> = []
    const sleeps: number[] = []
    let failures = 2
    const out = await fetchPaged(
      0n,
      9n,
      10n,
      async (a, b) => {
        calls.push([a, b])
        if (failures-- > 0) throw new Error('rate limit exceeded')
        return ['ok']
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    )
    expect(out).toEqual(['ok'])
    expect(calls).toEqual([[0n, 9n], [0n, 9n], [0n, 9n]]) // never narrowed
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]) // exponential backoff
  })

  it('gives up after the retry budget and rethrows', async () => {
    const fn = vi.fn(async () => {
      throw new Error('rate limit exceeded')
    })
    await expect(fetchPaged(0n, 9n, 10n, fn, { sleep: async () => undefined, maxRetries: 3 })).rejects.toThrow('rate limit')
    expect(fn).toHaveBeenCalledTimes(4) // first try + 3 retries
  })
})
