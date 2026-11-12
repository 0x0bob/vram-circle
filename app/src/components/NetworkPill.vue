<script setup lang="ts">
import type { NetworkInfo } from '../networks'
defineProps<{ network: NetworkInfo }>()
</script>

<template>
  <span class="pill" data-testid="network-pill" :title="`Connected network: ${network.name} (chain ${network.id}). Test funds only.`">
    <i class="dot" />{{ network.name }}
  </span>
</template>
