import { anthropicScoringClient } from '../../agent/anthropic'
import { VercelBlobStore } from '../../agent/blobstore'
import { viemChainReader } from '../../agent/chain'
import { RateLimiter, SpendLedger } from '../../agent/limits'
import { readConfig } from './config'
import type { ApiDeps } from './handlers'

let cached: ApiDeps | null = null

/**
 * Wires the real dependencies from the server environment. Built once per serverless instance, so the in-memory rate
 * limiters persist across warm invocations. Nothing here holds a chain key: the chain reader is read-only.
 */
export function getDeps(): ApiDeps {
  if (cached) return cached
  const c = readConfig(process.env)
  const store = new VercelBlobStore()
  cached = {
    store,
    chain: viemChainReader({ rpcUrl: c.rpcUrl, factory: c.factory }),
    scorer: c.anthropicKey ? anthropicScoringClient(c.anthropicKey) : null,
    model: c.model,
    chainId: c.chainId,
    now: Date.now,
    ledger: new SpendLedger({ store, capUsd: c.dailyCapUsd, maxCalls: c.dailyMaxCalls }),
    uploadLimiter: new RateLimiter(20, 60_000),
    screenLimiter: new RateLimiter(10, 60_000),
  }
  return cached
}
