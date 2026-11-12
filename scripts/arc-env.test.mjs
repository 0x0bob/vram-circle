import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envFromDeployment } from './arc-env.mjs'

const good = {
  chainId: 5042002,
  deployBlock: 71995003,
  usdc: '0x3600000000000000000000000000000000000000',
  factory: '0x1111111111111111111111111111111111111111',
}

test('maps a testnet deployment record to the static build environment', () => {
  assert.deepEqual(envFromDeployment(good), {
    VITE_CHAIN_ID: '5042002',
    VITE_FACTORY_ADDRESS: good.factory,
    VITE_USDC_ADDRESS: good.usdc,
    VITE_DEPLOY_BLOCK: '71995003',
    VITE_ROUTER_MODE: 'hash',
    VITE_BASE: './',
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
