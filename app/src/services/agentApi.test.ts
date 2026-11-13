import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accessMessage as serverAccessMessage } from '../../../agent/auth'
import { hashText } from '../lib/hash'
import { accessMessage, createAccess, fetchAdvice, fetchSpec, fetchSubmission, runScreen, uploadText } from './agentApi'

const vault = '0x269fcaf4d50cfd5346d275a7546ce78fec29b111'
const sign = vi.fn(async (m: string) => `0xsig(${m.length})`)

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown; text?: boolean }) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init)
    return new Response(r.text ? String(r.body) : JSON.stringify(r.body), { status: r.status ?? 200 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => {
  sign.mockClear()
  vi.unstubAllGlobals()
})

describe('access message', () => {
  it('is byte-identical to what the server verifies (a drift would break every sign-in)', () => {
    const o = { vault: vault as `0x${string}`, chainId: 5042002, expires: 1_800_000_000 }
    expect(accessMessage(o)).toBe(serverAccessMessage(o))
  })
})

describe('uploadText', () => {
  it('uploads and returns the hash and URI after checking the server hashed the same bytes', async () => {
    const text = 'Rank the two answers.'
    const f = mockFetch(() => ({ body: { hash: hashText(text), uri: 'https://x/api/content?kind=spec', bytes: 21 } }))
    const r = await uploadText('spec', text)
    expect(r).toEqual({ hash: hashText(text), uri: 'https://x/api/content?kind=spec' })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('/api/upload')
    expect(JSON.parse(init!.body as string)).toEqual({ kind: 'spec', text })
  })

  it('throws if the server reports a different hash than the browser computed (never submit an unverified hash)', async () => {
    mockFetch(() => ({ body: { hash: `0x${'00'.repeat(32)}`, uri: 'u', bytes: 1 } }))
    await expect(uploadText('submission', 'my answer')).rejects.toThrow(/hash/i)
  })

  it('surfaces the server error message', async () => {
    mockFetch(() => ({ status: 413, body: { error: 'Upload too large (max 65536 bytes)' } }))
    await expect(uploadText('submission', 'x')).rejects.toThrow(/too large/)
  })
})

describe('fetchSpec', () => {
  const text = 'Rank the two answers.'
  it('verifies the instructions against the on-chain spec hash', async () => {
    mockFetch(() => ({ body: text, text: true }))
    expect(await fetchSpec(hashText(text))).toEqual({ status: 'match', text })
  })
  it('reports a mismatch when the served text does not hash to the on-chain value', async () => {
    mockFetch(() => ({ body: 'tampered', text: true }))
    expect(await fetchSpec(hashText(text))).toMatchObject({ status: 'mismatch' })
  })
  it('reports unavailable when the server has no such file', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'Not found' } }))
    expect(await fetchSpec(hashText(text))).toEqual({ status: 'unavailable', text: null })
  })
})

describe('createAccess (one wallet signature per project per hour, not per click)', () => {
  it('signs once and reuses the signature until it is close to expiring', async () => {
    let t = 1_800_000_000_000
    const access = createAccess({ chainId: 5042002, sign, now: () => t })
    const a = await access.headers(vault)
    const b = await access.headers(vault)
    expect(sign).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    t += 59 * 60 * 1000 // 59 minutes later: too close to the 60 minute limit, sign again
    await access.headers(vault)
    expect(sign).toHaveBeenCalledTimes(2)
  })

  it('signs per vault', async () => {
    const access = createAccess({ chainId: 5042002, sign, now: () => 1_800_000_000_000 })
    await access.headers(vault)
    await access.headers('0x0000000000000000000000000000000000000abc')
    expect(sign).toHaveBeenCalledTimes(2)
  })

  it('signs the exact message the server will verify, and sends it in the headers the server reads', async () => {
    const now = 1_800_000_000_000
    const access = createAccess({ chainId: 5042002, sign, now: () => now })
    const h = await access.headers(vault)
    const expires = Number(h['x-vram-expires'])
    expect(expires).toBeGreaterThan(now / 1000)
    expect(expires).toBeLessThanOrEqual(now / 1000 + 3600)
    expect(sign).toHaveBeenCalledWith(serverAccessMessage({ vault: vault as `0x${string}`, chainId: 5042002, expires }))
    expect(h['x-vram-signature']).toMatch(/^0xsig/)
  })

  it('does not keep a failed signature (a rejected prompt can be retried)', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('User rejected')).mockResolvedValue('0xok')
    const access = createAccess({ chainId: 5042002, sign: failing, now: () => 1_800_000_000_000 })
    await expect(access.headers(vault)).rejects.toThrow('User rejected')
    await expect(access.headers(vault)).resolves.toBeTruthy()
  })
})

describe('reading submissions and advice', () => {
  const headers = { 'x-vram-expires': '1', 'x-vram-signature': '0xs' }

  it('fetchSubmission sends the credentials and verifies the content against the on-chain hash', async () => {
    const text = 'alice answer'
    const f = mockFetch(() => ({ body: text, text: true }))
    const r = await fetchSubmission({ vault, submissionId: 3, hash: hashText(text) }, headers)
    expect(r).toEqual({ status: 'match', text })
    const [url, init] = f.mock.calls[0]!
    expect(url).toContain('kind=submission')
    expect(url).toContain(`vault=${vault}`)
    expect(url).toContain('submissionId=3')
    expect((init!.headers as Record<string, string>)['x-vram-signature']).toBe('0xs')
  })

  it('flags a submission whose served text does not match the hash on-chain', async () => {
    mockFetch(() => ({ body: 'something else', text: true }))
    const r = await fetchSubmission({ vault, submissionId: 3, hash: hashText('alice answer') }, headers)
    expect(r.status).toBe('mismatch')
  })

  it('maps 401, 403 and 404 to states the UI can explain', async () => {
    for (const [status, expected] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'unavailable']] as const) {
      mockFetch(() => ({ status, body: { error: 'x' } }))
      expect((await fetchSubmission({ vault, submissionId: 1, hash: hashText('a') }, headers)).status).toBe(expected)
    }
  })

  it('runScreen and fetchAdvice call the right endpoints with the credentials', async () => {
    const advice = { adviceOnly: true, ai: { status: 'skipped', reason: 'no_api_key' } }
    const f = mockFetch((url) => ({ body: url.includes('/api/advice') ? { advice: [advice] } : advice }))
    expect(await runScreen({ vault, submissionId: 2 }, headers)).toEqual(advice)
    expect(await fetchAdvice({ vault, submissionId: 2 }, headers)).toEqual([advice])
    expect(f.mock.calls[0]![0]).toBe('/api/screen')
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ vault, submissionId: 2 })
    expect(f.mock.calls[1]![0]).toContain('/api/advice?vault=')
  })

  it('turns an error response into a readable error', async () => {
    mockFetch(() => ({ status: 429, body: { error: 'Too many requests. Try again shortly.' } }))
    await expect(runScreen({ vault, submissionId: 2 }, headers)).rejects.toThrow(/too many/i)
  })
})
