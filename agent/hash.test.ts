import { describe, expect, it } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { contentHash, hashMatches } from './hash'

describe('contentHash', () => {
  it('is keccak256 of the UTF-8 bytes, the same as the browser (app/src/lib/hash.ts)', () => {
    expect(contentHash('hello')).toBe(keccak256(toBytes('hello')))
    // a known vector, so this cannot drift together with viem
    expect(contentHash('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
  })
  it('covers non-ASCII text byte for byte', () => {
    expect(contentHash('héllo 你好')).toBe(keccak256(toBytes('héllo 你好')))
  })
  it('detects a mismatch, including by one character, and is case-insensitive on the hex', () => {
    const h = contentHash('answer')
    expect(hashMatches('answer', h)).toBe(true)
    expect(hashMatches('answer', h.toUpperCase().replace('0X', '0x') as `0x${string}`)).toBe(true)
    expect(hashMatches('answer.', h)).toBe(false)
    expect(hashMatches('answer', `0x${'00'.repeat(32)}`)).toBe(false)
  })
})
