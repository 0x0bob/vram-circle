import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CostSummary from './CostSummary.vue'

const mountIt = (props: Partial<{ reward: bigint; feeBps: number; maxSubmissions: number }> = {}) =>
  mount(CostSummary, { props: { reward: 100_000_000n, feeBps: 1000, maxSubmissions: 3, decimals: 6, ...props } })

describe('CostSummary', () => {
  it('shows the contributor reward and the fee on top as separate lines', () => {
    const w = mountIt()
    expect(w.get('[data-testid=cost-reward]').text()).toBe('100 USDC')
    expect(w.get('[data-testid=cost-fee]').text()).toBe('10 USDC')
    expect(w.get('[data-testid=cost-per]').text()).toBe('110 USDC')
    expect(w.get('[data-testid=cost-total]').text()).toBe('330 USDC')
  })

  it('says the creator pays the fee, not the contributor', () => {
    expect(mountIt().text()).toContain('not the contributor')
  })

  it('follows the protocol fee', () => {
    const w = mountIt({ feeBps: 1500, maxSubmissions: 2 })
    expect(w.get('[data-testid=cost-fee]').text()).toBe('15 USDC')
    expect(w.get('[data-testid=cost-total]').text()).toBe('230 USDC')
    expect(w.text()).toContain('15%')
  })
})
