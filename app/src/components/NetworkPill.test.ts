import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NetworkPill from './NetworkPill.vue'
import { ARC_TESTNET, LOCAL } from '../networks'

describe('NetworkPill', () => {
  it('labels Arc testnet as a testnet', () => {
    const w = mount(NetworkPill, { props: { network: ARC_TESTNET } })
    expect(w.get('[data-testid=network-pill]').text()).toBe('Arc Testnet')
    expect(w.get('[data-testid=network-pill]').attributes('title')).toMatch(/testnet/i)
  })
  it('labels the local chain', () => {
    const w = mount(NetworkPill, { props: { network: LOCAL } })
    expect(w.get('[data-testid=network-pill]').text()).toBe('Anvil (local)')
  })
})
