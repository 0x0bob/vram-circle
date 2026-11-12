import type { Address } from 'viem'

export interface NetworkInfo {
  id: number
  name: string
  rpcUrl: string
  explorerUrl?: string
  /** ERC-20 interface address of USDC. Use this for every balance and transfer. */
  usdc?: Address
  /** Decimals of USDC through the ERC-20 interface. */
  usdcDecimals: number
  /** Native currency (gas). On Arc this is USDC with 18 decimals: a different unit from the ERC-20 interface. */
  nativeSymbol: string
  nativeDecimals: number
}

// Source: docs.arc.io (Arc network details), as verified by the project owner in Nov 2026.
export const ARC_TESTNET: NetworkInfo = {
  id: 5042002,
  name: 'Arc Testnet',
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  usdc: '0x3600000000000000000000000000000000000000',
  usdcDecimals: 6,
  nativeSymbol: 'USDC',
  nativeDecimals: 18,
}

/** Known for reference only. MUST NOT be used: resolveNetwork refuses it. Mainnet needs an explicit instruction. */
export const ARC_MAINNET: NetworkInfo = {
  id: 5042,
  name: 'Arc',
  rpcUrl: 'https://rpc.mainnet.arc.io',
  usdcDecimals: 6,
  nativeSymbol: 'USDC',
  nativeDecimals: 18,
}

export const LOCAL: NetworkInfo = {
  id: 31337,
  name: 'Anvil (local)',
  rpcUrl: 'http://127.0.0.1:8545',
  usdcDecimals: 6,
  nativeSymbol: 'ETH',
  nativeDecimals: 18,
}

export class MainnetDisabledError extends Error {
  constructor() {
    super('Arc mainnet is disabled in this build. Testnet only.')
  }
}

export function resolveNetwork(chainId: number): NetworkInfo {
  if (chainId === ARC_MAINNET.id) throw new MainnetDisabledError()
  if (chainId === ARC_TESTNET.id) return ARC_TESTNET
  if (chainId === LOCAL.id) return LOCAL
  throw new Error(`Unsupported chain id ${chainId}`)
}

export function txUrl(n: NetworkInfo, hash: string): string | null {
  return n.explorerUrl ? `${n.explorerUrl}/tx/${hash}` : null
}

/** Banner text when VITE_FACTORY_ADDRESS / VITE_USDC_ADDRESS are missing. */
export function notConfiguredMessage(n: NetworkInfo): string {
  return n.id === ARC_TESTNET.id
    ? 'Contracts not deployed on Arc testnet yet'
    : 'The app is not configured. Set VITE_FACTORY_ADDRESS and VITE_USDC_ADDRESS (local dev: run node scripts/dev.mjs).'
}

/** Polling cadence: the base rate on a local chain, 4x slower on a public RPC (Arc testnet rate-limits with HTTP 429). */
export function pollInterval(n: NetworkInfo, baseMs: number): number {
  return n.id === LOCAL.id ? baseMs : baseMs * 4
}
