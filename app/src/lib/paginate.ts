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
}

/**
 * Runs `fetchRange` over [from, to] in chunks of at most `chunk` blocks, in order, and concatenates the results.
 * If a chunk fails, it is split in half and retried, down to `minChunk`; after that the error is rethrown.
 */
export async function fetchPaged<T>(
  from: bigint,
  to: bigint,
  chunk: bigint,
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  { minChunk = 100n }: PagedOptions = {},
): Promise<T[]> {
  const out: T[] = []
  let size = chunk
  let a = from
  while (a <= to) {
    const b = a + size - 1n > to ? to : a + size - 1n
    try {
      out.push(...(await fetchRange(a, b)))
      a = b + 1n
    } catch (err) {
      const half = size / 2n
      if (half < minChunk || half < 1n) throw err
      size = half
    }
  }
  return out
}
