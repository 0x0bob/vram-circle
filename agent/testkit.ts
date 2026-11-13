// Test helpers shared by the agent and API tests. Not imported by production code.
import type { Address, Hex } from 'viem'
import { contentHash } from './hash'
import type { ChainReader, ChainSubmission } from './chain'
import type { ScoringClient, ScoreRequest } from './scorer'
import { MemoryStore } from './store'

export const VAULT = '0x269fcaf4d50cfd5346d275a7546ce78fec29b111' as Address
export const CREATOR = '0x1111111111111111111111111111111111111111' as Address
export const REVIEWER = '0x2222222222222222222222222222222222222222' as Address
export const ALICE = '0x3333333333333333333333333333333333333333' as Address
export const BOB = '0x4444444444444444444444444444444444444444' as Address

export const SPEC = 'Rank the two Move answers and explain which one is safer.'

export class FakeChain implements ChainReader {
  subs: ChainSubmission[] = []
  specHashes = new Map<number, Hex>()
  projects = new Set<string>([VAULT.toLowerCase()])
  creator: Address = CREATOR
  reviewers = new Set<string>([REVIEWER.toLowerCase()])
  reads = 0

  async isProject(vault: Address) {
    return this.projects.has(vault.toLowerCase())
  }
  async roles(_vault: Address, who: Address) {
    return { creator: this.creator, isReviewer: this.reviewers.has(who.toLowerCase()) }
  }
  async submissionCount() {
    return this.subs.length
  }
  async getSubmission(_vault: Address, id: number) {
    this.reads++
    return this.subs[id - 1] ?? null
  }
  async getTask(_vault: Address, taskId: number) {
    return { specHash: this.specHashes.get(taskId) ?? contentHash(SPEC) }
  }

  /** Adds a submission and stores its content under its hash, like the upload API does. */
  async add(store: MemoryStore, contributor: Address, text: string, taskId = 1): Promise<number> {
    const h = contentHash(text)
    await store.put(`submission/${h}.txt`, text)
    this.subs.push({ id: this.subs.length + 1, taskId, contributor, contentHash: h, status: 1, submittedAt: 1_000n })
    return this.subs.length
  }
}

export function fakeScorer(parsed: unknown = { score: 61, reasons: ['Reasonable.'], injection_suspected: false }) {
  const calls: ScoreRequest[] = []
  const client: ScoringClient = {
    async parse(req) {
      calls.push(req)
      return { parsed, stopReason: 'end_turn', usage: { input: 1000, output: 100 } }
    },
  }
  return { client, calls }
}
