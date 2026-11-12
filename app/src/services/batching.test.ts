import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression (step 3b, 2026-11-12): the public Arc RPC answers HTTP 429 when the app sends a dozen separate
// eth_call requests at once (a project page does). Concurrent reads must leave as ONE JSON-RPC batch request.
describe('rpc batching', () => {
  const requests: Array<{ batch: boolean; size: number }> = []

  beforeEach(() => {
    requests.length = 0
    vi.resetModules()
    vi.stubEnv('VITE_FACTORY_ADDRESS', '0x1111111111111111111111111111111111111111')
    vi.stubEnv('VITE_USDC_ADDRESS', '0x3600000000000000000000000000000000000000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body)
        const list = Array.isArray(body) ? body : [body]
        requests.push({ batch: Array.isArray(body), size: list.length })
        const reply = list.map((r: { id: number }) => ({ jsonrpc: '2.0', id: r.id, result: '0x' }))
        return new Response(JSON.stringify(Array.isArray(body) ? reply : reply[0]), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
  })

  it('sends the reads of one vault as a single batched HTTP request', async () => {
    const { readVault } = await import('./chain')
    await readVault('0x269FCAF4d50CFd5346D275A7546cE78fEC29B111').catch(() => undefined) // decode errors are fine
    expect(requests).toHaveLength(1)
    expect(requests[0].batch).toBe(true)
    expect(requests[0].size).toBe(8)
  })

  // Reads that land right behind a burst get -32005 from the public RPC. They must be retried, not shown as errors.
  it('retries a read through four consecutive rate-limit responses', async () => {
    let failures = 4
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body)
        const list = Array.isArray(body) ? body : [body]
        const reply = list.map((r: { id: number }) =>
          failures-- > 0
            ? { jsonrpc: '2.0', id: r.id, error: { code: -32005, message: 'rate limit exceeded' } }
            : { jsonrpc: '2.0', id: r.id, result: `0x${'6'.padStart(64, '0')}` },
        )
        return new Response(JSON.stringify(Array.isArray(body) ? reply : reply[0]), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const { readUsdcDecimals } = await import('./chain')
    await expect(readUsdcDecimals()).resolves.toBe(6)
  }, 20_000)
})
