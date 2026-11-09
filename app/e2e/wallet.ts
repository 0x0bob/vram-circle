import type { BrowserContext } from '@playwright/test'

/** Anvil default accounts (public test keys, unlocked in Anvil). */
export const accounts = {
  creator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  reviewer: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  contributorA: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  contributorB: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
} as const

/**
 * Test-only injected wallet (window.ethereum). It reports one fixed account and forwards every other
 * JSON-RPC request to Anvil, which signs eth_sendTransaction for its unlocked test accounts.
 * No private key and no backend are involved; the app code under test is unchanged.
 */
export async function installWallet(context: BrowserContext, account: string, rpcUrl: string) {
  await context.addInitScript(
    ({ account, rpcUrl }) => {
      const provider = {
        isMetaMask: true,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
          if (method === 'eth_chainId') return '0x7a69'
          if (method === 'wallet_switchEthereumChain') return null
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
          })
          const json = await res.json()
          if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data })
          return json.result
        },
        on: () => {},
        removeListener: () => {},
      }
      ;(window as unknown as { ethereum: unknown }).ethereum = provider
    },
    { account, rpcUrl },
  )
}

/** Plain JSON-RPC call to Anvil from the test process (time travel, reads). */
export async function anvil(rpcUrl: string, method: string, params: unknown[] = []) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}
