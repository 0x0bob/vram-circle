import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake JSON-RPC provider. The REAL viem client (with its real block-number cache) runs on top of it.
const state = { head: 100n, logRanges: [] as Array<[bigint, bigint]> }

vi.mock('viem', async (orig) => {
  const actual = await orig<typeof import('viem')>()
  return {
    ...actual,
    http: () =>
      actual.custom({
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          if (method === 'eth_blockNumber') return `0x${state.head.toString(16)}`
          if (method === 'eth_getLogs') {
            const f = (params as Array<{ fromBlock: string; toBlock: string }>)[0]
            state.logRanges.push([BigInt(f.fromBlock), BigInt(f.toBlock)])
            return []
          }
          throw new Error(`unexpected rpc ${method}`)
        },
      }),
  }
})

vi.stubEnv('VITE_FACTORY_ADDRESS', '0x1111111111111111111111111111111111111111')
vi.stubEnv('VITE_USDC_ADDRESS', '0x3600000000000000000000000000000000000000')
vi.stubEnv('VITE_DEPLOY_BLOCK', '90')
vi.stubEnv('VITE_LOG_CHUNK', '1000')

beforeEach(() => {
  vi.resetModules() // fresh viem client (and block-number cache) per test
  state.head = 100n
  state.logRanges = []
})

describe('event scans', () => {
  it('start at the deploy block and never request more than one chunk of blocks', async () => {
    state.head = 5_090n // 5,001 blocks after the deploy block
    const { findProjects } = await import('./chain')
    await findProjects()
    expect(state.logRanges[0][0]).toBe(90n)
    for (const [a, b] of state.logRanges) expect(b - a + 1n).toBeLessThanOrEqual(1000n)
    expect(state.logRanges.at(-1)![1]).toBe(5_090n)
    expect(state.logRanges).toHaveLength(6)
  })

  // Regression (step 3b, 2026-11-12): the scan asks for the latest block number first. viem caches
  // eth_blockNumber for about 4s, so a project created a moment ago (in a block newer than the cached
  // head) was missing from the list right after its own "done" toast. The scan must always see the live head.
  it('test_regression_scanSeesABlockMinedJustAfterAPreviousScan', async () => {
    const { findProjects } = await import('./chain')
    await findProjects()
    expect(state.logRanges.at(-1)![1]).toBe(100n)

    state.head = 101n // the creator's tx is mined
    state.logRanges = []
    await findProjects()
    expect(state.logRanges.at(-1)![1]).toBe(101n)
  })
})
