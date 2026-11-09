<script setup lang="ts">
import { onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import TxToasts from './components/TxToasts.vue'
import { useProtocolStore } from './stores/protocol'
import { isConfigured } from './config'

const protocol = useProtocolStore()
onMounted(() => {
  if (isConfigured) void protocol.load()
})
</script>

<template>
  <AppHeader />
  <main class="page">
    <p v-if="!isConfigured" class="banner error" data-testid="not-configured">
      The app is not configured. Set VITE_FACTORY_ADDRESS and VITE_USDC_ADDRESS (local dev: run
      <code>node scripts/dev.mjs</code>).
    </p>
    <p v-else-if="protocol.error" class="banner error">Cannot read the chain: {{ protocol.error }}</p>
    <p v-if="protocol.paused" class="banner warn" data-testid="paused-banner">
      New projects, tasks and submissions are paused by the guardian. Claims and withdrawals still work.
    </p>
    <router-view v-if="isConfigured" />
  </main>
  <TxToasts />
</template>
