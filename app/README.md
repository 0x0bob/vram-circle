# VRAM app (Vue 3 + Vite + TypeScript)

Wallet and contract calls: viem + @wagmi/vue. State: Pinia. Routing: Vue Router.
Every write is signed in the user's own wallet. There is no backend and no key in this app.

## Local development (no Arc needed)

From the repo root, with Foundry installed (or in `.tools/foundry`):

    node scripts/dev.mjs        # Anvil + MockUSDC + steps 1-2 + 100,000 test USDC for Anvil accounts 1-5 + the app

Add network 31337 (http://127.0.0.1:8545) to your wallet and import Anvil test keys (public, local only).

## Tests

    npm test                    # Vitest (components, stores, helpers)
    node ../scripts/e2e.mjs     # Playwright on a fresh Anvil chain (needs `npx playwright install chromium` once)

## Generated ABIs

`src/generated/abis.ts` comes from the Foundry build. After changing a contract:

    forge build && node scripts/gen-abis.mjs

CI fails if the file is out of date.

## Pending

- TODO(verify): Circle Wallets connector (`src/wallets/circle.ts`).
- Arc testnet values (chain 5042002, RPC, explorer, USDC) are in `src/networks.ts`, from docs.arc.io as verified by the project owner. Mainnet (5042) is defined but refused.
- The indexer will replace the event scans in `src/services/chain.ts`.
