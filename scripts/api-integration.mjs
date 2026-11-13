// Runs the API integration test against a fresh local Anvil with the real contracts deployed (no Arc, no Vercel, no keys).
// Usage: node scripts/api-integration.mjs
import { spawn } from 'node:child_process'
import { root, startLocalChain } from './local-chain.mjs'

const chain = await startLocalChain({ port: Number(process.env.API_ANVIL_PORT ?? 8549) })
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(npx, ['vitest', 'run', 'api/chain.integration.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...chain.env },
})
child.on('exit', (code) => {
  chain.stop()
  process.exit(code ?? 1)
})
