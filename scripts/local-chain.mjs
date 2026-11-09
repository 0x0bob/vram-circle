// Starts Anvil, deploys MockUSDC + steps 1-2 (script/DeployLocal.s.sol) and returns the app env.
// Used by scripts/dev.mjs and scripts/e2e.mjs. Works without Arc. Local test keys only.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Anvil's well-known default account #0 key. Public test key, only ever used against local Anvil.
const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n)

/** Finds a Foundry binary: $FOUNDRY_BIN dir, then ./.tools/foundry, then PATH. */
export function findBin(name) {
  const dirs = [process.env.FOUNDRY_BIN, join(root, '.tools', 'foundry'), ...(process.env.PATH ?? '').split(delimiter)]
  for (const d of dirs.filter(Boolean)) {
    const p = join(d, exe(name))
    if (existsSync(p)) return p
  }
  throw new Error(`${name} not found. Install Foundry or set FOUNDRY_BIN to its folder.`)
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await res.json()).result
}

async function waitForRpc(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await rpc(url, 'eth_chainId')) !== undefined) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Anvil did not come up at ${url}`)
}

/** @returns {{ rpcUrl: string, env: Record<string,string>, stop: () => void }} */
export async function startLocalChain({ port = 8545 } = {}) {
  const rpcUrl = `http://127.0.0.1:${port}`
  const anvil = spawn(findBin('anvil'), ['--port', String(port), '--chain-id', '31337', '--silent'], { stdio: 'inherit' })
  const stop = () => anvil.kill()
  try {
    await waitForRpc(rpcUrl)
    const forge = findBin('forge')
    const r = spawnSync(
      forge,
      ['script', 'script/DeployLocal.s.sol:DeployLocal', '--sig', 'runLocal', '--rpc-url', rpcUrl, '--broadcast', '--private-key', ANVIL_KEY_0],
      { cwd: root, encoding: 'utf8' },
    )
    if (r.status !== 0) throw new Error(`forge script failed:\n${r.stdout}\n${r.stderr}`)
    const d = JSON.parse(readFileSync(join(root, 'deployments', 'local.json'), 'utf8'))
    const env = {
      VITE_CHAIN_ID: String(d.chainId),
      VITE_RPC_URL: rpcUrl,
      VITE_FACTORY_ADDRESS: d.factory,
      VITE_USDC_ADDRESS: d.usdc,
      VITE_DEPLOY_BLOCK: String(d.deployBlock),
    }
    return { rpcUrl, env, stop }
  } catch (e) {
    stop()
    throw e
  }
}

export { rpc }
