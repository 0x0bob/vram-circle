# Arc testnet deploy and smoke test

Network: Arc testnet, chain id 5042002. RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`.
USDC: `0x3600000000000000000000000000000000000000` (ERC-20 interface, 6 decimals). Source: docs.arc.io, verified by the
project owner (Nov 2026). Date: 2026-11-12.

All transactions were signed with the throwaway testnet keys derived from the git-ignored `.seed` (index 0 deployer and
creator and reviewer, 1 treasury, 2 guardian, 3 contributor). Not MetaMask. Never reuse that seed on mainnet.

## Deployment (`deployments/arc-testnet.json`)

| Contract | Address | Tx |
|---|---|---|
| Timelock (48h) | `0x4C2Dd7A8515D44a9c5DFc104fb49c0D3F4FD4a28` | `0x86342e79fd26c2d540e79cf1a07e48253d50e561f4c650cdc3910cd9d766b726` |
| FeeRouter | `0x0bc32769Dc51661D851e36b383746Bc9fDf4b354` | `0x4b204638ca4d4c2c155af9ec5f615fcce8d035df8f379ebb36ea3e8222eb9ada` |
| ProjectFactory | `0x2960EF06134301a3F404353Db0112910aAb618b2` | `0x75067d9344965f7fa15534d5119269664356eedaeef67941ad10206d11de53af` |
| Vault implementation (made by the factory) | `0x9017aa4E3b6D115FE717BFEdbf8590e49BB22b8F` | (internal call in the factory tx) |

Treasury `0xaC095150494Fe55E4EAb6A2afD6AA16a71F2a3DA`, guardian `0xbC2CF79e2bDD61BF324111Ded44b43a8a558D7eF`,
deploy block (lower bound the app scans from) 72014469. Deploy gas cost about 0.1 USDC.

Post-deploy checks (`cast call`): `feeBps() = 1000`, `feeRouter()` and `guardian()` as above, `paused() = false`,
timelock `getMinDelay() = 172800`.

## Explorer verification

Blockscout-style API at `https://explorer.testnet.arc.io/api/` works with
`forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/`.
Status: **all four contracts verified** (Timelock, FeeRouter, ProjectFactory, ProjectVault implementation), confirmed via
`/api/v2/smart-contracts/<address>` (`is_verified: true`). The explorer's public API is aggressively rate limited
("Too many requests"): `--watch` polling fails and forge's already-verified pre-check is refused. What worked: submit
one contract at a time with `--skip-is-verified-check`, then check the status with a plain GET. Manual fallback: on the
explorer, Contract -> Verify & Publish -> "Standard JSON input" using
`forge verify-contract --show-standard-json-input <address> <path:Name>`; constructor args are in `deployments/arc-testnet.json`
and `script/Deploy.s.sol`. Vault clones (EIP-1167) are minimal proxies of the verified implementation and are not verified one by one.

## Smoke test: core flow on real USDC

Vault (project) `0x269fcaf4d50cfd5346d275a7546ce78fec29b111`. Reward 5 USDC, fee 0.5 on top, 2 slots, so 11 USDC reserved.

| # | Step | Tx |
|---|---|---|
| 1 | `createProject` (50% creator share, 3 day review period) | `0x7cece912adaf64a9bd08d0b99373a56b6ca41a99fe16877511ee222a28c6685f` |
| 2 | USDC `approve(vault, 50)` | `0xfdf505c7fc1ace15ef97c7edeb633e6513450711ff8ff598aba4973d72d51352` |
| 3 | USDC `transfer` 1 USDC to the contributor (their gas) | `0x6d0235870f4d086f6d4b356d5ef6fd248be5a7129b5d6665b45a349900c72861` |
| 4 | `deposit(15)` | `0xb4736f8d52150d13490f3fa128bcf6c8453cdc01337b4aeb9bdff9bbfc9923cb` |
| 5 | `createTask` (open to everyone) | `0xdb83853484ba4deb1cc6c728cb6205f26cd9382169c754ac21bb727d7a1cd9da` |
| 6 | `submit` (contributor) | `0xeee6336a866001f13d02728721294dc3d4a4a4137a20dfac0e212f53b2e77be9` |
| 7 | `approve` (reviewer) | `0x66e3e408aa124d194bf7249efa2a98b039a18fb3b657b7b9abcc164a1594b339` |
| 8 | `claim` (contributor) | `0xd28516f4b0866b5f02f4d59c657d929e814581b340ba907301d19b86d188ff3e` |
| 9 | `FeeRouter.distribute()` | `0x7aeb779c26ee8149388cf7f849be7336246abe863c94da170195602283faf22d` |

Also on chain: an earlier `distribute()` with an empty router (`0x423cc7d709756f46ba0beaf263394c43d881f79076a30986a3c1dee40091692f`,
no effect, as designed) and a first `approve` of 50 USDC to a first deposit attempt that reverted at gas estimation (the
creator held less than 50 USDC; no tx was sent). Amounts were then reduced.

Observed values:
- Contributor balance 0.996038 -> 5.993316 USDC: +4.997278, which is the 5 USDC reward minus about 0.0027 USDC gas.
  (Gas is paid in the same money, see CLAUDE.md section 11.)
- Fee router got exactly 0.5 USDC (10% on top); `distribute()` moved it to the treasury (treasury balance 0.5).
- Vault USDC 9.5 = reserved 5.5 + unreserved 4. Conservation holds.

Left on chain on purpose: 1 open slot (task 1), so the project page shows a live task.

## App against the live chain

The Arc testnet build (`node scripts/build-arc-testnet.mjs`, served with `vite preview`) loaded
`/p/0x269f...b111` from the public RPC with no console errors: 1 task, 1 submission, "5 USDC", "1 / 2" slots.
Screenshot: `docs/screenshots/08-arc-testnet-project.png`.

Found by this check: the public RPC returned HTTP 429 when the page sent about a dozen separate `eth_call` requests.
Fixed with JSON-RPC batching and slower polling on public RPCs (regression test `batching.test.ts`).

## Live URL check (after merge, 2026-11-13)

`https://vram-circle.vercel.app` (Vercel, production = `main`) returns 200 for `/` and for the deep link
`/p/0x269f...b111` (SPA rewrite works), and the owner confirmed it loads.

A headless-browser check of production found a real problem that the owner's click-through did not: the project page showed
"Cannot read the chain: Request exceeds defined limit". Cause: the event scan ran from the deploy block in 1,000-block chunks.
Arc makes about 1.9 blocks per second, so nine hours after deploy that was about 60 sequential `eth_getLogs` per scan, repeated by
every poll, against a public RPC that answers more than about 4 requests per second with `-32005 rate limit exceeded`.
Measured limits of `https://rpc.testnet.arc.io`: `eth_getLogs` range must be under 20,000 blocks (10,000 works, 20,000 does not),
batches of 50 JSON-RPC calls are accepted, and a burst of about 4 requests in a row starts failing.

Fix (regression tests first, `step-3c-design`): 9,000-block chunks, incremental scans (only new blocks after the first scan,
concurrent callers share one), one merged scan per vault, 300ms spacing between log requests, backoff that retries the same
chunk on a rate limit instead of halving it, and 6 transport retries. Result against the real chain: project page loads in about
3 seconds with 12 HTTP requests, then about 11 requests per 45 seconds of polling.

Remaining limitation: the first scan still walks every block since the deploy (about 170,000 more blocks per day, so about 19 more
requests per day on a first visit). Fine for testnet; the indexer is the real fix.
