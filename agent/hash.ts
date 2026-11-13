import { keccak256, toBytes, type Hex } from 'viem'

/**
 * keccak256 of the UTF-8 bytes of `text`. Identical to the browser (app/src/lib/hash.ts): the contract stores only this
 * hash, and the storage service is trusted only to keep the file available, so every reader recomputes it.
 */
export function contentHash(text: string): Hex {
  return keccak256(toBytes(text))
}

/** True when `text` hashes to `expected` (hex compared case-insensitively). */
export function hashMatches(text: string, expected: string): boolean {
  return contentHash(text).toLowerCase() === expected.toLowerCase()
}
