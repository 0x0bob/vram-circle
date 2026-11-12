import type { Address } from 'viem'
import { defineChain } from 'viem'
import { foundry } from 'viem/chains'
import { resolveNetwork, txUrl } from './networks'

const env = import.meta.env

/** The network is picked by VITE_CHAIN_ID (31337 local, 5042002 Arc testnet). Mainnet is refused. */
export const network = resolveNetwork(Number(env.VITE_CHAIN_ID ?? 31337))

/**
 * Runtime config comes from VITE_* variables. scripts/dev.mjs writes app/.env.local for local dev;
 * scripts/build-arc-testnet.mjs fills them from deployments/arc-testnet.json for the static site.
 */
export const appConfig = {
  chainId: network.id,
  rpcUrl: (env.VITE_RPC_URL as string | undefined) ?? network.rpcUrl,
  factory: env.VITE_FACTORY_ADDRESS as Address | undefined,
  usdc: ((env.VITE_USDC_ADDRESS as string | undefined) ?? network.usdc) as Address | undefined,
  /** First block to scan for events (the factory deploy block from deployments/<network>.json). */
  deployBlock: BigInt((env.VITE_DEPLOY_BLOCK as string | undefined) ?? '0'),
  /** Max blocks per eth_getLogs request. Public RPCs reject wide ranges (Arc testnet rejects >= 10,000; default per network in networks.ts). */
  logChunk: BigInt((env.VITE_LOG_CHUNK as string | undefined) ?? network.logChunk),
}

export const chain =
  network.id === 31337
    ? foundry
    : defineChain({
        id: network.id,
        name: network.name,
        // Gas is native USDC with 18 decimals on Arc. This is NOT the 6-decimal ERC-20 USDC used for payments.
        nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: network.nativeDecimals },
        rpcUrls: { default: { http: [appConfig.rpcUrl] } },
        blockExplorers: network.explorerUrl ? { default: { name: 'Arcscan', url: network.explorerUrl } } : undefined,
      })

export const isConfigured = Boolean(appConfig.factory && appConfig.usdc)

export const explorerTx = (hash: string) => txUrl(network, hash)
