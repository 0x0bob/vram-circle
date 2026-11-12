import type { Address } from 'viem'
import { defineChain } from 'viem'
import { foundry } from 'viem/chains'

const env = import.meta.env

/** Runtime config comes from VITE_* variables (scripts/dev.mjs writes app/.env.local for local dev). */
export const appConfig = {
  chainId: Number(env.VITE_CHAIN_ID ?? 31337),
  rpcUrl: (env.VITE_RPC_URL as string | undefined) ?? 'http://127.0.0.1:8545',
  factory: env.VITE_FACTORY_ADDRESS as Address | undefined,
  usdc: env.VITE_USDC_ADDRESS as Address | undefined,
  /** First block to scan for events. Keep at the factory deploy block to keep log queries small. */
  deployBlock: BigInt((env.VITE_DEPLOY_BLOCK as string | undefined) ?? '0'),
}

export const chain =
  appConfig.chainId === 31337
    ? foundry
    : defineChain({
        id: appConfig.chainId,
        // TODO(verify): Arc chain name, native currency decimals and explorer from Circle docs.
        name: 'Arc',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: { default: { http: [appConfig.rpcUrl] } },
      })

export const isConfigured = Boolean(appConfig.factory && appConfig.usdc)
