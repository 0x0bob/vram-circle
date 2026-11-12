# Changelog

## Unreleased: Step 3b (Arc testnet)

- Arc testnet values (chain 5042002, RPC, explorer, USDC `0x3600...0000`) replace the `TODO(verify)` markers, cited
  to docs.arc.io as verified by the project owner. Mainnet (5042) is defined but refused by the app and by the deploy script.
- `script/Deploy.s.sol`: pins the verified USDC on testnet, blocks mainnet, requires distinct non-zero treasury and
  guardian, and writes `deployments/arc-testnet.json` only on a real broadcast (never on a dry run). Keys come only from a
  Foundry encrypted keystore (`--account vram-deployer`), never a file or env var.
- Fork tests (`test/fork`, skipped without `ARC_TESTNET_RPC_URL`): the core flow against the real Arc USDC. Foundry cannot run Arc's
  system precompiles, so `ArcPrecompileEmu` stands in for the two the token calls (inferred from traces).
- Finding: Arc's ERC-20 USDC balance is the native balance / 1e12. The UI now shows the gas balance separately (18 decimals).
- App: event scans are paginated in bounded block ranges from the deploy block (Arc's RPC rejects >= 10,000 blocks), with halving
  on RPC range errors. Regression: viem's 4s `eth_blockNumber` cache hid just-mined blocks from the scan (`cacheTime: 0`).
- App: explorer links on transactions, static build for Arc testnet (`scripts/build-arc-testnet.mjs`, hash routing).
- Arc testnet deployed and verified (Timelock, FeeRouter, ProjectFactory, vault implementation); `deployments/arc-testnet.json`;
  core-flow smoke test on the real USDC recorded in `docs/testnet-smoke.md`.
- App: JSON-RPC batching and slower polling on public RPCs. Regression: the project page sent ~12 separate `eth_call`s and the
  public RPC answered HTTP 429 (`batching.test.ts`).
- Static build for Vercel (`vercel.json`, path routing + SPA rewrite). The build succeeds without `deployments/arc-testnet.json`
  and shows "Contracts not deployed on Arc testnet yet". Favicon added.
- CLAUDE.md section 11: testnet roles are plain wallets, real multisigs required before mainnet; USDC native-backing note.

## Unreleased: Step 1 (ProjectFactory + ProjectVault)

- `ProjectFactory`: EIP-1167 vault clones, guardian pause (new projects/tasks/submissions only),
  timelock-gated params (fee <= 15%, min review period, fee router, guardian).
- `ProjectVault`: deposit, reviewers, tasks (reward + fee reserved up front, fee snapshotted per task),
  allowlist/openTask, submit, approve/reject (reasonHash required), auto-approve claim after `reviewPeriod`,
  pull-payment `claim`, `closeTask`, `withdrawUnreserved`.
- Tests: unit, fuzz, regression (`test/regression`), invariants (`test/invariant`).
- `script/Deploy.s.sol` (dry-run first, testnet only).
- Not included yet (later steps): FeeRouter, Timelock, challenges, DatasetRegistry, LicenseMarket.
- Open: Arc USDC address and chain ID are TODO(verify); Slither not yet run.

## Unreleased: Factory invariants + Slither baseline

- Added `test/invariant/FactoryInvariant.t.sol`: fee <= 1500 bps, only the timelock changes params,
  review period never below the minimum in force at creation, pause never blocks claim/withdrawUnreserved.
  Mutation check: making `claim` `whenNotPaused` makes the pause invariant fail.
- Slither baseline (`slither . --exclude-dependencies`): 0 high, 0 medium. Low/info only:
  missing-zero-check (vault `initialize` creator, always msg.sender from the factory), reentrancy-benign and
  reentrancy-events in `createProject` (call into our own freshly cloned vault), block.timestamp comparisons
  (intended: deadlines and review windows), mixed pragma (OpenZeppelin ^0.8.20 vs ours ^0.8.24). None suppressed.
- Slither runs from a git-ignored `.venv`.

## Unreleased: Step 2 (FeeRouter, Timelock, guardian wiring)

- `FeeRouter`: permissionless `distribute()` forwards the whole USDC balance to `treasury`; `setTreasury`
  is timelock-only; no other way to move funds out.
- `Timelock`: OZ `TimelockController`, no external admin (self-administered), effective delay floored at 48h
  (`getMinDelay()` returns max(configured, 48h), so a lower `updateDelay` cannot shorten it).
- `script/Deploy.s.sol`: Timelock -> FeeRouter -> ProjectFactory. TREASURY/GUARDIAN placeholders are accepted
  only on chain 31337; any other chain reverts if they are unset. Dry run only, nothing broadcast.
- New invariants (`test/invariant/ProtocolInvariant.t.sol`): 6 (privileged roles never receive USDC, no leaks,
  no unauthorized state change), 7 (pause never blocks claim, withdrawUnreserved or distribute), 9 (fee equals
  the per-task snapshotted bps, never above 15%). Mutation check: paying half the fee fails the fee invariants.
- Test fix: `vm.prank` covers only the next call, so `vm.prank(x); v.f(a % v.n())` pranked the inner view call.
  Fixed in `closeTask` of `VaultHandler` (step 1), so closeTask is now really exercised by that invariant suite.
- Known design limit for invariant 6: the timelock can re-point `feeRouter` and `treasury` after the 48h delay.
  That is the intended timelocked power, not a hidden path; the handler only points them at known addresses.

## Unreleased: Step 3 (frontend)

- `/app`: Vue 3 + Vite + TypeScript, viem, @wagmi/vue, Pinia, Vue Router. Pages: connect wallet (injected first,
  Circle Wallets hook is TODO(verify)), creator dashboard, project and task pages, reviewer queue, contributor page.
- Every write is a wallet-signed transaction; reads come from the chain via viem. No backend, no keys.
- ABIs are generated from the Foundry build (`scripts/gen-abis.mjs`); CI fails if `app/src/generated/abis.ts` is stale.
- Local dev: `node scripts/dev.mjs` (Anvil + `script/DeployLocal.s.sol` with MockUSDC + steps 1-2 + test USDC + app).
- Tests: 32 Vitest tests; one Playwright e2e on Anvil (create, fund, task, submit, approve, claim, auto-approve via
  time travel, close, withdraw). CI job `app` runs typecheck, Vitest, build and the e2e.
- TypeScript pinned to 5.9: latest (7.0) is newer than the Vue tooling supports.
- `script/Deploy.s.sol` now shares `_deployProtocol` with `DeployLocal` (same deploy order and addresses).
