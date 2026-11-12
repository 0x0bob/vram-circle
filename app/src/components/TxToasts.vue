<script setup lang="ts">
import { useTxStore } from '../stores/tx'

const tx = useTxStore()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="e in tx.entries" :key="e.id" class="toast" :class="e.status" :data-testid="`tx-${e.status}`">
      <strong>{{ e.label }}</strong>
      <span v-if="e.status === 'pending'"> — confirm in your wallet, then wait for the block…</span>
      <span v-else-if="e.status === 'success'"> — done</span>
      <span v-else> — failed: {{ e.message }}</span>
      <button class="link" aria-label="Dismiss" @click="tx.dismiss(e.id)">✕</button>
    </div>
  </div>
</template>
