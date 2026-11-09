import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const

vi.mock('../services/chain', () => ({
  readVault: vi.fn(),
  readTasks: vi.fn(),
  readSubmissions: vi.fn(),
  readReviewers: vi.fn(),
  readBlockTime: vi.fn(),
  readFeeBps: vi.fn(),
  readPaused: vi.fn(),
  readUsdcDecimals: vi.fn(),
}))

import * as chain from '../services/chain'
import { useProjectStore } from './project'

const info = (address: `0x${string}`, taskCount = 1) => ({
  address,
  creator: B,
  creatorBps: 5000,
  reviewPeriod: 604800,
  metadataURI: 'x',
  unreserved: 0n,
  reserved: 0n,
  taskCount,
  submissionCount: 0,
})
const task = (id: number) => ({ id }) as never

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(chain.readBlockTime).mockResolvedValue(1000n)
  vi.mocked(chain.readSubmissions).mockResolvedValue([])
  vi.mocked(chain.readReviewers).mockResolvedValue([])
})

describe('project store', () => {
  it('loads vault, tasks, submissions and reviewers from the chain', async () => {
    vi.mocked(chain.readVault).mockResolvedValue(info(A, 2))
    vi.mocked(chain.readTasks).mockResolvedValue([task(1), task(2)])
    vi.mocked(chain.readReviewers).mockResolvedValue([B])
    const p = useProjectStore()
    await p.load(A)
    expect(p.info?.address).toBe(A)
    expect(p.tasks).toHaveLength(2)
    expect(p.taskById.get(2)).toBeTruthy()
    expect(p.reviewers).toEqual([B])
    expect(p.error).toBeNull()
    expect(chain.readTasks).toHaveBeenCalledWith(A, 2)
  })

  it('reports read errors instead of throwing', async () => {
    vi.mocked(chain.readVault).mockRejectedValue(new Error('rpc down'))
    const p = useProjectStore()
    await p.load(A)
    expect(p.error).toBe('rpc down')
    expect(p.loading).toBe(false)
  })

  it('clears old data when switching project', async () => {
    vi.mocked(chain.readVault).mockResolvedValue(info(A))
    vi.mocked(chain.readTasks).mockResolvedValue([task(1)])
    const p = useProjectStore()
    await p.load(A)
    vi.mocked(chain.readVault).mockResolvedValue(info(B, 0))
    vi.mocked(chain.readTasks).mockResolvedValue([])
    await p.load(B)
    expect(p.vault).toBe(B)
    expect(p.tasks).toHaveLength(0)
  })

  it('ignores a slow response for a project that was already left', async () => {
    let resolveA!: (v: ReturnType<typeof info>) => void
    vi.mocked(chain.readVault).mockImplementation((v) =>
      v === A ? new Promise((r) => (resolveA = r)) : Promise.resolve(info(B, 0)),
    )
    vi.mocked(chain.readTasks).mockResolvedValue([])
    const p = useProjectStore()
    const first = p.load(A)
    await p.load(B)
    resolveA(info(A, 0))
    await first
    expect(p.vault).toBe(B)
    expect(p.info?.address).toBe(B)
  })

  it('refresh re-reads the current vault and does nothing without one', async () => {
    const p = useProjectStore()
    await p.refresh()
    expect(chain.readVault).not.toHaveBeenCalled()
    vi.mocked(chain.readVault).mockResolvedValue(info(A, 0))
    vi.mocked(chain.readTasks).mockResolvedValue([])
    await p.load(A)
    await p.refresh()
    expect(chain.readVault).toHaveBeenCalledTimes(2)
  })
})
