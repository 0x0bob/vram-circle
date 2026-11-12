// Bounded block-range pagination for eth_getLogs. Public RPCs reject wide ranges
// (Arc testnet: "requested range too large" at 10,000 blocks), so scans run in chunks.

/** Splits the inclusive range [from, to] into consecutive ranges of at most `chunk` blocks. */
export function blockRanges(from: bigint, to: bigint, chunk: bigint): Array<[bigint, bigint]> {
  if (chunk <= 0n) throw new Error('chunk must be positive')
  const out: Array<[bigint, bigint]> = []
  for (let a = from; a <= to; a += chunk) {
    const b = a + chunk - 1n
    out.push([a, b > to ? to : b])
  }
  return out
}

export interface PagedOptions {
  /** Smallest chunk to fall back to before giving up. */
  minChunk?: bigint
  /** Retries of the SAME chunk after a rate-limit error, with exponential backoff. */
  maxRetries?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

/** True for rate-limit errors: JSON-RPC -32005, HTTP 429, or the usual wording, anywhere in the cause chain. */
export function isRateLimit(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 4) return false
  const e = err as { code?: number; status?: number; message?: string; cause?: unknown }
  if (e.code === -32005 || e.status === 429) return true
  if (typeof e.message === 'string' && /rate limit|too many requests|429|exceeds defined limit/i.test(e.message)) return true
  return isRateLimit(e.cause, depth + 1)
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Runs `fetchRange` over [from, to] in chunks of at most `chunk` blocks, in order, and concatenates the results.
 * A rate-limit error waits (exponential backoff) and retries the same chunk. Any other error splits the chunk in half
 * and retries, down to `minChunk`; after that the error is rethrown.
 */
export async function fetchPaged<T>(
  from: bigint,
  to: bigint,
  chunk: bigint,
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  { minChunk = 100n, maxRetries = 6, sleep = realSleep }: PagedOptions = {},
): Promise<T[]> {
  const out: T[] = []
  let size = chunk
  let a = from
  let retries = 0
  while (a <= to) {
    const b = a + size - 1n > to ? to : a + size - 1n
    try {
      out.push(...(await fetchRange(a, b)))
      a = b + 1n
      retries = 0
    } catch (err) {
      if (isRateLimit(err)) {
        if (retries >= maxRetries) throw err
        await sleep(400 * 2 ** retries++)
        continue
      }
      const half = size / 2n
      if (half < minChunk || half < 1n) throw err
      size = half
    }
  }
  return out
}
