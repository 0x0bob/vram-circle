import { createPublicClient, http, type Address, type Hex } from 'viem'
import { projectFactoryAbi, projectVaultAbi } from '../app/src/generated/abis'

export interface ChainSubmission {
  id: number
  taskId: number
  contributor: Address
  contentHash: Hex
  status: number
  submittedAt: bigint
}

/**
 * Everything the agent and the API ever read from the chain. Read-only by construction: there is no write method and no
 * private key anywhere in this repo's server code.
 */
export interface ChainReader {
  isProject(vault: Address): Promise<boolean>
  roles(vault: Address, who: Address): Promise<{ creator: Address; isReviewer: boolean }>
  submissionCount(vault: Address): Promise<number>
  /** null when the submission does not exist. */
  getSubmission(vault: Address, id: number): Promise<ChainSubmission | null>
  getTask(vault: Address, taskId: number): Promise<{ specHash: Hex }>
}

const ZERO = '0x0000000000000000000000000000000000000000'

export function viemChainReader(o: { rpcUrl: string; factory: Address }): ChainReader {
  // The RPC URL (and any key in it) lives only in a server-side environment variable.
  const client = createPublicClient({ transport: http(o.rpcUrl, { batch: true, retryCount: 6 }) })
  return {
    isProject: (vault) =>
      client.readContract({ address: o.factory, abi: projectFactoryAbi, functionName: 'isProject', args: [vault] }),
    async roles(vault, who) {
      const [creator, isReviewer] = await Promise.all([
        client.readContract({ address: vault, abi: projectVaultAbi, functionName: 'creator' }),
        client.readContract({ address: vault, abi: projectVaultAbi, functionName: 'isReviewer', args: [who] }),
      ])
      return { creator, isReviewer }
    },
    async submissionCount(vault) {
      return Number(await client.readContract({ address: vault, abi: projectVaultAbi, functionName: 'submissionCount' }))
    },
    async getSubmission(vault, id) {
      const s = await client.readContract({
        address: vault,
        abi: projectVaultAbi,
        functionName: 'getSubmission',
        args: [BigInt(id)],
      })
      if (s.status === 0 || s.contributor === ZERO) return null
      return { id, taskId: s.taskId, contributor: s.contributor, contentHash: s.contentHash, status: s.status, submittedAt: s.submittedAt }
    },
    async getTask(vault, taskId) {
      const t = await client.readContract({ address: vault, abi: projectVaultAbi, functionName: 'getTask', args: [BigInt(taskId)] })
      return { specHash: t.specHash }
    },
  }
}
