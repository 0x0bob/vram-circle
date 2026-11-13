<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConnection } from '@wagmi/vue'
import { useProjectRoute } from '../composables/useProjectRoute'
import { useTx } from '../composables/useTx'
import { useProtocolStore } from '../stores/protocol'
import { readAllowlisted, readContributorCount } from '../services/chain'
import { projectVaultAbi } from '../generated/abis'
import { hashText, isBytes32 } from '../lib/hash'
import { formatUsdc } from '../lib/format'
import { formatDate } from '../lib/status'
import { useTxStore } from '../stores/tx'
import { apiEnabled, fetchSpec, uploadText, type FileStatus } from '../services/agentApi'

const props = defineProps<{ vault: string; taskId: string }>()
const { vault, valid, project } = useProjectRoute(() => props.vault)
const protocol = useProtocolStore()
const { send } = useTx()
const txStore = useTxStore()
const { address } = useConnection()

const task = computed(() => project.taskById.get(Number(props.taskId)) ?? null)
const fmt = (v: bigint) => `${formatUsdc(v, protocol.decimals)} USDC`

// spec text lives off-chain; this browser may remember it if the creator wrote it here
const specText = computed(() => {
  if (!task.value) return null
  try {
    return localStorage.getItem(`vram.spec.${task.value.specHash}`)
  } catch {
    return null
  }
})

// Instructions fetched from storage by the on-chain spec hash and verified against it.
const fetchedSpec = ref<{ status: FileStatus; text: string | null } | null>(null)
watch(
  () => task.value?.specHash,
  async (h) => {
    fetchedSpec.value = null
    if (apiEnabled && h && !specText.value) {
      fetchedSpec.value = await fetchSpec(h).catch(() => ({ status: 'unavailable' as const, text: null }))
    }
  },
  { immediate: true },
)

const allowed = ref(false)
const mineCount = ref(0)
async function loadAccess() {
  if (!vault.value || !address.value || !task.value) return
  try {
    ;[allowed.value, mineCount.value] = await Promise.all([
      readAllowlisted(vault.value, task.value.id, address.value),
      readContributorCount(vault.value, task.value.id, address.value),
    ])
  } catch {
    /* leave defaults */
  }
}
watch([address, task, () => project.submissions.length], () => void loadAccess(), { immediate: true })

/** Why the current wallet cannot submit right now (null = it can). */
const blocker = computed<string | null>(() => {
  const t = task.value
  if (!t) return null
  if (protocol.paused) return 'Submissions are paused by the guardian.'
  if (!address.value) return 'Connect your wallet to submit.'
  if (t.closed) return 'This task is closed.'
  if (protocol.now >= t.deadline) return 'The deadline has passed.'
  if (t.active >= t.maxSubmissions) return 'All slots are taken.'
  if (t.allowlistOnly && !allowed.value) return 'This task is invite-only and your address is not on the allowlist.'
  if (mineCount.value >= t.maxPerContributor) return `You reached the limit of ${t.maxPerContributor} submission(s) for this task.`
  return null
})

const content = ref('')
const contentHash = ref('')
const uri = ref('')
function hashFromText() {
  contentHash.value = hashText(content.value)
}
const hashValid = computed(() => isBytes32(contentHash.value))

/** With the storage API the contributor just writes the answer: it is uploaded, and the verified hash and URI are used. */
const canSubmit = computed(() => (apiEnabled ? content.value.trim().length > 0 : hashValid.value && !!uri.value))

async function submit() {
  if (!vault.value || !task.value || !canSubmit.value) return
  if (apiEnabled) {
    let hash = contentHash.value
    let where = uri.value
    const stored = await txStore.track('Upload your answer', async () => {
      const r = await uploadText('submission', content.value) // throws if the service hashed different bytes
      hash = r.hash
      where = r.uri
    })
    if (!stored) return
    contentHash.value = hash
    uri.value = where
  }
  const ok = await send(`Submit work to task ${task.value.id}`, {
    address: vault.value,
    abi: projectVaultAbi,
    functionName: 'submit',
    args: [BigInt(task.value.id), contentHash.value, uri.value],
  })
  if (ok) {
    content.value = ''
    contentHash.value = ''
    uri.value = ''
  }
}
</script>

<template>
  <h1>Task {{ taskId }}</h1>
  <p v-if="!valid" class="banner error">That is not a valid project address.</p>
  <p v-else-if="!task && !project.loading" class="muted">Task not found.</p>
  <template v-else-if="task">
    <section class="card">
      <div class="stats">
        <div class="stat"><div class="muted">Reward to you</div><div class="v" data-testid="task-reward">{{ fmt(task.reward) }}</div></div>
        <div class="stat"><div class="muted">Slots left</div><div class="v" data-testid="slots-left">{{ Math.max(task.maxSubmissions - task.active, 0) }} / {{ task.maxSubmissions }}</div></div>
        <div class="stat"><div class="muted">Deadline</div><div class="v">{{ formatDate(task.deadline) }}</div></div>
        <div class="stat"><div class="muted">Access</div><div class="v">{{ task.allowlistOnly ? 'Invite only' : 'Open' }}</div></div>
      </div>
      <p class="note">
        You receive the full reward. The protocol fee is paid by the creator on top. Work not reviewed within
        {{ (project.info?.reviewPeriod ?? 0) / 86400 }} days can be claimed as approved.
      </p>
      <h2>Spec</h2>
      <pre v-if="specText" class="hash" style="white-space: pre-wrap">{{ specText }}</pre>
      <template v-else-if="fetchedSpec && fetchedSpec.status !== 'unavailable'">
        <p v-if="fetchedSpec.status === 'mismatch'" class="banner warn" style="margin: 0" data-testid="spec-mismatch">
          ⚠ These instructions do not match the spec hash stored on-chain. Do not rely on them.
        </p>
        <pre v-if="fetchedSpec.status === 'match'" class="hash" style="white-space: pre-wrap" data-testid="spec-text">{{ fetchedSpec.text }}</pre>
      </template>
      <p v-else class="note">Spec hash <code class="hash">{{ task.specHash }}</code> (the text is published off-chain by the creator).</p>
    </section>

    <section class="card">
      <h2>Submit work</h2>
      <p v-if="blocker" class="banner warn" style="margin: 0" data-testid="submit-blocker">{{ blocker }}</p>
      <template v-else>
        <template v-if="apiEnabled">
          <label for="content">Your answer</label>
          <textarea id="content" v-model="content" rows="6" data-testid="content-input" />
          <p class="note">
            Your answer is stored by VRAM and only its hash goes on-chain. Only the project creator, its reviewers and you can read it.
            The storage is trusted only to keep the file available: anyone can check it against the on-chain hash.
          </p>
        </template>
        <template v-else>
          <label for="content">Content (optional: paste it to compute the hash here, in your browser)</label>
          <textarea id="content" v-model="content" rows="4" data-testid="content-input" />
          <button class="secondary" type="button" @click="hashFromText">Hash this content</button>
          <label for="hash">Content hash (bytes32)</label>
          <input id="hash" v-model="contentHash" placeholder="0x…" data-testid="hash-input" />
          <label for="uri">Where the content is stored (URI)</label>
          <input id="uri" v-model="uri" placeholder="ipfs://…" data-testid="uri-input" />
        </template>
        <p style="margin-top: 0.9rem">
          <button :disabled="!canSubmit" data-testid="submit-work" @click="submit">Submit (sign in wallet)</button>
        </p>
      </template>
    </section>
  </template>
</template>
