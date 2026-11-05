# Changelog

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
