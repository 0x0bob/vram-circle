// Builds the static site (app/dist) for Arc testnet from deployments/arc-testnet.json. No backend, no secrets:
// everything baked in is a public address or block number.
// Usage: node scripts/build-arc-testnet.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './local-chain.mjs'
import { envFromDeployment } from './arc-env.mjs'

const deployment = JSON.parse(readFileSync(join(root, 'deployments', 'arc-testnet.json'), 'utf8'))
const env = envFromDeployment(deployment)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const res = spawnSync(npm, ['run', 'build'], {
  cwd: join(root, 'app'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...env },
})
process.exit(res.status ?? 1)
