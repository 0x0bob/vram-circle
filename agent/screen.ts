import type { Address, Hex } from 'viem'
import type { ChainReader } from './chain'
import { detectInjection, formatChecks, type FormatResult } from './checks'
import { contentHash, hashMatches } from './hash'
import { estimateUsd, costUsd, type SpendLedger } from './limits'
import { buildScoringRequest, PROMPT_VERSION } from './rubric'
import { MAX_OUTPUT_TOKENS, scoreSubmission, type ScoringClient } from './scorer'
import { findCopies, type CopyMatch } from './similarity'
import type { BlobStore } from './store'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type FileStatus = 'match' | 'mismatch' | 'unavailable'

export type AiAdvice =
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

/** One stored result: everything needed to audit it later. Advice only. */
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
    format: FormatResult | null
    injectionSuspected: boolean
    copies: CopyMatch[]
  }
  ai: AiAdvice
}

export interface ScreenDeps {
  chain: ChainReader
  store: BlobStore
  /** null when no API key is configured: only the non-AI checks run. */
  scorer: ScoringClient | null
  model: string
  ledger: SpendLedger
  now: () => number
}

/** At most this many other submissions of the same task are compared, newest first. */
const MAX_COMPARE = 50

const advicePrefix = (vault: Address, id: number) => `advice/${vault.toLowerCase()}/${id}/`

export async function getAdvice(store: BlobStore, vault: Address, id: number): Promise<Advice[]> {
  const files = (await store.list(advicePrefix(vault, id))).sort().reverse()
  const out: Advice[] = []
  for (const f of files) {
    const text = await store.get(f)
    if (text) out.push(JSON.parse(text) as Advice)
  }
  return out
}

/**
 * Runs the checks for one on-chain submission and stores the result. Read-only towards the chain, and it only ever produces
 * advice: no field of the result approves, rejects or pays anything.
 */
export async function screenSubmission(deps: ScreenDeps, o: { vault: Address; submissionId: number }): Promise<Advice> {
  const { chain, store } = deps
  const vault = o.vault.toLowerCase() as Address

  if (!(await chain.isProject(vault))) throw new HttpError(404, 'Unknown project')
  const count = await chain.submissionCount(vault)
  if (!Number.isInteger(o.submissionId) || o.submissionId < 1 || o.submissionId > count) throw new HttpError(404, 'Unknown submission')
  const sub = await chain.getSubmission(vault, o.submissionId)
  if (!sub) throw new HttpError(404, 'Unknown submission')
  const { specHash } = await chain.getTask(vault, sub.taskId)

  // 1. The submission text, verified against the hash stored on-chain.
  const content = await store.get(`submission/${sub.contentHash}.txt`)
  const hash: FileStatus = content === null ? 'unavailable' : hashMatches(content, sub.contentHash) ? 'match' : 'mismatch'

  // 2. The task instructions, verified against the on-chain spec hash.
  const instructions = await store.get(`spec/${specHash}.txt`)
  const spec: FileStatus = instructions === null ? 'unavailable' : hashMatches(instructions, specHash) ? 'match' : 'mismatch'

  // 3. Free checks, only on content that really is what was submitted.
  const usable = hash === 'match' && content !== null
  const format = usable ? formatChecks(content) : null
  const injectionSuspected = usable ? detectInjection(content) : false
  let copies: CopyMatch[] = []
  if (usable) {
    const others: Array<{ id: number; text: string }> = []
    for (let id = count; id >= 1 && others.length < MAX_COMPARE; id--) {
      if (id === o.submissionId) continue
      const other = await chain.getSubmission(vault, id)
      if (!other || other.taskId !== sub.taskId) continue
      const text = await store.get(`submission/${other.contentHash}.txt`)
      if (text !== null && hashMatches(text, other.contentHash)) others.push({ id, text })
    }
    copies = findCopies(content, others)
  }

  const base = {
    version: 1 as const,
    adviceOnly: true as const,
    vault,
    submissionId: o.submissionId,
    taskId: sub.taskId,
    contentHash: sub.contentHash,
    specHash,
    createdAt: new Date(deps.now()).toISOString(),
    checks: { hash: { status: hash }, instructions: { status: spec }, format, injectionSuspected, copies },
  }

  // 4. A stored AI result for the same inputs is reused: no second model call, no second spend.
  const prior = (await getAdvice(store, vault, o.submissionId))[0]
  if (
    prior?.ai.status === 'ok' &&
    prior.contentHash === sub.contentHash &&
    prior.specHash === specHash &&
    prior.ai.promptVersion === PROMPT_VERSION &&
    prior.ai.model === deps.model
  ) {
    return prior
  }

  const ai = await runAi(deps, { usable, hash, spec, content, instructions })
  const advice: Advice = { ...base, ai }
  await store.put(`${advicePrefix(vault, o.submissionId)}${String(deps.now()).padStart(15, '0')}.json`, JSON.stringify(advice))
  return advice
}

async function runAi(
  deps: ScreenDeps,
  s: { usable: boolean; hash: FileStatus; spec: FileStatus; content: string | null; instructions: string | null },
): Promise<AiAdvice> {
  if (s.hash === 'mismatch') return { status: 'skipped', reason: 'hash_mismatch' }
  if (!s.usable || s.content === null) return { status: 'skipped', reason: 'content_unavailable' }
  if (!deps.scorer) return { status: 'skipped', reason: 'no_api_key' }
  if (s.spec === 'mismatch') return { status: 'skipped', reason: 'instructions_mismatch' }
  if (s.spec === 'unavailable' || s.instructions === null) return { status: 'skipped', reason: 'instructions_unavailable' }

  const p = buildScoringRequest({ instructions: s.instructions, submission: s.content })
  const gate = await deps.ledger.check(estimateUsd(p.system.length + p.user.length, MAX_OUTPUT_TOKENS))
  if (!gate.ok) return { status: 'skipped', reason: gate.reason }

  const r = await scoreSubmission(deps.scorer, { instructions: s.instructions, submission: s.content, model: deps.model })
  if (r.status === 'error') {
    return { status: 'error', reason: r.reason, model: r.model, promptVersion: r.promptVersion }
  }
  await deps.ledger.record(costUsd(r.usage))
  return {
    status: 'ok',
    score: r.output.score,
    reasons: r.output.reasons,
    injectionSuspected: r.output.injection_suspected,
    model: r.model,
    promptVersion: r.promptVersion,
    usage: r.usage,
    truncated: r.truncated,
  }
}

export { contentHash }
