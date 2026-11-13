// Client for the same-origin Vercel functions (/api): upload, content, and the quality agent. No keys are involved: reading
// submissions and agent advice is authorised by a short-lived WALLET SIGNATURE, and every file is re-checked against the hash
// that is stored on-chain, because the storage is trusted only to keep files available.
import type { Address, Hex } from 'viem'
import { hashText } from '../lib/hash'

const env = import.meta.env
/** The functions exist only on the deployed site (and `vercel dev`). Local dev and the e2e run without them. */
export const apiEnabled = env.VITE_API_ENABLED === '1'
const base = (env.VITE_API_BASE as string | undefined) ?? ''

export type FileStatus = 'match' | 'mismatch' | 'unavailable'
export type ReadStatus = FileStatus | 'unauthorized' | 'forbidden'

/** Same shape as agent/screen.ts `Advice` (kept in sync by hand; the server is the source of truth). */
export interface Advice {
  version: 1
  adviceOnly: true
  vault: Address
  submissionId: number
  taskId: number
  contentHash: Hex
  specHash: Hex
  createdAt: string
  checks: {
    hash: { status: FileStatus }
    instructions: { status: FileStatus }
    format: { ok: boolean; flags: string[]; chars: number } | null
    injectionSuspected: boolean
    copies: Array<{ id: number; similarity: number }>
  }
  ai:
    | {
        status: 'ok'
        score: number
        reasons: string[]
        injectionSuspected: boolean
        model: string
        promptVersion: string
        usage: { input: number; output: number }
        truncated: boolean
      }
    | { status: 'skipped'; reason: string }
    | { status: 'error'; reason: string; model: string; promptVersion: string }
}

export type AccessHeaders = Record<string, string>

/** Must stay byte-identical to agent/auth.ts `accessMessage` (a test compares them). */
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

/** Signature lifetime. The server accepts up to 60 minutes; 50 leaves room for clock skew. */
const LIFETIME_SECONDS = 3000
/** Sign again when less than this is left. */
const RESIGN_BELOW_SECONDS = 300

/**
 * Wallet-signature credentials, cached per project so a reviewer is asked to sign once, not on every click. A signature
 * authorises reading only; it cannot move funds or send a transaction.
 */
export function createAccess(o: { chainId: number; sign: (message: string) => Promise<string>; now?: () => number }) {
  const now = o.now ?? Date.now
  const cache = new Map<string, Promise<{ expires: number; headers: AccessHeaders }>>()
  return {
    async headers(vault: Address): Promise<AccessHeaders> {
      const key = vault.toLowerCase()
      const nowSec = Math.floor(now() / 1000)
      const hit = cache.get(key)
      if (hit) {
        const v = await hit.catch(() => null)
        if (v && v.expires - nowSec > RESIGN_BELOW_SECONDS) return v.headers
      }
      const expires = nowSec + LIFETIME_SECONDS
      const p = o.sign(accessMessage({ vault, chainId: o.chainId, expires })).then((signature) => ({
        expires,
        headers: { 'x-vram-expires': String(expires), 'x-vram-signature': signature },
      }))
      cache.set(key, p)
      try {
        return (await p).headers
      } catch (e) {
        cache.delete(key) // a rejected prompt must be retryable
        throw e
      }
    },
  }
}

async function apiError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null)
  return new Error(body?.error ?? `Request failed (${res.status})`)
}

/** Uploads text and checks the server hashed exactly what the browser did. The contract gets this hash, so it must be right. */
export async function uploadText(kind: 'spec' | 'submission', text: string): Promise<{ hash: Hex; uri: string }> {
  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, text }),
  })
  if (!res.ok) throw await apiError(res)
  const r = (await res.json()) as { hash: Hex; uri: string }
  if (r.hash.toLowerCase() !== hashText(text).toLowerCase()) {
    throw new Error('The storage service returned a different hash than your browser computed. Nothing was submitted.')
  }
  return { hash: r.hash, uri: r.uri }
}

/** Task instructions are public: fetched by the on-chain spec hash and verified against it. */
export async function fetchSpec(specHash: Hex): Promise<{ status: FileStatus; text: string | null }> {
  const res = await fetch(`${base}/api/content?kind=spec&hash=${specHash}`)
  if (!res.ok) return { status: 'unavailable', text: null }
  const text = await res.text()
  return hashText(text).toLowerCase() === specHash.toLowerCase() ? { status: 'match', text } : { status: 'mismatch', text }
}

/** A submission's text, read with a wallet signature and verified against the hash stored on-chain. */
export async function fetchSubmission(
  o: { vault: Address; submissionId: number; hash: Hex },
  access: AccessHeaders,
): Promise<{ status: ReadStatus; text: string | null }> {
  const q = new URLSearchParams({ kind: 'submission', hash: o.hash, vault: o.vault, submissionId: String(o.submissionId) })
  const res = await fetch(`${base}/api/content?${q}`, { headers: access })
  if (res.status === 401) return { status: 'unauthorized', text: null }
  if (res.status === 403) return { status: 'forbidden', text: null }
  if (!res.ok) return { status: 'unavailable', text: null }
  const text = await res.text()
  return hashText(text).toLowerCase() === o.hash.toLowerCase() ? { status: 'match', text } : { status: 'mismatch', text }
}

export async function runScreen(o: { vault: Address; submissionId: number }, access: AccessHeaders): Promise<Advice> {
  const res = await fetch(`${base}/api/screen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...access },
    body: JSON.stringify({ vault: o.vault, submissionId: o.submissionId }),
  })
  if (!res.ok) throw await apiError(res)
  return (await res.json()) as Advice
}

export async function fetchAdvice(o: { vault: Address; submissionId: number }, access: AccessHeaders): Promise<Advice[]> {
  const q = new URLSearchParams({ vault: o.vault, submissionId: String(o.submissionId) })
  const res = await fetch(`${base}/api/advice?${q}`, { headers: access })
  if (!res.ok) throw await apiError(res)
  return ((await res.json()) as { advice: Advice[] }).advice
}
