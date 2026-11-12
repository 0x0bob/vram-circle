import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem'

export const BPS = 10_000n

/** Fee charged ON TOP of a reward. Same rounding as ProjectVault.createTask (floor). */
export function feeOn(reward: bigint, feeBps: number | bigint): bigint {
  return (reward * BigInt(feeBps)) / BPS
}

/** Total the vault reserves for a task: (reward + fee) * maxSubmissions. */
export function totalReservation(reward: bigint, feeBps: number | bigint, max: number | bigint): bigint {
  return (reward + feeOn(reward, feeBps)) * BigInt(max)
}

/** "1,234.5" style display, no trailing zeros. */
export function formatUsdc(amount: bigint, decimals = 6): string {
  const s = formatUnits(amount, decimals)
  const [int, frac = ''] = s.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/**
 * Gas balance: the native currency, 18 decimals on Arc. Never feed an ERC-20 USDC amount (6 decimals)
 * to this, or the reverse. Display is trimmed to 6 places.
 */
export function formatNative(amount: bigint, decimals = 18): string {
  const s = formatUnits(amount, decimals)
  const [int, frac = ''] = s.split('.')
  const trimmed = frac.slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${int}.${trimmed}` : int
}

/** Parses a user-typed amount; returns null when empty, malformed, zero or negative. */
export function parseUsdc(input: string, decimals = 6): bigint | null {
  const t = input.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const [, frac = ''] = t.split('.')
  if (frac.length > decimals) return null
  const v = parseUnits(t, decimals)
  return v > 0n ? v : null
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/** Splits comma/space/newline separated addresses; returns null if any entry is invalid. */
export function parseAddressList(input: string): Address[] | null {
  const parts = input.split(/[\s,;]+/).filter(Boolean)
  if (parts.length === 0 || !parts.every((p) => isAddress(p, { strict: false }))) return null
  return parts.map((p) => getAddress(p))
}
