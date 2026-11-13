<script setup lang="ts">
import { ref } from 'vue'
import type { SubmissionView } from '../services/chain'
import { formatDuration, secondsLeft } from '../lib/status'
import { hashText } from '../lib/hash'
import { shortAddr } from '../lib/format'
import AgentAdvice from './AgentAdvice.vue'
import ContentPreview, { type ContentState } from './ContentPreview.vue'
import type { Advice } from '../services/agentApi'

export interface Details {
  content: ContentState
  advice: Advice | null
  loading: boolean
  error?: string
}

defineProps<{
  submissions: SubmissionView[]
  /** Chain time (unix seconds). */
  now: bigint
  busy?: boolean
  /** The agent API exists on this site: show content and agent advice. */
  agentEnabled?: boolean
  /** Per submission id: loaded content and advice. Absent until the reviewer opens it. */
  details?: Record<number, Details | undefined>
}>()

const emit = defineEmits<{
  approve: [id: number]
  /** Load the verified content and stored advice (asks the wallet to sign in once per project). */
  open: [id: number]
  /** Run the agent for this submission. */
  screen: [id: number]
  /** The reason is hashed in the browser; only the hash goes on-chain. */
  reject: [id: number, reasonHash: `0x${string}`, reason: string]
}>()

const reasons = ref<Record<number, string>>({})

function reject(id: number) {
  const reason = (reasons.value[id] ?? '').trim()
  if (!reason) return
  emit('reject', id, hashText(reason), reason)
}
</script>

<template>
  <p v-if="submissions.length === 0" class="muted" data-testid="queue-empty">Nothing waiting for review.</p>
  <table v-else class="table" data-testid="review-queue">
    <thead>
      <tr>
        <th>#</th>
        <th>Task</th>
        <th>Contributor</th>
        <th>Content</th>
        <th>Time left before auto-approve</th>
        <th>Decision</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="s in submissions" :key="s.id">
      <tr :data-testid="`queue-row-${s.id}`">
        <td>{{ s.id }}</td>
        <td>{{ s.taskId }}</td>
        <td :title="s.contributor">{{ shortAddr(s.contributor) }}</td>
        <td>
          <div>{{ s.uri }}</div>
          <code class="hash">{{ s.contentHash }}</code>
        </td>
        <td data-testid="time-left">{{ formatDuration(secondsLeft(s.reviewDeadline, now)) }}</td>
        <td class="decision">
          <button :disabled="busy" :data-testid="`approve-${s.id}`" @click="emit('approve', s.id)">Approve</button>
          <input v-model="reasons[s.id]" placeholder="Reason for rejecting (required)" :data-testid="`reason-${s.id}`" />
          <button
            class="danger"
            :disabled="busy || !(reasons[s.id] ?? '').trim()"
            :data-testid="`reject-${s.id}`"
            @click="reject(s.id)"
          >
            Reject
          </button>
        </td>
      </tr>
      <tr v-if="agentEnabled" :data-testid="`details-row-${s.id}`">
        <td colspan="6">
          <button v-if="!details?.[s.id]" class="secondary" :data-testid="`open-details-${s.id}`" @click="emit('open', s.id)">
            Show content &amp; agent advice
          </button>
          <div v-else class="details">
            <ContentPreview :submission-id="s.id" :content="details[s.id]!.content" />
            <AgentAdvice
              :submission-id="s.id"
              :advice="details[s.id]!.advice"
              :loading="details[s.id]!.loading"
              :error="details[s.id]!.error"
              @run="emit('screen', s.id)"
            />
          </div>
        </td>
      </tr>
      </template>

    </tbody>
  </table>
</template>

<style scoped>
.details { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
</style>
