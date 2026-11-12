import { describe, expect, it } from 'vitest'
import { makeHistory } from './history'

describe('makeHistory', () => {
  it('uses hash history for the static build, so deep links survive a host with no SPA fallback', () => {
    const h = makeHistory('hash')
    h.push('/p/0xabc/review')
    expect(h.location).toBe('/p/0xabc/review')
    expect(window.location.hash).toBe('#/p/0xabc/review')
  })

  it('uses path history by default (local dev and the e2e)', () => {
    window.location.hash = ''
    const h = makeHistory(undefined)
    h.push('/creator')
    expect(window.location.pathname).toBe('/creator')
    expect(window.location.hash).toBe('')
  })
})
