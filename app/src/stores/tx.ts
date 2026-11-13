import { defineStore } from 'pinia'
import { ref } from 'vue'
import { isRateLimit } from '../lib/paginate'

export interface TxEntry {
  id: number
  label: string
  status: 'pending' | 'success' | 'error'
  hash?: string
  message?: string
}

type ErrLike = { shortMessage?: string; message?: string; details?: string; code?: number; cause?: unknown }

/** All the text of an error and its causes, so a wrapped wallet or RPC message is still recognised. */
function errorText(e: unknown, depth = 0): string {
  if (!e || typeof e !== 'object' || depth > 4) return ''
  const x = e as ErrLike
  return [x.shortMessage, x.message, x.details, errorText(x.cause, depth + 1)].filter(Boolean).join(' | ')
}

function hasCode(e: unknown, code: number, depth = 0): boolean {
  if (!e || typeof e !== 'object' || depth > 4) return false
  const x = e as ErrLike
  return x.code === code || hasCode(x.cause, code, depth + 1)
}

/** The wallet refused the request because the account/method is not authorized for this site (EIP-1193 code 4100). */
const isUnauthorized = (e: unknown) => hasCode(e, 4100) || /not been authorized/i.test(errorText(e))

/**
 * Short, readable message from a viem/wagmi error (custom contract errors are decoded by viem). Rate limits and wallet
 * authorization failures get advice a user can act on. Genuine contract reverts are shown as they are.
 */
export function errorMessage(e: unknown): string {
  if (isRateLimit(e) || /rate limit/i.test(errorText(e))) {
    return 'The public Arc RPC is busy (rate limited). Wait a few seconds and try again.'
  }
  if (isUnauthorized(e)) {
    return 'Your wallet has not authorized this account for this site. Unlock the wallet, connect the account with Connect wallet, then try again.'
  }
  const err = e as { shortMessage?: string; message?: string; cause?: { shortMessage?: string } }
  return err?.shortMessage ?? err?.cause?.shortMessage ?? err?.message ?? 'Transaction failed'
}

export const useTxStore = defineStore('tx', () => {
  const entries = ref<TxEntry[]>([])
  let nextId = 1

  /** Runs a wallet-signed action and records its progress. Resolves true on success, false on failure. */
  async function track(label: string, run: (setHash: (h: string) => void) => Promise<void>): Promise<boolean> {
    const entry: TxEntry = { id: nextId++, label, status: 'pending' }
    entries.value = [entry, ...entries.value].slice(0, 8)
    const live = () => entries.value.find((e) => e.id === entry.id) as TxEntry
    try {
      await run((h) => {
        live().hash = h
      })
      live().status = 'success'
      return true
    } catch (e) {
      const l = live()
      l.status = 'error'
      l.message = errorMessage(e)
      return false
    }
  }

  function dismiss(id: number) {
    entries.value = entries.value.filter((e) => e.id !== id)
  }

  function clear() {
    entries.value = []
  }

  return { entries, track, dismiss, clear }
})
