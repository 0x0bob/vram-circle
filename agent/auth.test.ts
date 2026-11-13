import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { accessMessage, authenticate, canReadSubmission, MAX_ACCESS_SECONDS } from './auth'
import { ALICE, BOB, CREATOR, FakeChain, REVIEWER, VAULT } from './testkit'

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const // public Anvil key #1 (test only)
const account = privateKeyToAccount(key)
const NOW = 1_800_000_000
const chainId = 5042002

async function sign(vault = VAULT, expires = NOW + 600) {
  const message = accessMessage({ vault, chainId, expires })
  return { vault, expires, signature: await account.signMessage({ message }) }
}


// The exact text a wallet signs to sign in. The SAME literal is pinned in app/src/services/agentApi.test.ts: if either side
// changes this text, its own test fails, so browser and server cannot drift apart (the packages stay independent).
const GOLDEN_MESSAGE = [
  'VRAM access',
  'vault: 0x269fcaf4d50cfd5346d275a7546ce78fec29b111',
  'chain: 5042002',
  'expires: 1800000000',
  'This signature only lets this site show you submissions and agent advice for this project until it expires.',
  'It does not authorize any transaction.',
].join('\n')

describe('access message', () => {
  it('is exactly the pinned text (shared with the browser test)', () => {
    expect(accessMessage({ vault: VAULT, chainId: 5042002, expires: 1_800_000_000 })).toBe(GOLDEN_MESSAGE)
  })
  it('lowercases the vault so the signed text does not depend on address casing', () => {
    expect(accessMessage({ vault: VAULT.toUpperCase().replace('0X', '0x') as typeof VAULT, chainId: 5042002, expires: 1_800_000_000 })).toBe(GOLDEN_MESSAGE)
  })
})

describe('authenticate (wallet signature, no session, no server secret)', () => {
  it('recovers the signer of a fresh, correctly scoped message', async () => {
    const s = await sign()
    expect(await authenticate({ ...s, chainId, now: NOW })).toBe(account.address)
  })

  it('rejects an expired signature', async () => {
    const s = await sign(VAULT, NOW - 1)
    expect(await authenticate({ ...s, chainId, now: NOW })).toBeNull()
  })

  it('rejects a signature that lives longer than the maximum window', async () => {
    const s = await sign(VAULT, NOW + MAX_ACCESS_SECONDS + 60)
    expect(await authenticate({ ...s, chainId, now: NOW })).toBeNull()
  })

  it('a signature for one vault does not authenticate as the same wallet for another vault (replay)', async () => {
    const s = await sign(VAULT)
    const other = '0x0000000000000000000000000000000000000abc' as const
    const who = await authenticate({ ...s, vault: other, chainId, now: NOW })
    expect(who).not.toBe(account.address) // recovers some unrelated address, never the signer
  })

  it('a signature for another chain does not authenticate', async () => {
    const s = await sign()
    expect(await authenticate({ ...s, chainId: 1, now: NOW })).not.toBe(account.address)
  })

  it('rejects garbage', async () => {
    expect(await authenticate({ vault: VAULT, chainId, expires: NOW + 60, signature: '0x1234', now: NOW })).toBeNull()
    expect(await authenticate({ vault: VAULT, chainId, expires: NaN, signature: '0x', now: NOW })).toBeNull()
  })
})

describe('canReadSubmission', () => {
  const chain = new FakeChain()
  const sub = { id: 1, taskId: 1, contributor: ALICE, contentHash: `0x${'ab'.repeat(32)}` as const, status: 1, submittedAt: 0n }

  it('lets the creator, a reviewer and the contributor read, and nobody else', async () => {
    expect(await canReadSubmission(chain, VAULT, CREATOR, sub)).toBe(true)
    expect(await canReadSubmission(chain, VAULT, REVIEWER, sub)).toBe(true)
    expect(await canReadSubmission(chain, VAULT, ALICE, sub)).toBe(true)
    expect(await canReadSubmission(chain, VAULT, BOB, sub)).toBe(false)
  })

  it('compares addresses case-insensitively', async () => {
    expect(await canReadSubmission(chain, VAULT, ALICE.toUpperCase().replace('0X', '0x') as typeof ALICE, sub)).toBe(true)
  })
})
