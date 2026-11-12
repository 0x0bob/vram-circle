// One command local dev: Anvil + deploy (MockUSDC + steps 1-2) + test USDC + the Vue app. No Arc needed.
// Usage: node scripts/dev.mjs   (or: npm --prefix app run dev:local)
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, startLocalChain } from './local-chain.mjs'

const chain = await startLocalChain()
const envText = Object.entries(chain.env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
writeFileSync(join(root, 'app', '.env.local'), envText) // git-ignored

console.log('\nLocal chain ready:', chain.rpcUrl)
console.log(envText)
console.log('Anvil test accounts 1-5 hold 100,000 mock USDC each. Import the well-known Anvil keys into your')
console.log('wallet (https://book.getfoundry.sh/anvil/) and add network 31337 -> ' + chain.rpcUrl + '\n')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const app = spawn(npm, ['run', 'dev'], { cwd: join(root, 'app'), stdio: 'inherit', shell: process.platform === 'win32' })
const shutdown = () => { app.kill(); chain.stop(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
app.on('exit', shutdown)
