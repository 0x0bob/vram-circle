import { get, list, put } from '@vercel/blob'
import type { BlobStore } from './store'

/**
 * Vercel Blob adapter. Every blob is PRIVATE: nothing is readable by URL, only through our API, which applies the access
 * rules. Needs BLOB_READ_WRITE_TOKEN (created with the Blob store in the Vercel project). Paths are content addresses,
 * so overwriting the same path with the same bytes is a no-op by construction.
 */
export class VercelBlobStore implements BlobStore {
  async put(path: string, text: string): Promise<void> {
    await put(path, text, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/plain; charset=utf-8',
    })
  }

  async get(path: string): Promise<string | null> {
    const res = await get(path, { access: 'private', useCache: false })
    if (!res || res.statusCode !== 200) return null
    return new Response(res.stream).text()
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor, limit: 1000 })
      out.push(...page.blobs.map((b) => b.pathname))
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return out
  }
}
