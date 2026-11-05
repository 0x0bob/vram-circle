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
