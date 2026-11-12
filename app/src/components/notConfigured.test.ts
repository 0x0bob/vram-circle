import { describe, expect, it } from 'vitest'
import { ARC_TESTNET, LOCAL } from '../networks'
import { notConfiguredMessage } from '../networks'

describe('notConfiguredMessage', () => {
  it('says the contracts are not deployed on Arc testnet yet', () => {
    expect(notConfiguredMessage(ARC_TESTNET)).toBe('Contracts not deployed on Arc testnet yet')
  })
  it('points local developers at the dev script', () => {
    expect(notConfiguredMessage(LOCAL)).toMatch(/dev\.mjs/)
  })
})
