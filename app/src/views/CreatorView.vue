<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { erc20Abi, getAddress, isAddress, type Address } from 'viem'
import { useConnection } from '@wagmi/vue'
import { appConfig } from '../config'
import { useProtocolStore } from '../stores/protocol'
import { useProjectStore } from '../stores/project'
import { useTx } from '../composables/useTx'
import { usePolling } from '../composables/usePolling'
import { findProjects, readAllowance, readUsdcBalance } from '../services/chain'
import { projectFactoryAbi, projectVaultAbi } from '../generated/abis'
import CostSummary from '../components/CostSummary.vue'
import { formatUsdc, parseAddressList, parseUsdc, shortAddr, totalReservation } from '../lib/format'
import { hashText } from '../lib/hash'
import { formatDate } from '../lib/status'

const protocol = useProtocolStore()
const project = useProjectStore()
const { send } = useTx()
const { address, isConnected } = useConnection()

const fmt = (v: bigint) => `${formatUsdc(v, protocol.decimals)} USDC`

// ---------------------------------------------------------------- projects
const myProjects = ref<Address[]>([])
const selected = ref<Address | null>(null)
/** Reading the chain failed. The list is kept as it was, never emptied: that would look like losing the project. */
const projectsLoadFailed = ref(false)

async function loadProjects(selectLast = false) {
  if (!address.value) {
    myProjects.value = []
    return
  }
  try {
    myProjects.value = await findProjects(address.value)
    projectsLoadFailed.value = false
  } catch {
    projectsLoadFailed.value = true
    return
  }
  if (selectLast || !selected.value || !myProjects.value.includes(selected.value)) {
    selected.value = myProjects.value[myProjects.value.length - 1] ?? null
  }
}
watch(address, () => void loadProjects(), { immediate: true })

watch(selected, (v) => {
  if (v) void project.load(v)
  else project.reset()
})
usePolling(async () => {
  if (selected.value) await project.refresh()
}, 4000)

const isCreator = computed(
  () => !!address.value && project.info?.creator.toLowerCase() === address.value.toLowerCase(),
)

// ---------------------------------------------------------- create project
const metadataURI = ref('')
const creatorPct = ref('50')
const reviewDays = ref('7')
const creatorBps = computed(() => Math.round(Number(creatorPct.value) * 100))
const reviewSeconds = computed(() => Math.round(Number(reviewDays.value) * 86400))
const projectFormOk = computed(
  () => Number(creatorPct.value) >= 0 && Number(creatorPct.value) <= 100 && Number(reviewDays.value) >= 3 && Number(reviewDays.value) <= 30,
)

async function createProject() {
  if (!appConfig.factory) return
  const ok = await send('Create project', {
    address: appConfig.factory,
    abi: projectFactoryAbi,
    functionName: 'createProject',
    args: [metadataURI.value, creatorBps.value, reviewSeconds.value],
  })
  if (ok) {
    await loadProjects(true)
    metadataURI.value = ''
  }
}

// ----------------------------------------------------------------- deposit
const depositAmount = ref('')
const walletUsdc = ref<bigint | null>(null)
const allowance = ref<bigint>(0n)
async function loadBalances() {
  if (!address.value || !selected.value) return
  ;[walletUsdc.value, allowance.value] = await Promise.all([
    readUsdcBalance(address.value),
    readAllowance(address.value, selected.value),
  ]).catch(() => [null, 0n] as [bigint | null, bigint])
}
usePolling(loadBalances, 5000)
watch([address, selected], () => void loadBalances())

const depositParsed = computed(() => parseUsdc(depositAmount.value, protocol.decimals))
async function deposit() {
  if (!selected.value || !appConfig.usdc || !depositParsed.value) return
  const amount = depositParsed.value
  const calls = []
  if (allowance.value < amount) {
    calls.push({ address: appConfig.usdc, abi: erc20Abi, functionName: 'approve', args: [selected.value, amount] })
  }
  calls.push({ address: selected.value, abi: projectVaultAbi, functionName: 'deposit', args: [amount] })
  const ok = await send(`Deposit ${fmt(amount)}`, ...calls)
  if (ok) {
    depositAmount.value = ''
    await loadBalances()
  }
}

// --------------------------------------------------------------- reviewers
const reviewerInput = ref('')
async function setReviewer(addr: string, allowed: boolean) {
  if (!selected.value || !isAddress(addr, { strict: false })) return
  const ok = await send(`${allowed ? 'Add' : 'Remove'} reviewer`, {
    address: selected.value,
    abi: projectVaultAbi,
    functionName: 'setReviewer',
    args: [getAddress(addr), allowed],
  })
  if (ok && allowed) reviewerInput.value = ''
}

// -------------------------------------------------------------- create task
const reward = ref('100')
const maxSubs = ref('3')
const deadlineDays = ref('14')
const perContributor = ref('1')
const allowlistOnly = ref(true) // default: invite-only, so creators start with vetted contributors
const specText = ref('')

const rewardParsed = computed(() => parseUsdc(reward.value, protocol.decimals))
const maxParsed = computed(() => (/^\d+$/.test(maxSubs.value) && Number(maxSubs.value) > 0 ? Number(maxSubs.value) : null))
const perParsed = computed(() => (/^\d+$/.test(perContributor.value) && Number(perContributor.value) > 0 ? Number(perContributor.value) : null))
const daysParsed = computed(() => (Number(deadlineDays.value) > 0 ? Number(deadlineDays.value) : null))
const needed = computed(() =>
  rewardParsed.value && maxParsed.value ? totalReservation(rewardParsed.value, protocol.feeBps, maxParsed.value) : null,
)
const underfunded = computed(() => needed.value !== null && (project.info?.unreserved ?? 0n) < needed.value)
const taskFormOk = computed(
  () => !!(rewardParsed.value && maxParsed.value && perParsed.value && daysParsed.value && specText.value.trim()) && !underfunded.value,
)

async function createTask() {
  if (!selected.value || !taskFormOk.value) return
  const specHash = hashText(specText.value)
  const deadline = protocol.now + BigInt(Math.round(daysParsed.value! * 86400))
  const ok = await send('Create task', {
    address: selected.value,
    abi: projectVaultAbi,
    functionName: 'createTask',
    args: [
      {
        reward: rewardParsed.value!,
        maxSubmissions: maxParsed.value!,
        deadline,
        specHash,
        allowlistOnly: allowlistOnly.value,
        maxPerContributor: perParsed.value!,
      },
    ],
  })
  if (ok) {
    try {
      localStorage.setItem(`vram.spec.${specHash}`, specText.value) // convenience copy; the chain stores only the hash
    } catch {
      /* storage unavailable */
    }
    specText.value = ''
  }
}

// --------------------------------------------------------------- task admin
const allowTask = ref('')
const allowInput = ref('')
const allowParsed = computed(() => parseAddressList(allowInput.value))
async function setAllowlist(allowed: boolean) {
  if (!selected.value || !allowParsed.value || !allowTask.value) return
  const ok = await send(`${allowed ? 'Add to' : 'Remove from'} allowlist (task ${allowTask.value})`, {
    address: selected.value,
    abi: projectVaultAbi,
    functionName: 'setAllowlist',
    args: [BigInt(allowTask.value), allowParsed.value, allowed],
  })
  if (ok) allowInput.value = ''
}
async function openTask(id: number) {
  if (!selected.value) return
  await send(`Open task ${id} to everyone`, { address: selected.value, abi: projectVaultAbi, functionName: 'openTask', args: [BigInt(id)] })
}
async function closeTask(id: number) {
  if (!selected.value) return
  await send(`Close task ${id}`, { address: selected.value, abi: projectVaultAbi, functionName: 'closeTask', args: [BigInt(id)] })
}

// ----------------------------------------------------------------- withdraw
const withdrawAmount = ref('')
const withdrawParsed = computed(() => parseUsdc(withdrawAmount.value, protocol.decimals))
const withdrawOk = computed(
  () => !!withdrawParsed.value && withdrawParsed.value <= (project.info?.unreserved ?? 0n),
)
async function withdraw() {
  if (!selected.value || !withdrawParsed.value) return
  const ok = await send(`Withdraw ${fmt(withdrawParsed.value)}`, {
    address: selected.value,
    abi: projectVaultAbi,
    functionName: 'withdrawUnreserved',
    args: [withdrawParsed.value],
  })
  if (ok) withdrawAmount.value = ''
}
</script>

<template>
  <h1>Creator dashboard</h1>
  <p v-if="!isConnected" class="banner warn" style="margin-left: 0; margin-right: 0">Connect your wallet to create and manage projects.</p>

  <template v-else>
    <!-- ------------------------------------------------ projects -->
    <section class="card">
      <h2>Your projects</h2>
      <p v-if="projectsLoadFailed" class="note" data-testid="projects-error">
        Could not load your projects. The network is probably busy.
        <button class="secondary" data-testid="projects-retry" @click="loadProjects()">Retry</button>
      </p>
      <div v-if="myProjects.length" class="row">
        <div>
          <label for="proj">Selected project</label>
          <select id="proj" v-model="selected" data-testid="project-select">
            <option v-for="p in myProjects" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <router-link v-if="selected" :to="`/p/${selected}`" style="flex: 0 0 auto">Public page</router-link>
      </div>
      <p v-else-if="!projectsLoadFailed" class="muted">You have no projects yet. Create your first one below.</p>

      <h2 style="margin-top: 1.25rem">Create a project</h2>
      <label for="meta">Description or metadata URI</label>
      <input id="meta" v-model="metadataURI" placeholder="ipfs://… or a short description" data-testid="meta-input" />
      <div class="row">
        <div>
          <label for="split">Creator share of future license revenue (%)</label>
          <input id="split" v-model="creatorPct" inputmode="decimal" data-testid="split-input" />
        </div>
        <div>
          <label for="rev">Review period (days, 3 to 30)</label>
          <input id="rev" v-model="reviewDays" inputmode="decimal" data-testid="review-days-input" />
        </div>
      </div>
      <p class="note">
        Work nobody reviews within the review period can be claimed by the contributor as approved. The license
        split cannot be changed after creation.
      </p>
      <button :disabled="!projectFormOk || protocol.paused" data-testid="create-project" @click="createProject">
        Create project (sign in wallet)
      </button>
    </section>

    <template v-if="selected && project.info">
      <section class="card">
        <h2>Budget</h2>
        <p class="note">Vault: <code data-testid="vault-address">{{ project.info.address }}</code></p>
        <p v-if="!isCreator" class="banner warn" style="margin: 0 0 0.75rem">You are not the creator of this project. Creator-only actions will fail.</p>
        <div class="stats">
          <div class="stat"><div class="muted">Available to spend</div><div class="v" data-testid="unreserved">{{ fmt(project.info.unreserved) }}</div></div>
          <div class="stat"><div class="muted">Reserved by tasks</div><div class="v" data-testid="reserved">{{ fmt(project.info.reserved) }}</div></div>
          <div class="stat"><div class="muted">Your wallet</div><div class="v">{{ walletUsdc !== null ? fmt(walletUsdc) : '—' }}</div></div>
        </div>

        <div class="row" style="margin-top: 1rem">
          <div>
            <label for="dep">Deposit USDC</label>
            <input id="dep" v-model="depositAmount" inputmode="decimal" placeholder="1000" data-testid="deposit-input" />
          </div>
          <button :disabled="!depositParsed" data-testid="deposit" @click="deposit">
            {{ depositParsed && allowance < depositParsed ? 'Approve and deposit' : 'Deposit' }}
          </button>
        </div>
        <p class="note">Depositing may need two wallet confirmations: allow USDC, then deposit.</p>

        <div class="row" style="margin-top: 1rem">
          <div>
            <label for="wd">Withdraw unreserved USDC</label>
            <input id="wd" v-model="withdrawAmount" inputmode="decimal" data-testid="withdraw-input" />
          </div>
          <button class="secondary" type="button" @click="withdrawAmount = formatUsdc(project.info.unreserved, protocol.decimals).replace(/,/g, '')">Max</button>
          <button :disabled="!withdrawOk" data-testid="withdraw" @click="withdraw">Withdraw</button>
        </div>
        <p class="note">Only money not reserved by a task can leave. Close a task to free its unused reservation.</p>
      </section>

      <section class="card">
        <h2>Reviewers</h2>
        <p class="note">Reviewers can approve or reject submissions of this project only. They never touch money.</p>
        <ul class="list" data-testid="reviewer-list">
          <li v-for="r in project.reviewers" :key="r">
            <code :title="r">{{ r }}</code>
            <button class="secondary" @click="setReviewer(r, false)">Remove</button>
          </li>
          <li v-if="project.reviewers.length === 0" class="muted">No reviewers yet (you can review yourself).</li>
        </ul>
        <div class="row">
          <div>
            <label for="rv">Add a reviewer (wallet address)</label>
            <input id="rv" v-model="reviewerInput" placeholder="0x…" data-testid="reviewer-input" />
          </div>
          <button :disabled="!isAddress(reviewerInput, { strict: false })" data-testid="add-reviewer" @click="setReviewer(reviewerInput, true)">Add reviewer</button>
        </div>
      </section>

      <section class="card">
        <h2>Create a task</h2>
        <label for="spec">Task spec (hashed in your browser; publish the text where contributors can read it)</label>
        <textarea id="spec" v-model="specText" rows="3" data-testid="spec-input" />
        <div class="row">
          <div>
            <label for="rw">Reward to contributor (USDC)</label>
            <input id="rw" v-model="reward" inputmode="decimal" data-testid="reward-input" />
          </div>
          <div>
            <label for="mx">Max accepted submissions</label>
            <input id="mx" v-model="maxSubs" inputmode="numeric" data-testid="max-input" />
          </div>
          <div>
            <label for="dl">Deadline (days from now)</label>
            <input id="dl" v-model="deadlineDays" inputmode="decimal" data-testid="days-input" />
          </div>
          <div>
            <label for="pc">Max per contributor</label>
            <input id="pc" v-model="perContributor" inputmode="numeric" data-testid="per-input" />
          </div>
        </div>
        <label class="inline"><input v-model="allowlistOnly" type="checkbox" data-testid="allowlist-checkbox" /> Invite-only (only allowlisted wallets can submit). Recommended to start.</label>

        <CostSummary v-if="rewardParsed && maxParsed" :reward="rewardParsed" :fee-bps="protocol.feeBps" :max-submissions="maxParsed" :decimals="protocol.decimals" />
        <p v-if="underfunded" class="banner warn" style="margin: 0 0 0.75rem" data-testid="underfunded">
          Not enough available budget. Deposit more first: you need {{ needed !== null ? fmt(needed) : '' }}.
        </p>
        <button :disabled="!taskFormOk || protocol.paused" data-testid="create-task" @click="createTask">Create task (sign in wallet)</button>
      </section>

      <section class="card">
        <h2>Tasks</h2>
        <p v-if="project.tasks.length === 0" class="muted">No tasks yet.</p>
        <table v-else class="table" data-testid="creator-tasks">
          <thead><tr><th>#</th><th>Reward</th><th>Used</th><th>Deadline</th><th>State</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="t in project.tasks" :key="t.id" :data-testid="`task-row-${t.id}`">
              <td><router-link :to="`/p/${project.info.address}/task/${t.id}`">{{ t.id }}</router-link></td>
              <td>{{ fmt(t.reward) }}</td>
              <td>{{ t.active }} / {{ t.maxSubmissions }}</td>
              <td>{{ formatDate(t.deadline) }}</td>
              <td><span class="tag">{{ t.closed ? 'Closed' : t.allowlistOnly ? 'Invite only' : 'Open' }}</span></td>
              <td class="row" style="gap: 0.4rem">
                <button v-if="t.allowlistOnly && !t.closed" class="secondary" :data-testid="`open-task-${t.id}`" @click="openTask(t.id)">Open to everyone</button>
                <button v-if="!t.closed" class="secondary" :data-testid="`close-task-${t.id}`" @click="closeTask(t.id)">Close</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="note">Opening a task to everyone cannot be undone for that task.</p>

        <h2 style="margin-top: 1.25rem">Allowlist</h2>
        <div class="row">
          <div>
            <label for="at">Task</label>
            <select id="at" v-model="allowTask" data-testid="allow-task">
              <option value="" disabled>Choose…</option>
              <option v-for="t in project.tasks" :key="t.id" :value="String(t.id)">Task {{ t.id }}</option>
            </select>
          </div>
        </div>
        <label for="al">Wallet addresses (separated by spaces, commas or new lines)</label>
        <textarea id="al" v-model="allowInput" rows="2" data-testid="allow-input" />
        <p style="margin-top: 0.6rem">
          <button :disabled="!allowParsed || !allowTask" data-testid="allow-add" @click="setAllowlist(true)">Add to allowlist</button>
          <button class="secondary" :disabled="!allowParsed || !allowTask" style="margin-left: 0.5rem" @click="setAllowlist(false)">Remove</button>
        </p>
        <p class="note" v-if="project.reviewers.length">Reviewers: {{ project.reviewers.map(shortAddr).join(', ') }}</p>
      </section>
    </template>
  </template>
</template>
