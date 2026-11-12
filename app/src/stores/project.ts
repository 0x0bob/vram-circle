import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Address } from 'viem'
import {
  readReviewers,
  readSubmissions,
  readTasks,
  readVault,
  type SubmissionView,
  type TaskView,
  type VaultInfo,
} from '../services/chain'
import { useProtocolStore } from './protocol'

/** State of the project (vault) currently being viewed, read straight from the chain. */
export const useProjectStore = defineStore('project', () => {
  const vault = ref<Address | null>(null)
  const info = ref<VaultInfo | null>(null)
  const tasks = ref<TaskView[]>([])
  const submissions = ref<SubmissionView[]>([])
  const reviewers = ref<Address[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const taskById = computed(() => new Map(tasks.value.map((t) => [t.id, t])))

  async function fetchAll(v: Address) {
    const i = await readVault(v)
    const [t, s, r] = await Promise.all([
      readTasks(v, i.taskCount),
      readSubmissions(v, i.reviewPeriod),
      readReviewers(v),
    ])
    // ignore the result if the user switched project while we were loading
    if (vault.value !== v) return
    info.value = i
    tasks.value = t
    submissions.value = s
    reviewers.value = r
    error.value = null
  }

  async function load(v: Address) {
    if (vault.value !== v) {
      vault.value = v
      info.value = null
      tasks.value = []
      submissions.value = []
      reviewers.value = []
    }
    loading.value = true
    try {
      await fetchAll(v)
      await useProtocolStore().refreshTime()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** Re-read everything for the current vault (after a transaction, or on a timer). */
  async function refresh() {
    if (!vault.value) return
    try {
      await fetchAll(vault.value)
      await useProtocolStore().refreshTime()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  function reset() {
    vault.value = null
    info.value = null
    tasks.value = []
    submissions.value = []
    reviewers.value = []
    error.value = null
  }

  return { vault, info, tasks, submissions, reviewers, loading, error, taskById, load, refresh, reset }
})
