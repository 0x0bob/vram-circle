/**
 * Minimal file store used by the API and the agent. It is TRUSTED ONLY TO KEEP FILES AVAILABLE: it never holds funds, and
 * every reader recomputes keccak256(content) against the hash stored on-chain, so a tampered file is detected, not believed.
 */
export interface BlobStore {
  put(path: string, text: string): Promise<void>
  /** null when the file does not exist. */
  get(path: string): Promise<string | null>
  /** Paths (not contents) that start with `prefix`. */
  list(prefix: string): Promise<string[]>
}

/** In-memory store for tests and local use. */
export class MemoryStore implements BlobStore {
  readonly files = new Map<string, string>()

  async put(path: string, text: string): Promise<void> {
    this.files.set(path, text)
  }
  async get(path: string): Promise<string | null> {
    return this.files.get(path) ?? null
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort()
  }
}
