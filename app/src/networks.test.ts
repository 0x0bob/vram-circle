import { describe, expect, it } from 'vitest'
import { ARC_MAINNET, ARC_TESTNET, LOCAL, MainnetDisabledError, pollInterval, resolveNetwork, txUrl } from './networks'

describe('networks', () => {
  it('Arc testnet values match the verified docs', () => {
    expect(ARC_TESTNET.id).toBe(5042002)
    expect(ARC_TESTNET.rpcUrl).toBe('https://rpc.testnet.arc.io')
    expect(ARC_TESTNET.explorerUrl).toBe('https://explorer.testnet.arc.io')
    expect(ARC_TESTNET.usdc).toBe('0x3600000000000000000000000000000000000000')
    expect(ARC_TESTNET.usdcDecimals).toBe(6)
    // gas is native USDC with 18 decimals, a different unit from the 6-decimal ERC-20 interface
    expect(ARC_TESTNET.nativeDecimals).toBe(18)
  })

  it('knows the mainnet values but refuses to use them', () => {
    expect(ARC_MAINNET.id).toBe(5042)
    expect(ARC_MAINNET.rpcUrl).toBe('https://rpc.mainnet.arc.io')
    expect(() => resolveNetwork(5042)).toThrow(MainnetDisabledError)
  })

  it('resolves testnet and the local chain', () => {
    expect(resolveNetwork(5042002).id).toBe(5042002)
    expect(resolveNetwork(31337).id).toBe(31337)
  })

  it('rejects unknown chains', () => {
    expect(() => resolveNetwork(1)).toThrow(/unsupported/i)
  })

  it('links transactions to the explorer on Arc testnet and nowhere on the local chain', () => {
    expect(txUrl(ARC_TESTNET, '0xabc')).toBe('https://explorer.testnet.arc.io/tx/0xabc')
    expect(txUrl(LOCAL, '0xabc')).toBeNull()
  })
})

describe('pollInterval', () => {
  it('polls at the base rate locally and slower on a public RPC, to stay under its rate limit', () => {
    expect(pollInterval(LOCAL, 4000)).toBe(4000)
    expect(pollInterval(ARC_TESTNET, 4000)).toBe(16000)
  })
})

describe('logChunk', () => {
  it('keeps Arc testnet scans under its 10,000-block eth_getLogs cap', () => {
    expect(ARC_TESTNET.logChunk).toBeLessThan(10_000)
    expect(ARC_TESTNET.logChunk).toBeGreaterThanOrEqual(5_000)
  })

  it('spaces log requests on Arc testnet (about 4 requests per second is the public limit) but not locally', () => {
    expect(ARC_TESTNET.logGapMs).toBeGreaterThanOrEqual(250)
    expect(LOCAL.logGapMs).toBe(0)
  })
})
