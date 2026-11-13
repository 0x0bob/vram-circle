<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConnection } from '@wagmi/vue'
import { useProjectRoute } from '../composables/useProjectRoute'
import { useTx } from '../composables/useTx'
import { useProtocolStore } from '../stores/protocol'
import { readIsReviewer } from '../services/chain'
import { projectVaultAbi } from '../generated/abis'
import ReviewQueue from '../components/ReviewQueue.vue'
import { displayStatus, formatDuration, secondsLeft, statusLabel } from '../lib/status'
import { shortAddr } from '../lib/format'
import { signMessage } from '@wagmi/core'
import { wagmiConfig } from '../wagmi'
import { chain } from '../config'
import { apiEnabled, createAccess } from '../services/agentApi'
import { useReviewDetails } from '../composables/useReviewDetails'

const props = defineProps<{ vault: string }>()
const { vault, valid, project } = useProjectRoute(() => props.vault)
const protocol = useProtocolStore()
const { send } = useTx()
const { address } = useConnection()

const isReviewer = ref(false)
watch(
  [address, vault, () => project.reviewers.length],
  async () => {
    isReviewer.value = !!(vault.value && address.value && (await readIsReviewer(vault.value, address.value).catch(() => false)))
  },
  { immediate: true },
)
const canReview = computed(() => isReviewer.value || (!!address.value && project.info?.creator === address.value))

const pending = computed(() =>
  project.submissions.filter((s) => displayStatus(s, protocol.now) === 'pending'),
)
const decided = computed(() =>
  project.submissions.filter((s) => displayStatus(s, protocol.now) !== 'pending'),
)
const busy = ref(false)

// Content and agent advice. Reading needs a wallet signature (a login, not a transaction), asked once per project.
const access = createAccess({ chainId: chain.id, sign: (message) => signMessage(wagmiConfig, { message }) })
const { details, open, screen } = useReviewDetails({ vault, submissions: () => project.submissions, access })

async function approve(id: number) {
  if (!vault.value) return
  busy.value = true
  await send(`Approve submission #${id}`, { address: vault.value, abi: projectVaultAbi, functionName: 'approve', args: [BigInt(id)] })
  busy.value = false
}

async function reject(id: number, reasonHash: `0x${string}`) {
  if (!vault.value) return
  busy.value = true
  await send(`Reject submission #${id}`, {
    address: vault.value,
    abi: projectVaultAbi,
    functionName: 'reject',
    args: [BigInt(id), reasonHash],
  })
  busy.value = false
}
</script>

<template>
  <h1>Reviewer queue</h1>
  <p v-if="!valid" class="banner error">That is not a valid project address.</p>
  <template v-else>
    <p v-if="!address" class="banner warn" style="margin-left: 0; margin-right: 0">Connect your wallet to review.</p>
    <p v-else-if="!canReview" class="banner warn" style="margin-left: 0; margin-right: 0" data-testid="not-reviewer">
      Your wallet is not a reviewer of this project. You can look, but approve and reject would fail.
    </p>

    <section class="card">
      <h2>Waiting for review ({{ pending.length }})</h2>
      <p class="note">
        A rejection needs a reason. The reason is hashed in your browser and only the hash is stored on-chain.
        Work not reviewed before the timer runs out becomes claimable by the contributor as approved.
      </p>
      <ReviewQueue
        :submissions="pending"
        :now="protocol.now"
        :busy="busy || !canReview"
        :agent-enabled="apiEnabled && canReview"
        :details="details"
        @approve="approve"
        @reject="reject"
        @open="open"
        @screen="screen"
      />
    </section>

    <section class="card">
      <h2>Already decided or past the review window</h2>
      <p v-if="decided.length === 0" class="muted">None.</p>
      <table v-else class="table">
        <thead><tr><th>#</th><th>Task</th><th>Contributor</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="s in decided" :key="s.id" :data-testid="`decided-${s.id}`">
            <td>{{ s.id }}</td>
            <td>{{ s.taskId }}</td>
            <td :title="s.contributor">{{ shortAddr(s.contributor) }}</td>
            <td><span class="tag" :class="displayStatus(s, protocol.now)">{{ statusLabel[displayStatus(s, protocol.now)] }}</span>
              <span v-if="s.status === 1" class="muted"> (window ended {{ formatDuration(Number(protocol.now - s.reviewDeadline)) }} ago)</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>
