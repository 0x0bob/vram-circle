<script setup lang="ts">
import { ref } from 'vue'
import type { SubmissionView } from '../services/chain'
import { formatDuration, secondsLeft } from '../lib/status'
import { hashText } from '../lib/hash'
import { shortAddr } from '../lib/format'

defineProps<{
  submissions: SubmissionView[]
  /** Chain time (unix seconds). */
  now: bigint
  busy?: boolean
}>()

const emit = defineEmits<{
  approve: [id: number]
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
      <tr v-for="s in submissions" :key="s.id" :data-testid="`queue-row-${s.id}`">
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
    </tbody>
  </table>
</template>
