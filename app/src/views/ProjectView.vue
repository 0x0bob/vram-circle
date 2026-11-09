<script setup lang="ts">
import { useProjectRoute } from '../composables/useProjectRoute'
import { useProtocolStore } from '../stores/protocol'
import { formatDate } from '../lib/status'
import { formatUsdc, shortAddr } from '../lib/format'

const props = defineProps<{ vault: string }>()
const { valid, project } = useProjectRoute(() => props.vault)
const protocol = useProtocolStore()
const fmt = (v: bigint) => `${formatUsdc(v, protocol.decimals)} USDC`

function taskState(t: (typeof project.tasks)[number]): string {
  if (t.closed) return 'Closed'
  if (protocol.now >= t.deadline) return 'Past deadline'
  if (t.active >= t.maxSubmissions) return 'Full'
  return t.allowlistOnly ? 'Invite only' : 'Open to everyone'
}
</script>

<template>
  <h1>Project</h1>
  <p v-if="!valid" class="banner error">That is not a valid project address.</p>
  <template v-else>
    <p v-if="project.error" class="banner error">{{ project.error }}</p>
    <section v-if="project.info" class="card">
      <div class="stats">
        <div class="stat"><div class="muted">Creator</div><div class="v" :title="project.info.creator">{{ shortAddr(project.info.creator) }}</div></div>
        <div class="stat"><div class="muted">Review period</div><div class="v">{{ project.info.reviewPeriod / 86400 }} days</div></div>
        <div class="stat"><div class="muted">Tasks</div><div class="v">{{ project.info.taskCount }}</div></div>
        <div class="stat"><div class="muted">Submissions</div><div class="v">{{ project.info.submissionCount }}</div></div>
      </div>
      <p class="note">Metadata: {{ project.info.metadataURI || '—' }}</p>
    </section>

    <section class="card">
      <h2>Tasks</h2>
      <p v-if="project.tasks.length === 0" class="muted">No tasks yet.</p>
      <table v-else class="table" data-testid="task-table">
        <thead>
          <tr><th>#</th><th>Reward to contributor</th><th>Slots left</th><th>Deadline</th><th>State</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="t in project.tasks" :key="t.id">
            <td>{{ t.id }}</td>
            <td>{{ fmt(t.reward) }}</td>
            <td>{{ Math.max(t.maxSubmissions - t.active, 0) }} / {{ t.maxSubmissions }}</td>
            <td>{{ formatDate(t.deadline) }}</td>
            <td><span class="tag">{{ taskState(t) }}</span></td>
            <td><router-link :data-testid="`task-link-${t.id}`" :to="`/p/${vault}/task/${t.id}`">Open</router-link></td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>
