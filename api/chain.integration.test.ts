import { describe, expect, it } from 'vitest'
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { foundry } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { projectFactoryAbi, projectVaultAbi } from '../app/src/generated/abis'
import { accessMessage } from '../agent/auth'
import { viemChainReader } from '../agent/chain'
import { RateLimiter, SpendLedger } from '../agent/limits'
import { MemoryStore } from '../agent/store'
import { fakeScorer } from '../agent/testkit'
import { adviceHandler, contentHandler, screenHandler, uploadHandler, type ApiDeps } from './_lib/handlers'

// Runs against a REAL deployment on local Anvil (scripts/api-integration.mjs starts it and sets these variables).
// Skipped otherwise. It proves the chain reader's ABI calls and the access rules work against the actual contracts.
const rpc = process.env.VITE_RPC_URL
const factory = process.env.VITE_FACTORY_ADDRESS as Address | undefined
const usdc = process.env.VITE_USDC_ADDRESS as Address | undefined

// public Anvil keys #1 (creator), #3 (contributor), #4 (stranger)
const creator = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const contributor = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')
const stranger = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a')

const SPEC = 'Rank the two Move answers and explain which is safer.'
const ANSWER = 'Answer A is safer: it moves the coin into the vault, so ownership stays linear and nothing aliases it.'
const h = (t: string): Hex => keccak256(toBytes(t))

describe.skipIf(!rpc || !factory || !usdc)('API against real contracts on Anvil', () => {
  it('uploads, submits on-chain, then screens and serves content with the right access rules', async () => {
    const pub = createPublicClient({ chain: foundry, transport: http(rpc) })
    const wallet = (account: typeof creator) => createWalletClient({ account, chain: foundry, transport: http(rpc) })
    const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash })

    // ---- a project, funded, with one task and one submission, all on the real contracts
    const { request } = await pub.simulateContract({ account: creator, address: factory!, abi: projectFactoryAbi, functionName: 'createProject', args: ['integration', 5000, 259200] })
    await wait(await wallet(creator).writeContract(request))
    const projects = await pub.getContractEvents({ address: factory!, abi: projectFactoryAbi, eventName: 'ProjectCreated', args: { creator: creator.address }, fromBlock: 0n })
    const vault = projects.at(-1)!.args.vault as Address

    await wait(await wallet(creator).writeContract({ address: usdc!, abi: erc20Abi, functionName: 'approve', args: [vault, 1_000_000_000n] }))
    await wait(await wallet(creator).writeContract({ address: vault, abi: projectVaultAbi, functionName: 'deposit', args: [500_000_000n] }))
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400)
    await wait(
      await wallet(creator).writeContract({
        address: vault,
        abi: projectVaultAbi,
        functionName: 'createTask',
        args: [{ reward: 10_000_000n, maxSubmissions: 3, deadline, specHash: h(SPEC), allowlistOnly: false, maxPerContributor: 1 }],
      }),
    )

    // ---- the real API handlers over the real chain reader and an in-memory store
    const store = new MemoryStore()
    const scorer = fakeScorer()
    const deps: ApiDeps = {
      store,
      chain: viemChainReader({ rpcUrl: rpc!, factory: factory! }),
      scorer: scorer.client,
      model: 'claude-haiku-5-5',
      chainId: 31337,
      now: Date.now,
      ledger: new SpendLedger({ store, capUsd: 5, maxCalls: 100 }),
      uploadLimiter: new RateLimiter(50, 60_000),
      screenLimiter: new RateLimiter(50, 60_000),
    }
    const origin = 'http://localhost'
    const up = (kind: string, text: string) =>
      uploadHandler(new Request(`${origin}/api/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text }) }), deps)
    const spec = await (await up('spec', SPEC)).json()
    const answer = await (await up('submission', ANSWER)).json()
    expect(spec.hash).toBe(h(SPEC))
    expect(answer.hash).toBe(h(ANSWER))

    await wait(await wallet(contributor).writeContract({ address: vault, abi: projectVaultAbi, functionName: 'submit', args: [1n, answer.hash, answer.uri] }))

    const auth = async (account: typeof creator) => {
      const expires = Math.floor(Date.now() / 1000) + 600
      const signature = await account.signMessage({ message: accessMessage({ vault, chainId: 31337, expires }) })
      return { 'x-vram-expires': String(expires), 'x-vram-signature': signature }
    }
    const req = (path: string, headers: Record<string, string> = {}, body?: unknown) =>
      new Request(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })

    // creator runs the agent against the real submission
    const res = await screenHandler(req('/api/screen', await auth(creator), { vault, submissionId: 1 }), deps)
    expect(res.status).toBe(200)
    const advice = await res.json()
    expect(advice).toMatchObject({
      adviceOnly: true,
      submissionId: 1,
      taskId: 1,
      contentHash: answer.hash,
      specHash: h(SPEC),
      checks: { hash: { status: 'match' }, instructions: { status: 'match' } },
      ai: { status: 'ok', score: 61 },
    })
    expect(scorer.calls[0]!.user).toContain(SPEC)

    // access rules against the real vault roles
    const q = `/api/content?kind=submission&hash=${answer.hash}&vault=${vault}&submissionId=1`
    expect((await contentHandler(req(q, await auth(creator)), deps)).status).toBe(200)
    expect((await contentHandler(req(q, await auth(contributor)), deps)).status).toBe(200)
    expect((await contentHandler(req(q, await auth(stranger)), deps)).status).toBe(403)
    expect((await contentHandler(req(q), deps)).status).toBe(401)
    expect((await screenHandler(req('/api/screen', await auth(contributor), { vault, submissionId: 1 }), deps)).status).toBe(403)
    expect((await adviceHandler(req(`/api/advice?vault=${vault}&submissionId=1`, await auth(creator)), deps)).status).toBe(200)

    // a vault that is not one of our projects is refused before any work
    const fake = '0x000000000000000000000000000000000000dEaD'
    const bad = await screenHandler(req('/api/screen', await auth(creator), { vault: fake, submissionId: 1 }), deps)
    expect([401, 404]).toContain(bad.status) // signature scoped to another vault, or unknown project: never a model call
    expect(scorer.calls).toHaveLength(1)
  }, 60_000)
})
