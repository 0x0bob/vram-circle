// Runs the Playwright end-to-end test against a fresh local Anvil chain (no Arc needed).
// Usage: node scripts/e2e.mjs [playwright args]
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { root, startLocalChain } from './local-chain.mjs'

const port = Number(process.env.E2E_ANVIL_PORT ?? 8547)
const chain = await startLocalChain({ port })
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(npx, ['playwright', 'test', ...process.argv.slice(2)], {
  cwd: join(root, 'app'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...chain.env },
})
child.on('exit', (code) => {
  chain.stop()
  process.exit(code ?? 1)
})
