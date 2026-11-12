import { describe, expect, it } from 'vitest'
import { Status, displayStatus, formatDuration, isClaimable, secondsLeft } from './status'

const deadline = 1_000n

describe('displayStatus (chain time decides, not the browser clock)', () => {
  it('pending before the review deadline, auto-approved at or after it', () => {
    expect(displayStatus({ status: Status.Submitted, reviewDeadline: deadline }, 999n)).toBe('pending')
    expect(displayStatus({ status: Status.Submitted, reviewDeadline: deadline }, 1_000n)).toBe('auto-approved')
    expect(displayStatus({ status: Status.Submitted, reviewDeadline: deadline }, 5_000n)).toBe('auto-approved')
  })
  it('keeps explicit decisions', () => {
    expect(displayStatus({ status: Status.Approved, reviewDeadline: deadline }, 1n)).toBe('approved')
    expect(displayStatus({ status: Status.Rejected, reviewDeadline: deadline }, 9_999n)).toBe('rejected')
    expect(displayStatus({ status: Status.Claimed, reviewDeadline: deadline }, 9_999n)).toBe('claimed')
  })
})

describe('isClaimable', () => {
  it('is true for approved and auto-approved only', () => {
    expect(isClaimable({ status: Status.Approved, reviewDeadline: deadline }, 1n)).toBe(true)
    expect(isClaimable({ status: Status.Submitted, reviewDeadline: deadline }, 1_000n)).toBe(true)
    expect(isClaimable({ status: Status.Submitted, reviewDeadline: deadline }, 10n)).toBe(false)
    expect(isClaimable({ status: Status.Rejected, reviewDeadline: deadline }, 9_999n)).toBe(false)
    expect(isClaimable({ status: Status.Claimed, reviewDeadline: deadline }, 9_999n)).toBe(false)
  })
})

describe('time helpers', () => {
  it('secondsLeft never goes negative', () => {
    expect(secondsLeft(100n, 40n)).toBe(60)
    expect(secondsLeft(100n, 100n)).toBe(0)
    expect(secondsLeft(100n, 500n)).toBe(0)
  })
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(3 * 60)).toBe('3m')
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2h 5m')
    expect(formatDuration(7 * 86400)).toBe('7d 0h')
  })
})
