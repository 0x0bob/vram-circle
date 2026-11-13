import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentAdvice from './AgentAdvice.vue'
import type { Advice } from '../services/agentApi'

const base: Advice = {
  version: 1,
  adviceOnly: true,
  vault: '0x269fcaf4d50cfd5346d275a7546ce78fec29b111',
  submissionId: 7,
  taskId: 1,
  contentHash: `0x${'ab'.repeat(32)}`,
  specHash: `0x${'cd'.repeat(32)}`,
  createdAt: '2026-11-13T10:00:00.000Z',
  checks: {
    hash: { status: 'match' },
    instructions: { status: 'match' },
    format: { ok: true, flags: [], chars: 120 },
    injectionSuspected: false,
    copies: [],
  },
  ai: {
    status: 'ok',
    score: 72,
    reasons: ['Correct ownership reasoning.', 'Misses the gas angle.'],
    injectionSuspected: false,
    model: 'claude-haiku-5-5',
    promptVersion: 'rubric-v1',
    usage: { input: 900, output: 120 },
    truncated: false,
  },
}
const mountIt = (advice: Advice | null, extra: Record<string, unknown> = {}) =>
  mount(AgentAdvice, { props: { submissionId: 7, advice, loading: false, ...extra } })

describe('AgentAdvice', () => {
  it('says it is advice only and that the reviewer decides', () => {
    expect(mountIt(base).text()).toMatch(/advice only/i)
  })

  it('shows the score, the reasons, and the audit trail (model, prompt version)', () => {
    const w = mountIt(base)
    expect(w.get('[data-testid=agent-score-7]').text()).toContain('72')
    expect(w.text()).toContain('Correct ownership reasoning.')
    expect(w.text()).toContain('Misses the gas angle.')
    expect(w.text()).toContain('claude-haiku-5-5')
    expect(w.text()).toContain('rubric-v1')
  })

  it('offers to run the screening when there is no advice yet, and emits run', async () => {
    const w = mountIt(null)
    await w.get('[data-testid=agent-run-7]').trigger('click')
    expect(w.emitted('run')).toHaveLength(1)
  })

  it('disables the run button while loading', () => {
    expect(mountIt(null, { loading: true }).get('[data-testid=agent-run-7]').attributes('disabled')).toBeDefined()
  })

  it('shows a clear warning when the content does not match the hash on-chain, and no score', () => {
    const w = mountIt({
      ...base,
      checks: { ...base.checks, hash: { status: 'mismatch' }, format: null },
      ai: { status: 'skipped', reason: 'hash_mismatch' },
    })
    expect(w.get('[data-testid=warn-hash-7]').text()).toMatch(/does not match/i)
    expect(w.find('[data-testid=agent-score-7]').exists()).toBe(false)
  })

  it('warns when the answer seems to address the scorer, without hiding the score', () => {
    const w = mountIt({ ...base, checks: { ...base.checks, injectionSuspected: true } })
    expect(w.get('[data-testid=warn-injection-7]').text()).toMatch(/scorer|grader/i)
    expect(w.get('[data-testid=agent-score-7]').text()).toContain('72')
  })

  it('lists similar submissions with the similarity', () => {
    const w = mountIt({ ...base, checks: { ...base.checks, copies: [{ id: 2, similarity: 0.91 }] } })
    expect(w.get('[data-testid=agent-copies-7]').text()).toContain('#2')
    expect(w.get('[data-testid=agent-copies-7]').text()).toContain('91%')
  })

  it('explains why there is no AI score instead of showing nothing', () => {
    const cases: Record<string, RegExp> = {
      no_api_key: /not configured/i,
      daily_cap: /budget/i,
      instructions_unavailable: /instructions/i,
      content_unavailable: /not found|unavailable/i,
    }
    for (const [reason, re] of Object.entries(cases)) {
      const w = mountIt({ ...base, ai: { status: 'skipped', reason } })
      expect(w.text()).toMatch(re)
      expect(w.find('[data-testid=agent-score-7]').exists()).toBe(false)
    }
  })

  it('shows an AI error as an error, never as a score', () => {
    const w = mountIt({ ...base, ai: { status: 'error', reason: 'invalid_output', model: 'm', promptVersion: 'rubric-v1' } })
    expect(w.text()).toMatch(/failed/i)
    expect(w.find('[data-testid=agent-score-7]').exists()).toBe(false)
  })

  it('lists format flags and notes truncation', () => {
    const w = mountIt({
      ...base,
      checks: { ...base.checks, format: { ok: false, flags: ['too_short', 'repetitive'], chars: 12 } },
      ai: { ...(base.ai as Extract<Advice['ai'], { status: 'ok' }>), truncated: true },
    })
    expect(w.text()).toMatch(/very short/i)
    expect(w.text()).toMatch(/repeats/i)
    expect(w.text()).toMatch(/truncated/i)
  })

  it('shows a request error with a retry', async () => {
    const w = mountIt(null, { error: 'Too many requests. Try again shortly.' })
    expect(w.text()).toContain('Too many requests')
    await w.get('[data-testid=agent-run-7]').trigger('click')
    expect(w.emitted('run')).toBeTruthy()
  })
})
