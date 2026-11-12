import { computed, watch } from 'vue'
import { getAddress, isAddress } from 'viem'
import { useProjectStore } from '../stores/project'
import { usePolling } from './usePolling'

/** Loads and keeps fresh the project (vault) named in the route. */
export function useProjectRoute(vaultParam: () => string) {
  const project = useProjectStore()
  const valid = computed(() => isAddress(vaultParam(), { strict: false }))
  const vault = computed(() => (valid.value ? getAddress(vaultParam()) : null))

  async function tick() {
    if (!vault.value) return
    if (project.vault === vault.value) await project.refresh()
    else await project.load(vault.value)
  }

  watch(vault, () => void tick())
  usePolling(tick, 4000)
  return { vault, valid, project }
}
