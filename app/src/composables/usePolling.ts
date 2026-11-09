import { onBeforeUnmount, onMounted } from 'vue'

/** Calls `fn` now and then every `ms` milliseconds while the component is mounted. */
export function usePolling(fn: () => void | Promise<void>, ms = 4000) {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void fn()
    timer = setInterval(() => void fn(), ms)
  })
  onBeforeUnmount(() => timer && clearInterval(timer))
}
