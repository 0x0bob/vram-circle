<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useConnection } from '@wagmi/vue'
import { getAddress, isAddress, type Address } from 'viem'
import { findProjects } from '../services/chain'
import { shortAddr } from '../lib/format'

const router = useRouter()
const { address, isConnected } = useConnection()
const input = ref('')
const mine = ref<Address[]>([])
const error = ref('')

watch(
  address,
  async (a) => {
    mine.value = a ? await findProjects(a).catch(() => []) : []
  },
  { immediate: true },
)

function open() {
  if (!isAddress(input.value.trim(), { strict: false })) {
    error.value = 'Enter a valid project (vault) address.'
    return
  }
  error.value = ''
  void router.push(`/p/${getAddress(input.value.trim())}`)
}
</script>

<template>
  <section class="hero">
    <span class="eyebrow">Training data marketplace · on Arc</span>
    <h1>Expert data.<br /><mark>Paid</mark> in USDC.</h1>
    <p class="lead">
      Creators lock USDC in a project vault before any work starts. Contributors complete tasks. Reviewers accept or
      reject, and accepted work is paid straight from the vault. Every action is a transaction signed in your own wallet.
    </p>
    <div class="cta">
      <router-link class="primary" to="/creator">Start a project →</router-link>
      <a href="#open">Open a project</a>
    </div>
    <div class="facts" data-testid="facts">
      <div class="fact"><div class="n">10%</div><div class="c">Protocol fee, on top of the reward</div></div>
      <div class="fact"><div class="n">48h</div><div class="c">Timelock on every parameter change</div></div>
      <div class="fact"><div class="n">7d</div><div class="c">Review window, then contributors can claim</div></div>
      <div class="fact"><div class="n">0</div><div class="c">Backend keys that can move funds</div></div>
    </div>
  </section>

  <section id="open" class="card">
    <h2>Open a project</h2>
    <div class="row">
      <div>
        <label for="vault">Project (vault) address</label>
        <input id="vault" v-model="input" placeholder="0x…" data-testid="open-vault-input" @keyup.enter="open" />
      </div>
      <button data-testid="open-vault" @click="open">Open</button>
    </div>
    <p v-if="error" class="note">{{ error }}</p>
  </section>

  <section class="card">
    <h2>Projects I created</h2>
    <p v-if="!isConnected" class="muted">Connect your wallet to see your projects.</p>
    <p v-else-if="mine.length === 0" class="muted">None yet. Create one on the <router-link to="/creator">Creator</router-link> page.</p>
    <ul v-else class="list">
      <li v-for="v in mine" :key="v">
        <code :title="v">{{ shortAddr(v) }}</code>
        <router-link :to="`/p/${v}`">Open</router-link>
      </li>
    </ul>
  </section>
</template>
