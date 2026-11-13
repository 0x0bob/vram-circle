<script setup lang="ts">
import { computed } from 'vue'
import type { Advice } from '../services/agentApi'

const props = defineProps<{
  submissionId: number
  advice: Advice | null
  loading: boolean
  /** A request error (rate limit, network), shown with a retry. */
  error?: string
}>()
defineEmits<{ run: [] }>()

const SKIPPED: Record<string, string> = {
  no_api_key: 'AI scoring is not configured on this site. The other checks still ran.',
  daily_cap: 'The daily AI budget is used up. The other checks still ran.',
  daily_calls: 'The daily AI call limit is reached. The other checks still ran.',
  ledger_unavailable: 'AI scoring is paused because the spend ledger is unavailable.',
  hash_mismatch: 'Not scored: the content does not match the hash stored on-chain.',
  content_unavailable: 'Not scored: the content was not found in storage.',
  instructions_unavailable: 'Not scored: the task instructions were not found in storage.',
  instructions_mismatch: 'Not scored: the task instructions do not match the spec hash stored on-chain.',
}

const FLAGS: Record<string, string> = {
  empty: 'The answer is empty.',
  too_short: 'The answer is very short.',
  too_long: 'The answer is very long.',
  control_characters: 'The answer contains control characters.',
  repetitive: 'The answer repeats itself heavily.',
}

const hash = computed(() => props.advice?.checks.hash.status)
const injection = computed(
  () => !!props.advice && (props.advice.checks.injectionSuspected || (props.advice.ai.status === 'ok' && props.advice.ai.injectionSuspected)),
)
const when = computed(() => (props.advice ? props.advice.createdAt.replace('T', ' ').slice(0, 16) + ' UTC' : ''))
</script>

<template>
  <div class="advice" :data-testid="`agent-advice-${submissionId}`">
    <div class="eyebrow">Agent advice · advice only, you decide</div>

    <template v-if="!advice">
      <p v-if="error" class="note" data-testid="agent-error">{{ error }}</p>
      <button class="secondary" :disabled="loading" :data-testid="`agent-run-${submissionId}`" @click="$emit('run')">
        {{ loading ? 'Screening…' : error ? 'Try again' : 'Run screening' }}
      </button>
    </template>

    <template v-else>
      <p v-if="hash === 'mismatch'" class="warn" :data-testid="`warn-hash-${submissionId}`">
        ⚠ The content does not match the hash stored on-chain. Do not trust this text.
      </p>
      <p v-else-if="hash === 'unavailable'" class="note">The content was not found in storage.</p>

      <p v-if="injection" class="warn" :data-testid="`warn-injection-${submissionId}`">
        ⚠ This answer seems to address the scorer or grader instead of the task. Read it yourself.
      </p>

      <template v-if="advice.ai.status === 'ok'">
        <div class="score" :data-testid="`agent-score-${submissionId}`">
          <span class="n">{{ advice.ai.score }}</span><span class="muted">/100</span>
        </div>
        <ul class="reasons">
          <li v-for="(r, i) in advice.ai.reasons" :key="i">{{ r }}</li>
        </ul>
        <p v-if="advice.ai.truncated" class="note">Only the first part of a very long answer was scored (truncated).</p>
      </template>
      <p v-else-if="advice.ai.status === 'skipped'" class="note">{{ SKIPPED[advice.ai.reason] ?? `Not scored (${advice.ai.reason}).` }}</p>
      <p v-else class="warn">AI scoring failed ({{ advice.ai.reason }}). The other checks still ran.</p>

      <ul v-if="advice.checks.format && advice.checks.format.flags.length" class="reasons">
        <li v-for="f in advice.checks.format.flags" :key="f">{{ FLAGS[f] ?? f }}</li>
      </ul>

      <p v-if="advice.checks.copies.length" class="note" :data-testid="`agent-copies-${submissionId}`">
        Similar to
        <span v-for="(c, i) in advice.checks.copies" :key="c.id">{{ i ? ', ' : '' }}submission #{{ c.id }} ({{ Math.round(c.similarity * 100) }}%)</span>.
        Two experts can reach the same answer: this is a prompt to look, not a verdict.
      </p>

      <p class="note audit">
        <template v-if="advice.ai.status !== 'skipped'">{{ advice.ai.model }} · {{ advice.ai.promptVersion }} · </template>{{ when }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.advice { border: 1px solid var(--line); border-radius: 12px; padding: 0.7rem 0.9rem; background: var(--soft); }
.score .n { font-family: var(--font-display); font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; background: var(--neon); padding: 0 0.35rem; border-radius: 6px; }
.reasons { margin: 0.4rem 0; padding-left: 1.1rem; }
.warn { margin: 0.5rem 0; padding: 0.45rem 0.6rem; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--warn-bg); font-weight: 500; }
.audit { margin: 0.4rem 0 0; font-family: var(--font-mono); font-size: 0.72rem; }
</style>
