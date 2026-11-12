import { createConfig, http, injected } from '@wagmi/core'
import { appConfig, chain } from './config'
// TODO(verify): add the Circle Wallets connector from ./wallets/circle once verified.

export const wagmiConfig = createConfig({
  chains: [chain],
  // Injected wallet first (MetaMask, Rabby, ...). Every write is signed by the user's wallet.
  connectors: [injected()],
  transports: { [chain.id]: http(appConfig.rpcUrl, { batch: true }) },
})

declare module '@wagmi/vue' {
  interface Register {
    config: typeof wagmiConfig
  }
}
