/**
 * Serialises async tasks and starts each at least `gapMs` after the previous one started. Public RPCs rate-limit bursts
 * (Arc testnet: about 4 requests in a row, then HTTP 429 / -32005); spacing log requests avoids the errors entirely.
 * A gap of 0 adds no delay (local chain).
 */
export function createPacer(gapMs: number) {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = 0
  return function pace<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      const wait = lastStart + gapMs - Date.now()
      if (gapMs > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastStart = Date.now()
      return task()
    })
    tail = run.catch(() => undefined) // a failure must not block later tasks
    return run
  }
}
