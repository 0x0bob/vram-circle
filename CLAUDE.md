# CLAUDE.md: VRAM MVP on Arc

**Version 2: simplified MVP.** This replaces the earlier full design (verifier-signed payouts, challenge windows, dispute module, $VRAM staking, backing pools). Do not build anything from that design unless this file is updated to include it. Section 9 lists what is deferred.

Read this whole file before writing code.

## 1. What we're building

**VRAM: a training data marketplace (human + agent).**

- **Creators** open projects and fund them with USDC to create high-quality, expert-leaning training data.
- **Contributors** (humans) complete tasks such as ranking, writing examples, expert evaluation, and structured data creation.
- **Agents** help with quality: pre-screening, scoring, and filtering low-quality work. In the MVP they **advise only**; humans make every decision on-chain.
- **Creators or their named reviewers** accept or reject work. Accepted work is paid in USDC from the project vault.
- **Finished datasets** are published and licensed by **buyers** in USDC.
- **Revenue share**: license revenue is split between the creator and the contributors whose work is in the dataset.
- **Challenges** find experts. A creator runs an open challenge with hard questions, and participants are ranked on a leaderboard. The top scorers are invited to the creator's paid expert tasks.
- VRAM keeps a 10% fee, which goes to the treasury.

Chain: **Arc** (Circle's L1). It is EVM-compatible, pays gas in USDC, and finalizes in under a second. Write everything in Solidity.

## 2. Safety rules (non-negotiable)

1. **No backend can move user funds.** Every state change is a transaction signed by the user's wallet, or a permissionless call anyone can make. The indexer, API, and agent are read-only towards contracts.
2. **Pull payments only.** Contracts record what is owed, and the owner calls `claim()`. Never push USDC in a loop, because one blacklisted address must not block others.
3. **Funds are locked before work starts.** A task can't open unless the vault holds its full budget plus the fee.
4. **Agents have no on-chain power in the MVP.** The agent holds no key that any contract trusts.
5. **Reviewer power is bounded.** A reviewer can only approve or reject submissions of their own project. Approval pays only the submitting contributor, only once, and only the task's fixed reward.
6. **Contributor protection.** A submission not reviewed within `reviewPeriod` (default 7 days) can be claimed as approved. A rejection must include a `reasonHash`. Rejected submissions can never be part of a licensed dataset.
7. **Admin can pause, but can't take funds.** The guardian multisig can pause new projects, tasks, and submissions. Pause never blocks claims of money already owed, or creators withdrawing unreserved budget.
8. **Bounded, timelocked parameters.** Fee (≤ 15%), default review period, and treasury address change only through a 48h timelock.
9. **No upgradeable proxies for vaults.** Vaults are immutable EIP-1167 clones. New versions mean a new factory.
10. **Creators can always exit unspent money.** Closing a task releases its unused reservation back to the creator.

If a feature can only be built by breaking one of these rules, stop and ask.

## 3. Economics (MVP constants)

| Item | Value |
|---|---|
| Payment currency | USDC only (ERC-20 interface on Arc; read `decimals()`) |
| Protocol fee | 10% (`1000` bps, max `1500`) on task payouts and license sales |
| Fee destination | Treasury multisig, via `FeeRouter` |
| Task reward | Fixed per accepted submission, paid in full to the contributor (the fee is on top) |
| License split | Set per project at creation, immutable: `creatorBps + contributorBps = 10000` (suggested 50/50) |
| Token | **None at launch.** `$VRAM`, buyback/burn, and staking are deferred (section 9). |

## 4. Flows

### Task work
```
Creator: createProject → deposit USDC
Creator: createTask(reward, maxSubmissions, deadline, specHash, open|allowlist)
         vault reserves reward × maxSubmissions × 1.10
Contributor: submit(taskId, contentHash, uri)            [signed tx]
Agent (off-chain): pre-screens, scores, flags → shown to reviewer in UI
Reviewer: approve(submissionId) or reject(submissionId, reasonHash)   [signed tx]
          if no decision by submittedAt + reviewPeriod → contributor may claim as approved
Contributor: claim(submissionId)
          → contributor receives reward
          → FeeRouter receives reward × 10%
```

### Challenge (finding experts)
```
Creator: createChallenge(prizePool, topN, prizeSplit[], deadline, specHash)
         vault reserves prizePool × 1.10
Anyone: submit answers before deadline                      [signed tx]
Agent (off-chain): scores each answer, runs copy screening, builds the leaderboard (advice)
Creator: finalizeChallenge(rankedSubmissionIds[topN])       [signed tx]
         → ranks 1..topN can claim their prize
         → those wallets become "qualified" for this project
Creator: createTask(..., allowlistFromChallenge = challengeId)
         → qualified wallets can submit to the paid expert task without being added by hand
Anyone not in the top N: "Apply" button on the leaderboard → creator may add them by hand
If the creator doesn't finalize within finalizeWindow (default 7 days after deadline):
         → the prize pool is split equally among all non-rejected submissions, claimable
```
Pricing logic: the pool pays the best answers, and every answer that isn't rejected can become dataset data, since hard questions plus expert answers are the most valuable training data.

### Dataset license
```
Creator: publishDataset(taskIds[], encryptedURI, price, termsHash)
         dataset = all APPROVED submissions of those tasks (contract enforces this)
Buyer: buyLicense(datasetId)  pays price in USDC
         → FeeRouter: 10%
         → creator: creatorBps of the rest (claimable)
         → contributors: contributorBps of the rest, pro-rata by approved submissions in the dataset (claimable)
Key-release service: checks the License on-chain, then gives the buyer the decryption key
```

## 5. Contracts

Stack: Foundry, Solidity `^0.8.24`, OpenZeppelin Contracts v5, `SafeERC20` everywhere. **Look up the Arc USDC address and chain ID in Circle's docs at build time. Never hard-code them from memory.**

```
src/
  core/ProjectFactory.sol
  core/ProjectVault.sol       # one clone per project: budget, tasks, submissions, reviews, claims
  market/DatasetRegistry.sol  # publish datasets made of approved submissions
  market/LicenseMarket.sol    # buy licenses, split revenue, claims
  fees/FeeRouter.sol          # holds fees, forwards to treasury
  governance/Timelock.sol     # OZ TimelockController
```

### 5.1 ProjectFactory
- `createProject(string metadataURI, uint16 creatorBps, uint32 reviewPeriod) returns (address vault)`
- Deploys a `ProjectVault` clone. `reviewPeriod` must be ≥ the global minimum (e.g. 3 days) and ≤ 30 days.
- Pausable by guardian (blocks new projects only).

### 5.2 ProjectVault
```solidity
function deposit(uint256 amount) external;                       // anyone can fund
function setReviewer(address r, bool allowed) external onlyCreator; // human reviewers
function createTask(TaskParams calldata t) external onlyCreator;
function setAllowlist(uint256 taskId, address[] calldata a, bool allowed) external onlyCreator;
function openTask(uint256 taskId) external onlyCreator;          // allowlist-only → open to everyone (one-way)
function submit(uint256 taskId, bytes32 contentHash, string calldata uri) external returns (uint256 id);
function approve(uint256 submissionId) external onlyReviewerOrCreator;
function reject(uint256 submissionId, bytes32 reasonHash) external onlyReviewerOrCreator;
function claim(uint256 submissionId) external;                   // contributor only
function closeTask(uint256 taskId) external onlyCreator;         // frees unused reservation
function withdrawUnreserved(uint256 amount) external onlyCreator;
```
`TaskParams`: `reward`, `maxSubmissions`, `deadline`, `specHash`, `allowlistOnly`, `maxPerContributor`.

**Fee clarity (state this in `createTask` NatSpec and in the UI):** `reward` is the net amount the contributor receives. The vault reserves `reward × maxSubmissions` **plus** 10% on top for the protocol fee. The contributor never pays the fee.

**Allowlist first:** the UI defaults new tasks to `allowlistOnly = true`, so creators start with invited, higher-quality contributors. Calling `openTask` opens a task to everyone, and it can't be reversed for that task.

Submission states: `Submitted → Approved → Claimed`, `Submitted → Rejected`, or `Submitted → (reviewPeriod passes) → claimable as Approved`.

Rules:
- `approve` and `reject` work only on `Submitted`, only before the review deadline.
- After the deadline with no decision, `claim` treats the submission as approved, marks it `Approved`, and pays.
- Approved count per task can never exceed `maxSubmissions`. Reject submissions beyond the limit at `submit` time.
- `closeTask` stops new submissions. Pending submissions keep their reservation until reviewed or auto-approved.

### 5.2b Challenges (in ProjectVault)
```solidity
function createChallenge(ChallengeParams calldata c) external onlyCreator; // reserves prizePool × 1.10
function finalizeChallenge(uint256 challengeId, uint256[] calldata rankedSubmissionIds) external onlyCreator;
function claimPrize(uint256 challengeId, uint256 submissionId) external;    // winner, or anyone eligible under the fallback
function isQualified(uint256 challengeId, address who) external view returns (bool);
```
`ChallengeParams`: `prizePool`, `topN` (max 50), `prizeSplitBps[]` (length `topN`, sums to 10000), `deadline`, `finalizeWindow` (3–30 days), `specHash`, `maxPerContributor` (default 1).

Rules:
- Submissions are open to anyone (no allowlist) and only before `deadline`.
- `finalizeChallenge` runs only between `deadline` and `deadline + finalizeWindow`, exactly once. The ranked IDs must be distinct, non-rejected submissions of that challenge, and each belongs to a different contributor.
- The creator may `reject(submissionId, reasonHash)` challenge answers before finalizing (spam, copies). Rejected answers can't rank and aren't paid.
- **Fallback:** if not finalized in time, every non-rejected submission can claim `prizePool / count`. The creator can't recover the pool by staying silent.
- Fewer valid answers than `topN`: the unused prize shares go back to the creator's unreserved budget at finalization.
- Winners are stored as qualified addresses. A task created with `allowlistFromChallenge = challengeId` accepts them automatically, alongside any hand-added addresses.
- Events: `ChallengeCreated`, `ChallengeFinalized(rankedIds)`, `PrizeClaimed`, `ChallengeFallback`.

### 5.3 DatasetRegistry
- `publishDataset(address vault, uint256[] taskIds, string encryptedURI, uint256 price, bytes32 termsHash)`: creator only. The dataset is defined as every **approved** submission of those tasks at publish time. The contract stores the snapshot count per task, so later approvals don't change a published dataset.
- `updatePrice(datasetId, newPrice)`: creator only.

### 5.4 LicenseMarket
- `buyLicense(datasetId)`: pulls USDC, sends the fee to `FeeRouter`, credits the creator share, and adds the contributor share to a per-dataset accumulator (`revenuePerSubmission`).
- `claimCreator(datasetId)`, `claimContributor(datasetId, submissionIds[])`: each submission's share is claimable once per accumulator increase (track `paidPerSubmission`).
- Stores `License(datasetId, buyer, timestamp)`, which the key-release service reads.

### 5.5 FeeRouter
- Receives USDC fees. `distribute()` is permissionless and forwards the balance to the treasury.
- Built so a later version can add buyback and burn without changing vaults (vaults read the router address from the factory).

## 6. Off-chain components

| Component | Writes on-chain? | Role |
|---|---|---|
| Frontend (Vue 3 + Vite + TypeScript; viem + @wagmi/vue for wallet and contract calls; Pinia for state) | No, users sign | Create, fund, submit, review, claim, buy. Circle Wallets for contributors new to crypto. |
| Indexer (Ponder or similar) | No | Feeds the UI, catalog, and agent |
| Quality agent | **No** | Pre-screens submissions: format checks, duplicate and plagiarism detection, LLM scoring against `specHash`, hidden test questions. Shows score and flags to reviewers. |
| Key-release service | No | Checks License on-chain, releases the dataset decryption key. Run in a TEE (Nitro Enclave). |
| Storage | No | Encrypted content off-chain, only hashes and URIs on-chain |
| Keeper | Permissionless calls only | `FeeRouter.distribute()` |

The agent's output is a recommendation stored off-chain with its inputs, so reviewers and contributors can see why a submission was flagged.

### Challenge scoring and screening (agent, off-chain, advice only)
We don't ban AI use. We score what an expert adds beyond what AI gives on its own.

1. **Model-tested questions.** Before a challenge opens, run every question against current frontier models. Keep only questions they get wrong or only partly right. Store the model baseline answers privately.
2. **Score = value added over baseline.** Grade each answer on correctness, its reasoning, and how far it beats the model baseline. An answer near-identical to the baseline scores zero added value.
3. **Copy screening.** Compare answers across participants by meaning (embeddings), not just by text, and flag pairs above a similarity threshold. Also flag answers submitted unusually fast, accounts that act together, and wallets funded from the same source.
4. **Flags are warnings, never automatic rejections.** Two real experts can reach the same correct answer. The creator decides.
5. **Leaderboard.** A public page shows rank, a pseudonymous handle, score, and flags. After finalization, it shows the official on-chain ranking.
6. **Optional live check.** For the top scorers, the creator can run a short timed follow-up question before finalizing.

**Quality transparency.** Every project and dataset page shows, computed by the indexer from on-chain events plus agent logs:
- approval rate, rejection rate, and auto-approval rate (reviews the creator missed)
- average agent score of approved submissions
- number of contributors, and median review time

Vault events must carry enough data to compute these: `Submitted`, `Approved`, `Rejected(reasonHash)`, `AutoApproved`, and `Claimed`, each with `taskId`, `submissionId`, and `contributor`.

## 7. Invariants (Foundry invariant tests for each)

1. `vault USDC balance == unreserved budget + reserved + owed but unclaimed`
2. Paid out per task ≤ `reward × maxSubmissions`, and approved count ≤ `maxSubmissions`.
3. Each submission is paid at most once, and only to its contributor.
4. A rejected submission is never counted in a dataset or paid license revenue.
5. A submission unreviewed past its deadline is always claimable by its contributor.
6. No admin, guardian, reviewer, or backend path moves USDC to an arbitrary address.
7. Pause never blocks `claim`, `claimContributor`, `claimCreator`, or `withdrawUnreserved`.
8. License revenue: `fee + creator credit + contributor credit == price` for every sale.
9. Fee always equals the configured bps and is ≤ 15%.
10. Prizes paid per challenge ≤ `prizePool`, each ranked position is paid at most once, and only to its submission's contributor.
11. An unfinalized challenge past its window is always claimable by every non-rejected participant.
12. A challenge can be finalized at most once, and never after its window.

## 8. Build order

1. `ProjectFactory` + `ProjectVault`: deposit, tasks, submit, approve/reject, auto-approve, claim. Tests, then an Arc testnet deploy.
2. `FeeRouter` + timelock and guardian wiring.
3. Minimal frontend: creator dashboard, task page, contributor submit and claim, reviewer queue.
4. Quality agent v0 for one task type (Move/Sui code answer ranking), shown as advice in the reviewer queue.
5. Challenges: `createChallenge`, `finalizeChallenge`, `claimPrize`, fallback, and `allowlistFromChallenge`, plus agent scoring, copy screening, and the leaderboard page with an "Apply" button.
6. `DatasetRegistry` + `LicenseMarket`, then the key-release service.
7. Public dataset catalog page.
8. Audit, then mainnet with low per-project caps.

Each step ends with passing tests (section 10) and a deploy script in `script/`.

## 9. Deferred (do not build until this file says so)

- `$VRAM` token, allocations, vesting, airdrop, buyback and burn
- Staking, creator bonds, backing pools, supporter revenue share
- Agent-signed approvals and verifier keys with on-chain power
- Challenge windows and the multi-stage dispute module
- Multi-verifier gold-question setups
- Hardware device signatures (helmet, drone data)
- Reviewer fees: a small fee for assigned reviewers, from the task budget or the protocol fee
- Encrypted submissions with reveal on approval, which fixes the content-copy risk in section 11

When we add these, each one goes in this file first, with its own safety rules and invariants.

## 10. How to work (methods Claude must follow)

### Before writing code
1. Restate the task in one or two lines, along with the files you expect to touch.
2. Read the existing contract, its tests, and the invariants in section 7 first.
3. If the change touches funds, reviews, fees, or access control, list which rules from section 2 apply and how the change respects them.

### Test-driven by default
- Write the failing test first, then the code that makes it pass, then refactor.
- Every external function gets a happy-path test, a test for each revert path, and fuzz coverage on numeric inputs.
- Every new piece of state that holds value gets an invariant in `test/invariant/`.

### Regression tests, always
- **Every bug gets a regression test before the fix.** Reproduce it in a failing test, fix it, and watch the test pass.
- Name them `test_regression_<short_description>` with a comment saying what broke and the date or issue number.
- Keep them in `test/regression/`. Never delete one. If behaviour changes on purpose, update the test and explain why in the commit.
- Each security finding (audit, Slither, or your own) becomes a regression test.

### Never cheat the tests
- Don't weaken, skip, or delete a test to make a change pass. If a test is wrong, explain why and ask first.
- No `vm.skip`, commented-out tests, or loosened assertions without approval.
- Mock only external dependencies (USDC), and prefer fork tests against Arc testnet.

### Gas and storage
- Commit a gas snapshot (`forge snapshot`). A rise above 5% on a core path needs a reason in the commit message.
- Never reorder or remove storage in a deployed implementation.

### Before every commit
```
forge fmt --check
forge build --sizes
forge test -vvv
forge test --match-path "test/invariant/*" --fuzz-runs 10000
forge snapshot --check
slither . --exclude-dependencies
```
Then update NatSpec, docs, and `CHANGELOG.md`. Keep commits small with messages explaining *why*.

### Self-review checklist (every diff touching `src/`)
- [ ] Can anyone other than the rightful owner receive funds?
- [ ] Can any admin, guardian, reviewer, agent, or backend key move user funds?
- [ ] Checks, then effects, then external calls?
- [ ] `nonReentrant` and `SafeERC20` on every token-moving function?
- [ ] Can one bad or blacklisted address block other users?
- [ ] Can a creator avoid paying for good work (e.g. by never reviewing)?
- [ ] Do the section 7 invariants still hold, with a test proving it?
- [ ] Are new parameters bounded and timelocked, and do events cover every state change?

### Conventions
- Custom errors, events on every state change, NatSpec on every external function.
- No `tx.origin`, no `delegatecall` outside the clone factory, no `selfdestruct`.
- Amounts in token base units; no floats in payout scripts.

### Deployment
- Testnet only, unless the user explicitly says "deploy to mainnet".
- Dry-run every deploy script without `--broadcast` and show the planned actions first.
- Write addresses to `deployments/<network>.json` and verify contracts on the explorer.
- **Never commit keys, mnemonics, or RPC URLs with keys.** `.env` stays in `.gitignore`, and `.env.example` holds placeholders only.

### When stuck or unsure
- If a request conflicts with section 2 or adds something from section 9, stop and ask.
- If you can't verify a fact (an address, a chain ID, how Arc behaves), leave a `TODO(verify)` instead of guessing.
- If the same test still fails after three different fix attempts, stop, summarize what you tried, and ask.

### Definition of done
1. Tests, plus a regression test for bug fixes, are written and pass.
2. The full suite, invariants, Slither, and the gas check pass.
3. Docs and the changelog are updated.
4. You've written a short summary: what changed, why, which tests cover it, and any open risk.

## 11. Known risks to keep in mind

- **Creators can copy work before rejecting it.** Content is visible during review. The MVP limits this with required rejection reasons and public rejection rates per creator. Later options: encrypted submissions or partial previews.
- **Quality depends on reviewers.** The agent helps, but a lazy creator can approve bad work. Buyers see each project's approval stats in the catalog.
- **Key-release is the one trusted service.** It can't move funds, but it can fail to deliver keys. Run it in a TEE and log every release.

## 12. Open questions (ask before deciding)

- Arc USDC address, chain ID, and gas sponsorship support: check Circle's docs.
- Default license split (suggested 50% creator / 50% contributors).
- Default and minimum review period (suggested 7 days default, 3 days minimum).
- Who sits on the guardian multisig.