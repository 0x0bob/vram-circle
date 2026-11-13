import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const fetchSubmission = vi.fn()
const fetchAdvice = vi.fn()
const runScreen = vi.fn()
vi.mock('../services/agentApi', () => ({
  fetchSubmission: (...a: unknown[]) => fetchSubmission(...a),
  fetchAdvice: (...a: unknown[]) => fetchAdvice(...a),
  runScreen: (...a: unknown[]) => runScreen(...a),
}))

import { useReviewDetails } from './useReviewDetails'

const vault = '0x269fcaf4d50cfd5346d275a7546ce78fec29b111'
const subs = [{ id: 3, contentHash: `0x${'ab'.repeat(32)}` }]
const headers = { 'x-vram-expires': '1', 'x-vram-signature': '0xs' }
const access = { headers: vi.fn(async () => headers) }
const advice = { adviceOnly: true, submissionId: 3 }

const make = () => useReviewDetails({ vault: ref(vault as `0x${string}`), submissions: () => subs as never, access })

beforeEach(() => {
  fetchSubmission.mockReset()
  fetchAdvice.mockReset()
  runScreen.mockReset()
  access.headers.mockClear()
})

describe('useReviewDetails', () => {
  it('open: signs in once, loads the verified content and the newest stored advice', async () => {
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'the answer' })
    fetchAdvice.mockResolvedValue([advice, { ...advice, old: true }])
    const d = make()
    const p = d.open(3)
    expect(d.details[3]?.content.status).toBe('loading') // visible immediately
    await p
    expect(d.details[3]).toMatchObject({ content: { status: 'match', text: 'the answer' }, advice, loading: false })
    expect(access.headers).toHaveBeenCalledWith(vault)
    expect(fetchSubmission).toHaveBeenCalledWith({ vault, submissionId: 3, hash: subs[0]!.contentHash }, headers)
  })

  it('shows the content even when there is no advice yet or the advice request fails', async () => {
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'the answer' })
    fetchAdvice.mockRejectedValue(new Error('boom'))
    const d = make()
    await d.open(3)
    expect(d.details[3]?.content.status).toBe('match')
    expect(d.details[3]?.advice).toBeNull()
  })

  it('a rejected wallet prompt leaves a retryable state instead of an error crash', async () => {
    access.headers.mockRejectedValueOnce(new Error('User rejected the request.'))
    const d = make()
    await d.open(3)
    expect(d.details[3]?.content.status).toBe('unauthorized')
    expect(fetchSubmission).not.toHaveBeenCalled()
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'ok' })
    fetchAdvice.mockResolvedValue([])
    await d.open(3) // retry works
    expect(d.details[3]?.content.status).toBe('match')
  })

  it('does not read an unknown submission', async () => {
    const d = make()
    await d.open(99)
    expect(fetchSubmission).not.toHaveBeenCalled()
  })

  it('screen: runs the agent, shows the loading state, then the advice', async () => {
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'x' })
    fetchAdvice.mockResolvedValue([])
    let release!: (a: unknown) => void
    runScreen.mockReturnValue(new Promise((r) => (release = r)))
    const d = make()
    await d.open(3)
    const p = d.screen(3)
    expect(d.details[3]?.loading).toBe(true)
    release(advice)
    await p
    expect(d.details[3]).toMatchObject({ loading: false, advice, error: undefined })
    expect(runScreen).toHaveBeenCalledWith({ vault, submissionId: 3 }, headers)
  })

  it('screen: keeps a request error visible and retryable (rate limit, spend cap, network)', async () => {
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'x' })
    fetchAdvice.mockResolvedValue([])
    runScreen.mockRejectedValue(new Error('Too many requests. Try again shortly.'))
    const d = make()
    await d.open(3)
    await d.screen(3)
    expect(d.details[3]).toMatchObject({ loading: false, advice: null, error: 'Too many requests. Try again shortly.' })
  })

  it('ignores a second screen click while one is running (no double spend)', async () => {
    fetchSubmission.mockResolvedValue({ status: 'match', text: 'x' })
    fetchAdvice.mockResolvedValue([])
    let release!: (a: unknown) => void
    runScreen.mockReturnValue(new Promise((r) => (release = r)))
    const d = make()
    await d.open(3)
    const p1 = d.screen(3)
    const p2 = d.screen(3)
    release(advice)
    await Promise.all([p1, p2])
    expect(runScreen).toHaveBeenCalledTimes(1)
  })
})
