import { describe, expect, it } from 'vitest'
import { COPY_THRESHOLD, findCopies, similarity } from './similarity'

const a = `Answer 1 is safer because the Move borrow checker rejects the dangling reference in the second
implementation, while the first moves the coin into the vault and never aliases it afterwards.`

describe('similarity', () => {
  it('is 1 for identical text and symmetric', () => {
    expect(similarity(a, a)).toBe(1)
    const b = 'completely different text about something else entirely, nothing in common with the other one'
    expect(similarity(a, b)).toBe(similarity(b, a))
  })
  it('ignores case, punctuation and whitespace differences (a lazy copy)', () => {
    const copy = a.toUpperCase().replace(/,/g, ' ;').replace(/\s+/g, '   ')
    expect(similarity(a, copy)).toBeGreaterThanOrEqual(COPY_THRESHOLD)
  })
  it('stays high for a near copy with a few words changed', () => {
    const near = a.replace('safer', 'more secure').replace('second', '2nd')
    expect(similarity(a, near)).toBeGreaterThan(0.6)
  })
  it('is low for unrelated answers to the same question', () => {
    const other = 'I would pick the first option. Its ownership model is simpler and cheaper to audit in practice.'
    expect(similarity(a, other)).toBeLessThan(0.3)
  })
  it('handles empty and very short text without throwing', () => {
    expect(similarity('', '')).toBe(0)
    expect(similarity('a', 'a')).toBe(1)
    expect(similarity('hi', 'ho')).toBeLessThanOrEqual(1)
  })
})

describe('findCopies', () => {
  const others = [
    { id: 2, text: a.replace(/\n/g, ' ') },
    { id: 3, text: 'A totally different answer about gas costs and storage layout of the vault module in detail.' },
    { id: 4, text: a.replace('safer', 'more secure') },
  ]
  it('returns only the others above the threshold, most similar first, with the score', () => {
    const r = findCopies(a, others)
    expect(r.map((x) => x.id)).toEqual([2, 4])
    expect(r[0]!.similarity).toBeGreaterThanOrEqual(r[1]!.similarity)
    expect(r.every((x) => x.similarity >= COPY_THRESHOLD)).toBe(true)
  })
  it('returns nothing when there are no other submissions', () => {
    expect(findCopies(a, [])).toEqual([])
  })
  it('is bounded: a huge input does not blow up the comparison', () => {
    const big = 'word '.repeat(200_000)
    const t0 = Date.now()
    findCopies(big, [{ id: 1, text: big }])
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})
