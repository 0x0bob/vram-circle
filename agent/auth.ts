import { recoverMessageAddress, type Address, type Hex } from 'viem'
import type { ChainReader, ChainSubmission } from './chain'

/** A signature is valid for at most this long, so a leaked one stops working quickly. */
export const MAX_ACCESS_SECONDS = 3600

/**
 * The text a wallet signs to read submissions and agent advice of ONE project on ONE chain. It is a login, not a
 * transaction: it authorizes nothing on-chain. Scoped by vault, chain and expiry so it cannot be replayed elsewhere.
 */
export function accessMessage(o: { vault: Address; chainId: number; expires: number }): string {
  return [
    'VRAM access',
    `vault: ${o.vault.toLowerCase()}`,
    `chain: ${o.chainId}`,
    `expires: ${o.expires}`,
    'This signature only lets this site show you submissions and agent advice for this project until it expires.',
    'It does not authorize any transaction.',
  ].join('\n')
}

/** Returns the signer, or null if the signature is malformed, expired, or valid longer than the maximum window. */
export async function authenticate(o: {
  vault: Address
  chainId: number
  expires: number
  signature: string
  now: number
}): Promise<Address | null> {
  if (!Number.isInteger(o.expires) || o.expires <= o.now || o.expires > o.now + MAX_ACCESS_SECONDS) return null
  try {
    return await recoverMessageAddress({
      message: accessMessage(o),
      signature: o.signature as Hex,
    })
  } catch {
    return null
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The project creator, any of its reviewers, and the contributor of that very submission. Nobody else. */
export async function canReadSubmission(chain: ChainReader, vault: Address, who: Address, sub: ChainSubmission): Promise<boolean> {
  if (same(sub.contributor, who)) return true
  const r = await chain.roles(vault, who)
  return same(r.creator, who) || r.isReviewer
}

/** Creator or reviewer of the project (used for running the agent and reading its advice). */
export async function isStaff(chain: ChainReader, vault: Address, who: Address): Promise<boolean> {
  const r = await chain.roles(vault, who)
  return same(r.creator, who) || r.isReviewer
}
