// Read-only chain access with viem. No signing here; every write goes through the wallet (see useTx).
import { createPublicClient, erc20Abi, http, type Address, type Hex } from 'viem'
import { appConfig, chain } from '../config'
import { projectFactoryAbi, projectVaultAbi } from '../generated/abis'

export const publicClient = createPublicClient({ chain, transport: http(appConfig.rpcUrl) })

export interface VaultInfo {
  address: Address
  creator: Address
  creatorBps: number
  reviewPeriod: number
  metadataURI: string
  unreserved: bigint
  reserved: bigint
  taskCount: number
  submissionCount: number
}

export interface TaskView {
  id: number
  reward: bigint
  feePerSubmission: bigint
  deadline: bigint
  specHash: Hex
  maxSubmissions: number
  maxPerContributor: number
  active: number
  claimed: number
  reservedUnits: number
  allowlistOnly: boolean
  closed: boolean
}

export interface SubmissionView {
  id: number
  taskId: number
  contributor: Address
  contentHash: Hex
  uri: string
  status: number
  submittedAt: bigint
  reviewDeadline: bigint
}

const factory = (): Address => {
  if (!appConfig.factory) throw new Error('VITE_FACTORY_ADDRESS is not set')
  return appConfig.factory
}
const usdc = (): Address => {
  if (!appConfig.usdc) throw new Error('VITE_USDC_ADDRESS is not set')
  return appConfig.usdc
}

export async function readBlockTime(): Promise<bigint> {
  return (await publicClient.getBlock()).timestamp
}

export async function readFeeBps(): Promise<number> {
  return publicClient.readContract({ address: factory(), abi: projectFactoryAbi, functionName: 'feeBps' })
}

export async function readPaused(): Promise<boolean> {
  return publicClient.readContract({ address: factory(), abi: projectFactoryAbi, functionName: 'paused' })
}

export async function readUsdcDecimals(): Promise<number> {
  return publicClient.readContract({ address: usdc(), abi: erc20Abi, functionName: 'decimals' })
}

export async function readUsdcBalance(owner: Address): Promise<bigint> {
  return publicClient.readContract({ address: usdc(), abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}

export async function readAllowance(owner: Address, spender: Address): Promise<bigint> {
  return publicClient.readContract({
    address: usdc(),
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })
}

/** Vaults created via the factory, optionally only those created by `creator`. (An indexer replaces this later.) */
export async function findProjects(creator?: Address): Promise<Address[]> {
  const logs = await publicClient.getContractEvents({
    address: factory(),
    abi: projectFactoryAbi,
    eventName: 'ProjectCreated',
    args: creator ? { creator } : undefined,
    fromBlock: appConfig.deployBlock,
    toBlock: 'latest',
  })
  return logs.map((l) => l.args.vault as Address)
}

export async function isProject(vault: Address): Promise<boolean> {
  return publicClient.readContract({
    address: factory(),
    abi: projectFactoryAbi,
    functionName: 'isProject',
    args: [vault],
  })
}

export async function readVault(vault: Address): Promise<VaultInfo> {
  const base = { address: vault, abi: projectVaultAbi } as const
  const [creator, creatorBps, reviewPeriod, metadataURI, unreserved, reserved, taskCount, submissionCount] =
    await Promise.all([
      publicClient.readContract({ ...base, functionName: 'creator' }),
      publicClient.readContract({ ...base, functionName: 'creatorBps' }),
      publicClient.readContract({ ...base, functionName: 'reviewPeriod' }),
      publicClient.readContract({ ...base, functionName: 'metadataURI' }),
      publicClient.readContract({ ...base, functionName: 'unreserved' }),
      publicClient.readContract({ ...base, functionName: 'reserved' }),
      publicClient.readContract({ ...base, functionName: 'taskCount' }),
      publicClient.readContract({ ...base, functionName: 'submissionCount' }),
    ])
  return {
    address: vault,
    creator,
    creatorBps,
    reviewPeriod,
    metadataURI,
    unreserved,
    reserved,
    taskCount: Number(taskCount),
    submissionCount: Number(submissionCount),
  }
}

export async function readTask(vault: Address, id: number): Promise<TaskView> {
  const t = await publicClient.readContract({
    address: vault,
    abi: projectVaultAbi,
    functionName: 'getTask',
    args: [BigInt(id)],
  })
  return { id, ...t }
}

export async function readTasks(vault: Address, count: number): Promise<TaskView[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => readTask(vault, i + 1)))
}

/** All submissions of a vault: ids and uris from Submitted events, live status from getSubmission. */
export async function readSubmissions(vault: Address, reviewPeriod: number): Promise<SubmissionView[]> {
  const logs = await publicClient.getContractEvents({
    address: vault,
    abi: projectVaultAbi,
    eventName: 'Submitted',
    fromBlock: appConfig.deployBlock,
    toBlock: 'latest',
  })
  return Promise.all(
    logs.map(async (l) => {
      const id = Number(l.args.submissionId)
      const s = await publicClient.readContract({
        address: vault,
        abi: projectVaultAbi,
        functionName: 'getSubmission',
        args: [BigInt(id)],
      })
      return {
        id,
        taskId: s.taskId,
        contributor: s.contributor,
        contentHash: s.contentHash,
        uri: l.args.uri as string,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewDeadline: s.submittedAt + BigInt(reviewPeriod),
      }
    }),
  )
}

/** Current reviewer set, replayed from ReviewerSet events. */
export async function readReviewers(vault: Address): Promise<Address[]> {
  const logs = await publicClient.getContractEvents({
    address: vault,
    abi: projectVaultAbi,
    eventName: 'ReviewerSet',
    fromBlock: appConfig.deployBlock,
    toBlock: 'latest',
  })
  const set = new Map<Address, boolean>()
  for (const l of logs) set.set(l.args.reviewer as Address, Boolean(l.args.allowed))
  return [...set].filter(([, on]) => on).map(([a]) => a)
}

export async function readIsReviewer(vault: Address, who: Address): Promise<boolean> {
  return publicClient.readContract({ address: vault, abi: projectVaultAbi, functionName: 'isReviewer', args: [who] })
}

export async function readAllowlisted(vault: Address, taskId: number, who: Address): Promise<boolean> {
  return publicClient.readContract({
    address: vault,
    abi: projectVaultAbi,
    functionName: 'allowlisted',
    args: [BigInt(taskId), who],
  })
}

export async function readContributorCount(vault: Address, taskId: number, who: Address): Promise<number> {
  return publicClient.readContract({
    address: vault,
    abi: projectVaultAbi,
    functionName: 'contributorCount',
    args: [BigInt(taskId), who],
  })
}
