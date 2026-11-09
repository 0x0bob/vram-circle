import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface TxEntry {
  id: number
  label: string
  status: 'pending' | 'success' | 'error'
  hash?: string
  message?: string
}

/** Short, readable message from a viem/wagmi error (custom contract errors are decoded by viem). */
export function errorMessage(e: unknown): string {
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
