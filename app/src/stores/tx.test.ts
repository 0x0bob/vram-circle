import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { errorMessage, useTxStore } from './tx'

beforeEach(() => setActivePinia(createPinia()))

describe('tx store', () => {
  it('records a successful transaction with its hash', async () => {
    const tx = useTxStore()
    const ok = await tx.track('Deposit', async (setHash) => setHash('0xabc'))
    expect(ok).toBe(true)
    expect(tx.entries[0]).toMatchObject({ label: 'Deposit', status: 'success', hash: '0xabc' })
  })

  it('records a failure with a readable message and resolves false', async () => {
    const tx = useTxStore()
    const ok = await tx.track('Claim', async () => {
      throw Object.assign(new Error('long noisy text'), { shortMessage: 'User rejected the request.' })
    })
    expect(ok).toBe(false)
    expect(tx.entries[0]).toMatchObject({ status: 'error', message: 'User rejected the request.' })
  })

  it('shows pending while running and keeps only the newest entries', async () => {
    const tx = useTxStore()
    let release!: () => void
    const p = tx.track('Slow', () => new Promise<void>((r) => (release = r)))
    expect(tx.entries[0].status).toBe('pending')
    release()
    await p
    for (let i = 0; i < 12; i++) await tx.track(`t${i}`, async () => {})
    expect(tx.entries.length).toBeLessThanOrEqual(8)
  })

  it('dismisses an entry', async () => {
    const tx = useTxStore()
    await tx.track('A', async () => {})
    tx.dismiss(tx.entries[0].id)
    expect(tx.entries).toHaveLength(0)
  })

  it('errorMessage falls back sensibly', () => {
    expect(errorMessage({})).toBe('Transaction failed')
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
})

// Real messages seen on Arc testnet from a MetaMask user (2026-11-13), which said nothing a user could act on.
describe('errorMessage: what a user can act on', () => {
  it('tells the user to wait when the public RPC is rate limiting', () => {
    const e = Object.assign(new Error('x'), {
      shortMessage: 'The contract function "createProject" reverted with the following reason: Request is being rate limited.',
    })
    expect(errorMessage(e)).toMatch(/busy|wait/i)
    expect(errorMessage(e)).not.toMatch(/reverted/i)
  })

  it('recognises a rate limit by code too', () => {
    expect(errorMessage(Object.assign(new Error('Request exceeds defined limit'), { code: -32005 }))).toMatch(/busy|wait/i)
  })

  it('tells the user to unlock and connect the wallet account when the wallet refuses authorization', () => {
    const e = Object.assign(new Error('x'), {
      shortMessage: 'The requested method and/or account has not been authorized by the user.',
      code: 4100,
    })
    expect(errorMessage(e)).toMatch(/unlock|connect/i)
  })

  it('leaves a genuine contract revert untouched', () => {
    const e = Object.assign(new Error('x'), { shortMessage: 'The contract function "claim" reverted with the following reason: NotYet' })
    expect(errorMessage(e)).toBe('The contract function "claim" reverted with the following reason: NotYet')
  })
})
