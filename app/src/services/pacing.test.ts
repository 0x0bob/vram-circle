import { describe, expect, it, vi } from 'vitest'

// On Arc testnet the public RPC rate-limits bursts of eth_getLogs (about 4 in a row). A multi-chunk scan must space them.
const starts: number[] = []
vi.mock('viem', async (orig) => {
  const actual = await orig<typeof import('viem')>()
  return {
    ...actual,
    http: () =>
      actual.custom({
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_blockNumber') return '0x2f50' // 12,112
          if (method === 'eth_getLogs') {
            starts.push(Date.now())
            return []
          }
          throw new Error(`unexpected rpc ${method}`)
        },
      }),
  }
})

vi.stubEnv('VITE_CHAIN_ID', '5042002')
vi.stubEnv('VITE_FACTORY_ADDRESS', '0x1111111111111111111111111111111111111111')
vi.stubEnv('VITE_DEPLOY_BLOCK', '100')
vi.stubEnv('VITE_LOG_CHUNK', '4000') // 100..12112 -> 4 requests

describe('scan pacing on Arc testnet', () => {
  it('spaces consecutive log requests by at least 250ms', async () => {
    const { findProjects } = await import('./chain')
    await findProjects()
    expect(starts.length).toBe(4)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(240)
  }, 15_000)
})
