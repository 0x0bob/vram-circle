import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { keccak256, toBytes } from 'viem'
import ReviewQueue from './ReviewQueue.vue'
import type { SubmissionView } from '../services/chain'

const sub = (id: number, deadline: bigint): SubmissionView => ({
  id,
  taskId: 1,
  contributor: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  contentHash: `0x${'ab'.repeat(32)}`,
  uri: 'ipfs://content',
  status: 1,
  submittedAt: 0n,
  reviewDeadline: deadline,
})

const NOW = 1_000n

describe('ReviewQueue', () => {
  it('shows an empty state', () => {
    const w = mount(ReviewQueue, { props: { submissions: [], now: NOW } })
    expect(w.find('[data-testid=queue-empty]').exists()).toBe(true)
  })

  it('shows the time left before auto-approve, from chain time', () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(1, NOW + 2n * 86400n + 3600n)], now: NOW } })
    expect(w.get('[data-testid=time-left]').text()).toBe('2d 1h')
  })

  it('emits approve with the submission id', async () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(7, NOW + 100n)], now: NOW } })
    await w.get('[data-testid=approve-7]').trigger('click')
    expect(w.emitted('approve')).toEqual([[7]])
  })

  it('cannot reject without a reason', async () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(3, NOW + 100n)], now: NOW } })
    expect(w.get('[data-testid=reject-3]').attributes('disabled')).toBeDefined()
    await w.get('[data-testid=reason-3]').setValue('   ')
    expect(w.get('[data-testid=reject-3]').attributes('disabled')).toBeDefined()
  })

  it('hashes the reason in the browser before emitting reject', async () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(3, NOW + 100n)], now: NOW } })
    await w.get('[data-testid=reason-3]').setValue('Copied from the spec')
    await w.get('[data-testid=reject-3]').trigger('click')
    const [id, hash, reason] = w.emitted('reject')![0] as [number, string, string]
    expect(id).toBe(3)
    expect(reason).toBe('Copied from the spec')
    expect(hash).toBe(keccak256(toBytes('Copied from the spec')))
  })

  it('disables decisions while busy', () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(1, NOW + 5n)], now: NOW, busy: true } })
    expect(w.get('[data-testid=approve-1]').attributes('disabled')).toBeDefined()
  })
})

describe('ReviewQueue: agent advice (advice only)', () => {
  it('shows no agent controls when the agent API is not available', () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(1, NOW + 100n)], now: NOW } })
    expect(w.find('[data-testid=open-details-1]').exists()).toBe(false)
  })

  it('offers to open content and advice per submission, and emits open', async () => {
    const w = mount(ReviewQueue, { props: { submissions: [sub(5, NOW + 100n)], now: NOW, agentEnabled: true } })
    await w.get('[data-testid=open-details-5]').trigger('click')
    expect(w.emitted('open')).toEqual([[5]])
  })

  it('shows the verified content and the agent advice once opened, and re-emits screen', async () => {
    const details = {
      5: { content: { status: 'match', text: 'the answer' }, advice: null, loading: false },
    }
    const w = mount(ReviewQueue, { props: { submissions: [sub(5, NOW + 100n)], now: NOW, agentEnabled: true, details } as never })
    expect(w.get('[data-testid=content-5]').text()).toBe('the answer')
    await w.get('[data-testid=agent-run-5]').trigger('click')
    expect(w.emitted('screen')).toEqual([[5]])
  })

  it('does not change the decision buttons: approve and reject stay human, and are enabled regardless of any score', () => {
    const details = {
      5: {
        content: { status: 'match', text: 'x' },
        advice: { ai: { status: 'ok', score: 3, reasons: ['bad'], injectionSuspected: false, model: 'm', promptVersion: 'v', usage: { input: 1, output: 1 }, truncated: false }, checks: { hash: { status: 'match' }, instructions: { status: 'match' }, format: null, injectionSuspected: false, copies: [] }, adviceOnly: true, createdAt: '' },
        loading: false,
      },
    }
    const w = mount(ReviewQueue, { props: { submissions: [sub(5, NOW + 100n)], now: NOW, agentEnabled: true, details } as never })
    expect(w.get('[data-testid=approve-5]').attributes('disabled')).toBeUndefined()
  })
})
