<script setup lang="ts">
import { computed, ref } from 'vue'
import { useConnection } from '@wagmi/vue'
import { useProjectRoute } from '../composables/useProjectRoute'
import { useTx } from '../composables/useTx'
import { useProtocolStore } from '../stores/protocol'
import { projectVaultAbi } from '../generated/abis'
import { displayStatus, formatDuration, isClaimable, secondsLeft, statusLabel } from '../lib/status'
import { formatUsdc } from '../lib/format'

const props = defineProps<{ vault: string }>()
const { vault, valid, project } = useProjectRoute(() => props.vault)
const protocol = useProtocolStore()
const { send } = useTx()
const { address } = useConnection()
const busy = ref(false)

const mine = computed(() =>
  project.submissions.filter((s) => address.value && s.contributor.toLowerCase() === address.value.toLowerCase()),
)
const fmt = (v: bigint) => `${formatUsdc(v, protocol.decimals)} USDC`
const rewardOf = (taskId: number) => project.taskById.get(taskId)?.reward ?? 0n

async function claim(id: number) {
  if (!vault.value) return
  busy.value = true
  await send(`Claim submission #${id}`, { address: vault.value, abi: projectVaultAbi, functionName: 'claim', args: [BigInt(id)] })
  busy.value = false
}
</script>

<template>
  <h1>My submissions</h1>
  <p v-if="!valid" class="banner error">That is not a valid project address.</p>
  <template v-else>
    <p v-if="!address" class="banner warn" style="margin-left: 0; margin-right: 0">Connect your wallet to see your submissions.</p>
    <section v-else class="card">
      <p v-if="mine.length === 0" class="muted" data-testid="no-submissions">You have not submitted anything to this project.</p>
      <table v-else class="table" data-testid="my-submissions">
        <thead><tr><th>#</th><th>Task</th><th>Reward</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="s in mine" :key="s.id" :data-testid="`my-row-${s.id}`">
            <td>{{ s.id }}</td>
            <td>{{ s.taskId }}</td>
            <td>{{ fmt(rewardOf(s.taskId)) }}</td>
            <td>
              <span class="tag" :class="displayStatus(s, protocol.now)" :data-testid="`status-${s.id}`">{{ statusLabel[displayStatus(s, protocol.now)] }}</span>
              <span v-if="displayStatus(s, protocol.now) === 'pending'" class="muted">
                auto-approves in {{ formatDuration(secondsLeft(s.reviewDeadline, protocol.now)) }}
              </span>
            </td>
            <td>
              <button v-if="isClaimable(s, protocol.now)" :disabled="busy" :data-testid="`claim-${s.id}`" @click="claim(s.id)">
                Claim (sign in wallet)
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </template>
</template>
