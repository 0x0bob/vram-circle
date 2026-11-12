import { describe, expect, it } from 'vitest'
import { createPacer } from './pacer'

describe('createPacer', () => {
  it('runs tasks one at a time, starting each at least `gapMs` after the previous start', async () => {
    const pace = createPacer(40)
    const starts: number[] = []
    let running = 0
    let maxRunning = 0
    const task = async () => {
      starts.push(Date.now())
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return starts.length
    }
    const results = await Promise.all([pace(task), pace(task), pace(task), pace(task)])
    expect(results).toEqual([1, 2, 3, 4]) // in call order
    expect(maxRunning).toBe(1)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(35)
  })

  it('a failing task does not block the queue, and its error reaches its own caller', async () => {
    const pace = createPacer(1)
    const bad = pace(async () => {
      throw new Error('boom')
    })
    const good = pace(async () => 'ok')
    await expect(bad).rejects.toThrow('boom')
    await expect(good).resolves.toBe('ok')
  })

  it('does not delay at all when the gap is 0 (local chain)', async () => {
    const pace = createPacer(0)
    const t0 = Date.now()
    await Promise.all(Array.from({ length: 20 }, () => pace(async () => 1)))
    expect(Date.now() - t0).toBeLessThan(50)
  })
})
