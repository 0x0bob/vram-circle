<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from '@wagmi/vue'
import { chain, network } from '../config'
import { readGasBalance, readUsdcBalance } from '../services/chain'
import { useProtocolStore } from '../stores/protocol'
import { usePolling } from '../composables/usePolling'
import NetworkPill from './NetworkPill.vue'
import { formatNative, formatUsdc, shortAddr } from '../lib/format'

const route = useRoute()
const protocol = useProtocolStore()
const connectors = useConnectors()
const { mutate: connect, isPending, error: connectError } = useConnect()
const { mutate: disconnect } = useDisconnect()
const { mutate: switchChain } = useSwitchChain()
const { address, isConnected, chainId } = useConnection()

const wrongNetwork = computed(() => isConnected.value && chainId.value !== chain.id)
const balance = ref<bigint | null>(null)
/** Native gas balance (18 decimals on Arc), shown separately from the 6-decimal ERC-20 USDC balance. */
const gas = ref<bigint | null>(null)

async function loadBalance() {
  if (!address.value) {
    balance.value = null
    gas.value = null
    return
  }
  try {
    balance.value = await readUsdcBalance(address.value)
  } catch {
    balance.value = null
  }
  try {
    gas.value = await readGasBalance(address.value)
  } catch {
    gas.value = null
  }
}
usePolling(loadBalance, 5000)
watch(address, () => void loadBalance())

const vault = computed(() => (typeof route.params.vault === 'string' ? route.params.vault : null))
</script>

<template>
  <header class="header">
    <div class="brand">VRAM</div>
    <nav class="nav">
      <router-link to="/">Home</router-link>
      <router-link to="/creator">Creator</router-link>
      <template v-if="vault">
        <router-link :to="`/p/${vault}`">Project</router-link>
        <router-link :to="`/p/${vault}/review`">Review queue</router-link>
        <router-link :to="`/p/${vault}/me`">My submissions</router-link>
      </template>
    </nav>
    <div class="wallet">
      <NetworkPill :network="network" />
      <template v-if="isConnected && address">
        <span data-testid="account" :title="address">{{ shortAddr(address) }}</span>
        <span v-if="balance !== null" data-testid="usdc-balance" class="muted">
          {{ formatUsdc(balance, protocol.decimals) }} USDC
        </span>
        <span v-if="gas !== null" data-testid="gas-balance" class="muted" title="Native gas balance (18 decimals), separate from the USDC above">
          gas {{ formatNative(gas, network.nativeDecimals) }} {{ network.nativeSymbol }}
        </span>
        <button class="secondary" @click="disconnect()">Disconnect</button>
      </template>
      <template v-else>
        <button
          v-for="c in connectors.slice(0, 1)"
          :key="c.uid"
          data-testid="connect"
          :disabled="isPending"
          @click="connect({ connector: c })"
        >
          Connect wallet
        </button>
      </template>
    </div>
  </header>
  <p v-if="wrongNetwork" class="banner warn" data-testid="wrong-network">
    Your wallet is on the wrong network.
    <button class="secondary" @click="switchChain({ chainId: chain.id })">Switch to {{ chain.name }}</button>
  </p>
  <p v-if="connectError" class="banner error">{{ connectError.message }}</p>
</template>
