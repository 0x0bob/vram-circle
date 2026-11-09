import { defineStore } from 'pinia'
import { ref } from 'vue'
import { readBlockTime, readFeeBps, readPaused, readUsdcDecimals } from '../services/chain'

/** Protocol-wide facts: USDC decimals, current fee, pause flag and chain time. */
export const useProtocolStore = defineStore('protocol', () => {
  const decimals = ref(6)
  const feeBps = ref(1000)
  const paused = ref(false)
  /** Latest block timestamp. Used for every deadline, never the browser clock (Anvil time travel works). */
  const now = ref(0n)
  const error = ref<string | null>(null)

  async function load() {
    try {
      const [d, f, p, t] = await Promise.all([readUsdcDecimals(), readFeeBps(), readPaused(), readBlockTime()])
      decimals.value = d
      feeBps.value = f
      paused.value = p
      now.value = t
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  async function refreshTime() {
    try {
      now.value = await readBlockTime()
    } catch {
      /* keep the last known time */
    }
  }

  return { decimals, feeBps, paused, now, error, load, refreshTime }
})
