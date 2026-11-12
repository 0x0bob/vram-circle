import { describe, expect, it, vi } from 'vitest'
import { blockRanges, fetchPaged } from './paginate'

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
