import { isAddress, type Address } from 'viem'
import { authenticate, canReadSubmission, isStaff } from '../../agent/auth'
import type { ChainReader } from '../../agent/chain'
import { contentHash, hashMatches } from '../../agent/hash'
import type { RateLimiter, SpendLedger } from '../../agent/limits'
import { getAdvice, HttpError, screenSubmission } from '../../agent/screen'
import type { ScoringClient } from '../../agent/scorer'
import type { BlobStore } from '../../agent/store'

/** Largest upload, in bytes of UTF-8. Task instructions and answers are text; this is generous for both. */
export const MAX_UPLOAD_BYTES = 64 * 1024

export interface ApiDeps {
  store: BlobStore
  chain: ChainReader
  /** null when ANTHROPIC_API_KEY is not set: the non-AI checks still run. */
  scorer: ScoringClient | null
  model: string
  chainId: number
  now: () => number
  ledger: SpendLedger
  uploadLimiter: RateLimiter
  screenLimiter: RateLimiter
}

type Kind = 'spec' | 'submission'
const isKind = (k: unknown): k is Kind => k === 'spec' || k === 'submission'
const HASH = /^0x[0-9a-fA-F]{64}$/

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

const fail = (status: number, error: string, headers: Record<string, string> = {}) => json(status, { error }, headers)

const clientKey = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

function limited(limiter: RateLimiter, req: Request): Response | null {
  const r = limiter.check(clientKey(req))
  return r.allowed ? null : fail(429, 'Too many requests. Try again shortly.', { 'retry-after': String(Math.ceil(r.retryAfterMs / 1000)) })
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Runs a handler body and turns every failure into a JSON error that never contains internal details. */
async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message)
    return fail(500, 'Internal error')
  }
}

/** The wallet that signed the access message in the request headers, or null. */
async function signer(req: Request, deps: ApiDeps, vault: Address): Promise<Address | null> {
  const signature = req.headers.get('x-vram-signature')
  const expires = Number(req.headers.get('x-vram-expires'))
  if (!signature) return null
  return authenticate({ vault, chainId: deps.chainId, expires, signature, now: Math.floor(deps.now() / 1000) })
}

// -------------------------------------------------------------------------------------------------- POST /api/upload
export async function uploadHandler(req: Request, deps: ApiDeps): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'POST only', { allow: 'POST' })
  const tooMany = limited(deps.uploadLimiter, req)
  if (tooMany) return tooMany
  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES * 2 + 1024) return fail(413, 'Upload too large')

  return guarded(async () => {
    const b = await body(req)
    if (!b) return fail(400, 'Expected a JSON object')
    if (!isKind(b.kind)) return fail(400, 'kind must be "spec" or "submission"')
    if (typeof b.text !== 'string' || b.text.length === 0) return fail(400, 'text must be a non-empty string')
    const bytes = new TextEncoder().encode(b.text).length
    if (bytes > MAX_UPLOAD_BYTES) return fail(413, `Upload too large (max ${MAX_UPLOAD_BYTES} bytes)`)

    const hash = contentHash(b.text)
    await deps.store.put(`${b.kind}/${hash}.txt`, b.text)
    const uri = `${new URL(req.url).origin}/api/content?kind=${b.kind}&hash=${hash}`
    return json(200, { hash, uri, bytes })
  })
}

// --------------------------------------------------------------------------------------------------- GET /api/content
export async function contentHandler(req: Request, deps: ApiDeps): Promise<Response> {
  if (req.method !== 'GET') return fail(405, 'GET only', { allow: 'GET' })
  return guarded(async () => {
    const q = new URL(req.url).searchParams
    const kind = q.get('kind')
    const hash = q.get('hash') ?? ''
    if (!isKind(kind)) return fail(400, 'kind must be "spec" or "submission"')
    if (!HASH.test(hash)) return fail(400, 'hash must be a 32-byte hex string')

    if (kind === 'submission') {
      // Submissions are the product: only the creator, a reviewer, or the contributor may read them.
      const vault = q.get('vault') ?? ''
      const id = Number(q.get('submissionId'))
      if (!isAddress(vault, { strict: false }) || !Number.isInteger(id) || id < 1) return fail(400, 'vault and submissionId are required')
      const who = await signer(req, deps, vault as Address)
      if (!who) return fail(401, 'Sign in with your wallet to read this submission')
      if (!(await deps.chain.isProject(vault as Address))) return fail(404, 'Unknown project')
      const sub = await deps.chain.getSubmission(vault as Address, id)
      // The hash must be the one stored on-chain for THIS submission: no reading arbitrary files through this route.
      if (!sub || sub.contentHash.toLowerCase() !== hash.toLowerCase()) return fail(404, 'Not found')
      if (!(await canReadSubmission(deps.chain, vault as Address, who, sub))) return fail(403, 'Not allowed')
    }

    const text = await deps.store.get(`${kind}/${hash}.txt`)
    if (text === null) return fail(404, 'Not found')
    // The store is trusted only to keep files available. Re-check the bytes against the hash before serving them.
    if (!hashMatches(text, hash)) return fail(502, 'Stored content does not match its hash')
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': kind === 'spec' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      },
    })
  })
}

/** Shared by screen and advice: valid vault + id, a signature, an existing project, and a creator/reviewer signer. */
async function staffGate(
  req: Request,
  deps: ApiDeps,
  vault: unknown,
  submissionId: unknown,
): Promise<{ vault: Address; id: number } | Response> {
  if (typeof vault !== 'string' || !isAddress(vault, { strict: false })) return fail(400, 'vault must be an address')
  const id = typeof submissionId === 'number' ? submissionId : Number(submissionId)
  if (!Number.isInteger(id) || id < 1 || (typeof submissionId === 'string' && submissionId.trim() === '')) {
    return fail(400, 'submissionId must be a positive integer')
  }
  const who = await signer(req, deps, vault as Address)
  if (!who) return fail(401, 'Sign in with your wallet')
  if (!(await deps.chain.isProject(vault as Address))) return fail(404, 'Unknown project')
  if (!(await isStaff(deps.chain, vault as Address, who))) return fail(403, 'Only the creator or a reviewer of this project can use the agent')
  return { vault: vault as Address, id }
}

// ---------------------------------------------------------------------------------------------------- POST /api/screen
export async function screenHandler(req: Request, deps: ApiDeps): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'POST only', { allow: 'POST' })
  const tooMany = limited(deps.screenLimiter, req)
  if (tooMany) return tooMany
  return guarded(async () => {
    const b = await body(req)
    if (!b) return fail(400, 'Expected a JSON object')
    const gate = await staffGate(req, deps, b.vault, b.submissionId)
    if (gate instanceof Response) return gate
    const advice = await screenSubmission(deps, { vault: gate.vault, submissionId: gate.id })
    return json(200, advice)
  })
}

// ---------------------------------------------------------------------------------------------------- GET /api/advice
export async function adviceHandler(req: Request, deps: ApiDeps): Promise<Response> {
  if (req.method !== 'GET') return fail(405, 'GET only', { allow: 'GET' })
  return guarded(async () => {
    const q = new URL(req.url).searchParams
    const gate = await staffGate(req, deps, q.get('vault'), q.get('submissionId'))
    if (gate instanceof Response) return gate
    return json(200, { advice: await getAdvice(deps.store, gate.vault, gate.id) })
  })
}
