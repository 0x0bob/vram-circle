import { isAddress, type Address } from 'viem'
import deployment from '../../deployments/arc-testnet.json'

// Source: docs.arc.io (Arc network details), verified by the project owner. Must match script/Deploy.s.sol.
const ARC_TESTNET_CHAIN_ID = 5042002

export interface ServerConfig {
  chainId: number
  /** Server-side only. May carry a provider key: it is never sent to the browser. */
  rpcUrl: string
  factory: Address
  /** null: no key configured, the agent runs the non-AI checks only. */
  anthropicKey: string | null
  model: string
  dailyCapUsd: number
  dailyMaxCalls: number
}

/** A positive finite number, or the fallback. Never "unlimited": a bad value must not remove a safety cap. */
function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

export function readConfig(env: Record<string, string | undefined>): ServerConfig {
  const chainId = Number(env.CHAIN_ID ?? ARC_TESTNET_CHAIN_ID)
  if (chainId !== ARC_TESTNET_CHAIN_ID) throw new Error(`CHAIN_ID ${env.CHAIN_ID} is not Arc testnet (${ARC_TESTNET_CHAIN_ID}). Testnet only.`)

  const factory = env.FACTORY_ADDRESS ?? deployment.factory
  if (!isAddress(factory, { strict: false })) throw new Error('FACTORY_ADDRESS is not a valid address')

  return {
    chainId,
    rpcUrl: env.ARC_RPC_URL?.trim() || 'https://rpc.testnet.arc.io',
    factory: factory as Address,
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    // TODO(verify): model ID against the current Claude API docs. Haiku 5.5 is the cheap tier (cached list 2026-10-06).
    model: env.AGENT_MODEL?.trim() || 'claude-haiku-5-5',
    dailyCapUsd: positive(env.AGENT_DAILY_CAP_USD, 2),
    dailyMaxCalls: Math.floor(positive(env.AGENT_DAILY_MAX_CALLS, 200)),
  }
}
