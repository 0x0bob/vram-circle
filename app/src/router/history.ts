import { createWebHashHistory, createWebHistory } from 'vue-router'

/**
 * The static site (GitHub Pages) has no server fallback, so deep links and reloads only work with hash history.
 * scripts/build-arc-testnet.mjs sets VITE_ROUTER_MODE=hash; local dev and the e2e keep path-based URLs.
 */
export function makeHistory(mode: string | undefined) {
  return mode === 'hash' ? createWebHashHistory() : createWebHistory()
}
