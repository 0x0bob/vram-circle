// Copy detection by text similarity: Jaccard overlap of word bigrams after normalisation. Advice only, never a rejection:
// two real experts can write the same correct answer. (Embeddings are the later step; this is cheap and explainable.)

export const COPY_THRESHOLD = 0.8
/** Words beyond this are ignored, which keeps every comparison bounded. */
const MAX_WORDS = 20_000

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
}

function bigrams(text: string): Set<string> {
  const w = words(text)
  const out = new Set<string>()
  if (w.length === 0) return out
  if (w.length === 1) return out.add(w[0]!)
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`)
  return out
}

/** 0..1, symmetric. Empty text is 0 (nothing to compare), identical text is 1. */
export function similarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  const [small, large] = A.size <= B.size ? [A, B] : [B, A]
  let inter = 0
  for (const g of small) if (large.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

export interface CopyMatch {
  id: number
  similarity: number
}

/** The other submissions at or above the threshold, most similar first. */
export function findCopies(text: string, others: Array<{ id: number; text: string }>): CopyMatch[] {
  return others
    .map((o) => ({ id: o.id, similarity: similarity(text, o.text) }))
    .filter((m) => m.similarity >= COPY_THRESHOLD)
    .sort((x, y) => y.similarity - x.similarity)
}
