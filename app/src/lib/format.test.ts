import { describe, expect, it } from 'vitest'
import { feeOn, formatNative, formatUsdc, parseAddressList, parseUsdc, totalReservation } from './format'

describe('fee maths (must match ProjectVault.createTask)', () => {
  it('charges the fee on top of the reward', () => {
    expect(feeOn(100_000_000n, 1000)).toBe(10_000_000n)
    expect(totalReservation(100_000_000n, 1000, 3)).toBe(330_000_000n)
  })
  it('rounds the fee down like Solidity', () => {
    expect(feeOn(15n, 1000)).toBe(1n) // 1.5 -> 1
    expect(feeOn(9n, 1000)).toBe(0n)
  })
  it('handles the 15% cap', () => {
    expect(feeOn(1_000_000n, 1500)).toBe(150_000n)
  })
})

describe('parseUsdc / formatUsdc', () => {
  it('parses decimals into base units', () => {
    expect(parseUsdc('100')).toBe(100_000_000n)
    expect(parseUsdc('0.5')).toBe(500_000n)
    expect(parseUsdc(' 1.234567 ')).toBe(1_234_567n)
  })
  it('rejects bad input, zero and too many decimals', () => {
    for (const bad of ['', 'abc', '-1', '0', '0.0', '1.2345678', '1e3', '1,5']) expect(parseUsdc(bad)).toBeNull()
  })
  it('formats with grouping and no trailing zeros', () => {
    expect(formatUsdc(1_234_500_000n)).toBe('1,234.5')
    expect(formatUsdc(0n)).toBe('0')
    expect(formatUsdc(1n)).toBe('0.000001')
  })
})

describe('formatNative (gas balance, 18 decimals, never mixed with 6-decimal USDC)', () => {
  it('formats an 18-decimal amount', () => {
    expect(formatNative(1_500_000_000_000_000_000n)).toBe('1.5')
    expect(formatNative(0n)).toBe('0')
  })
  it('does not read a 6-decimal USDC amount as gas, or the reverse', () => {
    // 1 USDC through the ERC-20 interface is 1_000_000; as native gas that is a dust amount
    expect(formatUsdc(1_000_000n)).toBe('1')
    expect(formatNative(1_000_000n)).toBe('0') // 1e-12, below the 6-place display
    expect(formatNative(1_000_000n)).not.toBe(formatUsdc(1_000_000n))
  })
  it('trims long fractions to 6 places for display', () => {
    expect(formatNative(1_234_567_890_123_456_789n)).toBe('1.234567')
  })
})

describe('parseAddressList', () => {
  const a = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const b = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  it('splits on spaces, commas and new lines', () => {
    expect(parseAddressList(`${a}, ${b}\n${a}`)).toHaveLength(3)
  })
  it('returns null when any entry is invalid or the list is empty', () => {
    expect(parseAddressList(`${a} nope`)).toBeNull()
    expect(parseAddressList('  ')).toBeNull()
  })
})
