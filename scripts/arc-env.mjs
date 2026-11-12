// Turns deployments/arc-testnet.json into the VITE_* environment of the static site build.
const ARC_TESTNET_CHAIN_ID = 5042002
// Source: docs.arc.io, verified by the project owner (Nov 2026). Must match Deploy.s.sol.
const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000'
const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)

export function envFromDeployment(d) {
  if (d.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`deployment chainId ${d.chainId} is not Arc testnet (${ARC_TESTNET_CHAIN_ID}). Testnet only.`)
  }
  if (!isAddress(d.usdc) || d.usdc.toLowerCase() !== ARC_TESTNET_USDC) {
    throw new Error(`deployment usdc ${d.usdc} is not the verified Arc testnet USDC ${ARC_TESTNET_USDC}`)
  }
  if (!isAddress(d.factory)) throw new Error(`deployment factory is missing or not an address: ${d.factory}`)
  if (!Number.isInteger(d.deployBlock) || d.deployBlock < 0) throw new Error('deployment deployBlock is missing')
  return {
    VITE_CHAIN_ID: String(d.chainId),
    VITE_FACTORY_ADDRESS: d.factory,
    VITE_USDC_ADDRESS: d.usdc,
    VITE_DEPLOY_BLOCK: String(d.deployBlock),
    // A static host has no SPA fallback and may serve from a sub-path (GitHub Pages).
    VITE_ROUTER_MODE: 'hash',
    VITE_BASE: './',
  }
}
