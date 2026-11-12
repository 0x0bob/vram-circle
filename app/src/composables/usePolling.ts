import { onBeforeUnmount, onMounted } from 'vue'
import { network } from '../config'
import { pollInterval } from '../networks'

/** Calls `fn` now and then every `ms` milliseconds (scaled up on public RPCs) while the component is mounted. */
export function usePolling(fn: () => void | Promise<void>, ms = 4000) {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void fn()
    timer = setInterval(() => void fn(), pollInterval(network, ms))
  })
  onBeforeUnmount(() => timer && clearInterval(timer))
}
