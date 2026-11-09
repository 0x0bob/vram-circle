/** On-chain submission status enum (ProjectVault.Status). */
export const Status = { None: 0, Submitted: 1, Approved: 2, Rejected: 3, Claimed: 4 } as const

export type DisplayStatus = 'pending' | 'approved' | 'auto-approved' | 'rejected' | 'claimed'

export interface StatusInput {
  status: number
  /** submittedAt + reviewPeriod (unix seconds). */
  reviewDeadline: bigint
}

/** Seconds left to review (0 once the window is over). `now` is chain time, never the browser clock. */
export function secondsLeft(deadline: bigint, now: bigint): number {
  return deadline > now ? Number(deadline - now) : 0
}

export function displayStatus(s: StatusInput, now: bigint): DisplayStatus {
  if (s.status === Status.Claimed) return 'claimed'
  if (s.status === Status.Rejected) return 'rejected'
  if (s.status === Status.Approved) return 'approved'
  return now >= s.reviewDeadline ? 'auto-approved' : 'pending'
}

/** A contributor can claim approved work, or work nobody reviewed before the deadline. */
export function isClaimable(s: StatusInput, now: bigint): boolean {
  const d = displayStatus(s, now)
  return d === 'approved' || d === 'auto-approved'
}

export const statusLabel: Record<DisplayStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  'auto-approved': 'Auto-approved (not reviewed in time)',
  rejected: 'Rejected',
  claimed: 'Claimed',
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s'
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSeconds}s`
}

export function formatDate(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}
