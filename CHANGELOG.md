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
