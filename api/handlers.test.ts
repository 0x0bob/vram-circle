import { beforeEach, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { accessMessage } from '../agent/auth'
import { contentHash } from '../agent/hash'
import { RateLimiter, SpendLedger } from '../agent/limits'
import { MemoryStore } from '../agent/store'
import { ALICE, FakeChain, SPEC, VAULT, fakeScorer } from '../agent/testkit'
import { adviceHandler, contentHandler, screenHandler, uploadHandler, MAX_UPLOAD_BYTES, type ApiDeps } from './_lib/handlers'

const NOW = 1_800_000_000_000
const CHAIN_ID = 5042002
// public Anvil test keys
const creatorKey = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const strangerKey = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
const aliceKey = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')

let store: MemoryStore
let chain: FakeChain
let scorer: ReturnType<typeof fakeScorer>
let deps: ApiDeps

const origin = 'https://vram-circle.vercel.app'
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, { headers: { 'x-forwarded-for': '1.2.3.4', ...headers } })

async function authHeaders(account: typeof creatorKey, vault = VAULT, expires = NOW / 1000 + 600) {
  const signature = await account.signMessage({ message: accessMessage({ vault, chainId: CHAIN_ID, expires }) })
  return { 'x-vram-expires': String(expires), 'x-vram-signature': signature }
}

beforeEach(async () => {
  store = new MemoryStore()
  chain = new FakeChain()
  chain.creator = creatorKey.address
  scorer = fakeScorer()
  await store.put(`spec/${contentHash(SPEC)}.txt`, SPEC)
  deps = {
    store,
    chain,
    scorer: scorer.client,
    model: 'claude-haiku-5-5',
    chainId: CHAIN_ID,
    now: () => NOW,
    ledger: new SpendLedger({ store, capUsd: 5, maxCalls: 100, now: () => NOW }),
    uploadLimiter: new RateLimiter(5, 60_000, () => NOW),
    screenLimiter: new RateLimiter(3, 60_000, () => NOW),
  }
})

describe('POST /api/upload', () => {
  it('stores the text under its keccak256 hash and returns the hash and a URI', async () => {
    const res = await uploadHandler(post('/api/upload', { kind: 'spec', text: SPEC }), deps)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hash).toBe(contentHash(SPEC))
    expect(body.bytes).toBe(new TextEncoder().encode(SPEC).length)
    expect(body.uri).toBe(`${origin}/api/content?kind=spec&hash=${contentHash(SPEC)}`)
    expect(await store.get(`spec/${contentHash(SPEC)}.txt`)).toBe(SPEC)
  })

  it('keeps specs and submissions in separate namespaces', async () => {
    await uploadHandler(post('/api/upload', { kind: 'submission', text: 'my answer text here' }), deps)
    expect(await store.get(`submission/${contentHash('my answer text here')}.txt`)).toBe('my answer text here')
    expect(await store.get(`spec/${contentHash('my answer text here')}.txt`)).toBeNull()
  })

  it('is idempotent: the same text twice gives the same hash and one file', async () => {
    const a = await (await uploadHandler(post('/api/upload', { kind: 'submission', text: 'same text, twice' }), deps)).json()
    const b = await (await uploadHandler(post('/api/upload', { kind: 'submission', text: 'same text, twice' }), deps)).json()
    expect(a.hash).toBe(b.hash)
    expect(await store.list('submission/')).toHaveLength(1)
  })

  it('rejects bad input: unknown kind, non-string text, empty text, invalid JSON, wrong method', async () => {
    expect((await uploadHandler(post('/api/upload', { kind: 'other', text: 'x' }), deps)).status).toBe(400)
    expect((await uploadHandler(post('/api/upload', { kind: 'spec', text: 5 }), deps)).status).toBe(400)
    expect((await uploadHandler(post('/api/upload', { kind: 'spec', text: '' }), deps)).status).toBe(400)
    expect((await uploadHandler(post('/api/upload', '{not json'), deps)).status).toBe(400)
    expect((await uploadHandler(get('/api/upload'), deps)).status).toBe(405)
  })

  it('refuses uploads over the size cap, counting bytes not characters', async () => {
    const ok = 'a'.repeat(MAX_UPLOAD_BYTES)
    expect((await uploadHandler(post('/api/upload', { kind: 'submission', text: ok }), deps)).status).toBe(200)
    const tooBig = 'é'.repeat(MAX_UPLOAD_BYTES / 2 + 1) // 2 bytes each
    expect((await uploadHandler(post('/api/upload', { kind: 'submission', text: tooBig }), deps)).status).toBe(413)
  })

  it('rate limits per client with a Retry-After header', async () => {
    for (let i = 0; i < 5; i++) await uploadHandler(post('/api/upload', { kind: 'spec', text: `text number ${i}` }), deps)
    const res = await uploadHandler(post('/api/upload', { kind: 'spec', text: 'one too many' }), deps)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    const other = post('/api/upload', { kind: 'spec', text: 'other client' }, { 'x-forwarded-for': '9.9.9.9' })
    expect((await uploadHandler(other, deps)).status).toBe(200)
  })
})

describe('GET /api/content', () => {
  it('serves task instructions publicly, after re-checking the hash', async () => {
    const res = await contentHandler(get(`/api/content?kind=spec&hash=${contentHash(SPEC)}`), deps)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SPEC)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
  })

  it('refuses to serve a file whose bytes no longer match its hash (tampered storage)', async () => {
    await store.put(`spec/${contentHash(SPEC)}.txt`, 'tampered')
    const res = await contentHandler(get(`/api/content?kind=spec&hash=${contentHash(SPEC)}`), deps)
    expect(res.status).toBe(502)
  })

  it('404s for unknown files and 400s for a malformed hash', async () => {
    expect((await contentHandler(get(`/api/content?kind=spec&hash=0x${'00'.repeat(32)}`), deps)).status).toBe(404)
    expect((await contentHandler(get('/api/content?kind=spec&hash=nope'), deps)).status).toBe(400)
    expect((await contentHandler(get(`/api/content?kind=weird&hash=0x${'00'.repeat(32)}`), deps)).status).toBe(400)
  })

  describe('submissions are not public', () => {
    let id: number
    let hash: string
    beforeEach(async () => {
      chain.reviewers.add(strangerKey.address.toLowerCase()) // not used here; stranger below is NOT a reviewer
      chain.reviewers.delete(strangerKey.address.toLowerCase())
      id = await chain.add(store, aliceKey.address, 'alice private answer to the task')
      hash = contentHash('alice private answer to the task')
    })
    const url = () => `/api/content?kind=submission&hash=${hash}&vault=${VAULT}&submissionId=${id}`

    it('needs a wallet signature (401 without one)', async () => {
      expect((await contentHandler(get(url()), deps)).status).toBe(401)
    })

    it('lets the creator and the contributor read it', async () => {
      const c = await contentHandler(get(url(), await authHeaders(creatorKey)), deps)
      expect(c.status).toBe(200)
      expect(await c.text()).toBe('alice private answer to the task')
      expect((await contentHandler(get(url(), await authHeaders(aliceKey)), deps)).status).toBe(200)
    })

    it('lets a reviewer read it', async () => {
      chain.reviewers.add(strangerKey.address.toLowerCase())
      expect((await contentHandler(get(url(), await authHeaders(strangerKey)), deps)).status).toBe(200)
    })

    it('403s for any other wallet', async () => {
      expect((await contentHandler(get(url(), await authHeaders(strangerKey)), deps)).status).toBe(403)
    })

    it('401s for an expired signature', async () => {
      const h = await authHeaders(creatorKey, VAULT, NOW / 1000 - 10)
      expect((await contentHandler(get(url(), h), deps)).status).toBe(401)
    })

    it('cannot be used to read an arbitrary hash: the hash must be that of the named submission', async () => {
      await store.put(`submission/${contentHash('another private answer')}.txt`, 'another private answer')
      const other = `/api/content?kind=submission&hash=${contentHash('another private answer')}&vault=${VAULT}&submissionId=${id}`
      expect((await contentHandler(get(other, await authHeaders(creatorKey)), deps)).status).toBe(404)
    })

    it('is never cached', async () => {
      const res = await contentHandler(get(url(), await authHeaders(creatorKey)), deps)
      expect(res.headers.get('cache-control')).toMatch(/no-store|private/)
    })
  })
})

describe('POST /api/screen and GET /api/advice (creator and reviewers only)', () => {
  let id: number
  beforeEach(async () => {
    id = await chain.add(store, ALICE, 'Answer 1 is safer because the borrow checker rejects the dangling reference in option two.')
  })
  const body = () => ({ vault: VAULT, submissionId: id })

  it('401s without a signature and 403s for a contributor or a stranger', async () => {
    expect((await screenHandler(post('/api/screen', body()), deps)).status).toBe(401)
    expect((await screenHandler(post('/api/screen', body(), await authHeaders(strangerKey)), deps)).status).toBe(403)
    expect(scorer.calls).toHaveLength(0) // no spend before authorization
  })

  it('runs the screening for the creator and returns the advice', async () => {
    const res = await screenHandler(post('/api/screen', body(), await authHeaders(creatorKey)), deps)
    expect(res.status).toBe(200)
    const advice = await res.json()
    expect(advice).toMatchObject({ adviceOnly: true, submissionId: id, ai: { status: 'ok', score: 61 } })
  })

  it('serves the stored advice to staff only', async () => {
    await screenHandler(post('/api/screen', body(), await authHeaders(creatorKey)), deps)
    const q = `/api/advice?vault=${VAULT}&submissionId=${id}`
    const ok = await adviceHandler(get(q, await authHeaders(creatorKey)), deps)
    expect(ok.status).toBe(200)
    expect((await ok.json()).advice).toHaveLength(1)
    expect((await adviceHandler(get(q), deps)).status).toBe(401)
    expect((await adviceHandler(get(q, await authHeaders(strangerKey)), deps)).status).toBe(403)
  })

  it('404s for an unknown project or submission', async () => {
    const h = await authHeaders(creatorKey, '0x0000000000000000000000000000000000000bad')
    const res = await screenHandler(post('/api/screen', { vault: '0x0000000000000000000000000000000000000bad', submissionId: 1 }, h), deps)
    expect(res.status).toBe(404)
  })

  it('validates the body', async () => {
    const h = await authHeaders(creatorKey)
    expect((await screenHandler(post('/api/screen', { vault: 'nope', submissionId: 1 }, h), deps)).status).toBe(400)
    expect((await screenHandler(post('/api/screen', { vault: VAULT, submissionId: 'x' }, h), deps)).status).toBe(400)
    expect((await screenHandler(post('/api/screen', { vault: VAULT, submissionId: -1 }, h), deps)).status).toBe(400)
  })

  it('rate limits per client', async () => {
    const h = await authHeaders(creatorKey)
    for (let i = 0; i < 3; i++) await screenHandler(post('/api/screen', body(), h), deps)
    expect((await screenHandler(post('/api/screen', body(), h), deps)).status).toBe(429)
  })

  it('never leaks internals in an error', async () => {
    chain.getSubmission = async () => {
      throw new Error('rpc https://rpc.example/KEY-abc123 failed')
    }
    const res = await screenHandler(post('/api/screen', body(), await authHeaders(creatorKey)), deps)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('KEY-abc123')
  })
})
