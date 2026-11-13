import { describe, expect, it } from 'vitest'
import { readConfig } from './config'

describe('readConfig (server environment)', () => {
  it('uses safe defaults with no environment: testnet RPC, cheap model, a small daily cap, no AI key', () => {
    const c = readConfig({})
    expect(c.chainId).toBe(5042002)
    expect(c.rpcUrl).toBe('https://rpc.testnet.arc.io')
    expect(c.model).toBe('claude-haiku-5-5')
    expect(c.dailyCapUsd).toBe(2)
    expect(c.dailyMaxCalls).toBe(200)
    expect(c.anthropicKey).toBeNull()
    expect(c.factory).toMatch(/^0x[0-9a-fA-F]{40}$/) // from deployments/arc-testnet.json
  })

  it('reads overrides, and treats a blank key as no key', () => {
    const c = readConfig({
      ANTHROPIC_API_KEY: 'sk-ant-xyz',
      AGENT_MODEL: 'claude-sonnet-5-5',
      AGENT_DAILY_CAP_USD: '10',
      AGENT_DAILY_MAX_CALLS: '50',
      ARC_RPC_URL: 'https://rpc.example/KEY',
    })
    expect(c).toMatchObject({ anthropicKey: 'sk-ant-xyz', model: 'claude-sonnet-5-5', dailyCapUsd: 10, dailyMaxCalls: 50, rpcUrl: 'https://rpc.example/KEY' })
    expect(readConfig({ ANTHROPIC_API_KEY: '   ' }).anthropicKey).toBeNull()
  })

  it('falls back to the default cap for nonsense, never to "unlimited"', () => {
    for (const bad of ['', 'abc', '-5', 'Infinity', 'NaN', '0']) {
      const c = readConfig({ AGENT_DAILY_CAP_USD: bad, AGENT_DAILY_MAX_CALLS: bad })
      expect(c.dailyCapUsd).toBe(2)
      expect(c.dailyMaxCalls).toBe(200)
    }
  })

  it('refuses a chain other than Arc testnet (mainnet is blocked)', () => {
    expect(() => readConfig({ CHAIN_ID: '5042' })).toThrow(/testnet/i)
    expect(readConfig({ CHAIN_ID: '5042002' }).chainId).toBe(5042002)
  })

  it('does not accept a malformed factory address', () => {
    expect(() => readConfig({ FACTORY_ADDRESS: '0x123' })).toThrow(/FACTORY_ADDRESS/)
  })
})
