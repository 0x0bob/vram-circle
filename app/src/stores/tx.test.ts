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
