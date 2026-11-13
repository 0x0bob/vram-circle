import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envFromDeployment } from './arc-env.mjs'

const good = {
  chainId: 5042002,
  deployBlock: 71995003,
  usdc: '0x3600000000000000000000000000000000000000',
  factory: '0x1111111111111111111111111111111111111111',
}

// Vercel serves the site from the domain root and rewrites every path to index.html (vercel.json), so the build
// uses normal path routing and an absolute base: no hash routing and no relative base.
test('maps a testnet deployment record to the static build environment', () => {
  assert.deepEqual(envFromDeployment(good), {
    VITE_CHAIN_ID: '5042002',
    VITE_FACTORY_ADDRESS: good.factory,
    VITE_USDC_ADDRESS: good.usdc,
    VITE_DEPLOY_BLOCK: '71995003',
    // the same Vercel project serves /api (upload, agent), so the browser may call it
    VITE_API_ENABLED: '1',
  })
})

test('refuses mainnet and any chain other than Arc testnet', () => {
  assert.throws(() => envFromDeployment({ ...good, chainId: 5042 }), /testnet/i)
  assert.throws(() => envFromDeployment({ ...good, chainId: 1 }), /testnet/i)
})

test('refuses a record with a wrong USDC address or missing fields', () => {
  assert.throws(() => envFromDeployment({ ...good, usdc: '0x000000000000000000000000000000000000dEaD' }), /usdc/i)
  assert.throws(() => envFromDeployment({ ...good, factory: undefined }), /factory/i)
  assert.throws(() => envFromDeployment({ ...good, deployBlock: undefined }), /deployBlock/i)
  assert.throws(() => envFromDeployment({ ...good, factory: '0x123' }), /factory/i)
})

// Vercel builds main before the contracts exist: the build must still succeed, as a site that says so.
test('a missing deployment record yields a testnet build with no contract addresses', () => {
  const env = envFromDeployment(null)
  assert.deepEqual(env, { VITE_CHAIN_ID: '5042002' })
  assert.equal(env.VITE_FACTORY_ADDRESS, undefined)
})

test('a present but invalid record is still an error (only a MISSING file is tolerated)', () => {
  assert.throws(() => envFromDeployment({ ...good, factory: 'nope' }), /factory/i)
})
