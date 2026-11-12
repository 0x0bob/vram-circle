<script setup lang="ts">
import { computed } from 'vue'
import { feeOn, formatUsdc, totalReservation } from '../lib/format'

const props = defineProps<{
  reward: bigint
  feeBps: number
  maxSubmissions: number
  decimals: number
}>()

const fee = computed(() => feeOn(props.reward, props.feeBps))
const feePct = computed(() => (props.feeBps / 100).toString())
const total = computed(() => totalReservation(props.reward, props.feeBps, props.maxSubmissions))
const fmt = (v: bigint) => `${formatUsdc(v, props.decimals)} USDC`
</script>

<template>
  <dl class="cost">
    <dt>Reward to contributor (per accepted submission)</dt>
    <dd data-testid="cost-reward">{{ fmt(reward) }}</dd>
    <dt>Protocol fee on top ({{ feePct }}%, paid by you, not the contributor)</dt>
    <dd data-testid="cost-fee">{{ fmt(fee) }}</dd>
    <dt>Cost per accepted submission</dt>
    <dd data-testid="cost-per">{{ fmt(reward + fee) }}</dd>
    <dt>Reserved up front ({{ maxSubmissions }} submissions)</dt>
    <dd data-testid="cost-total">{{ fmt(total) }}</dd>
  </dl>
</template>
