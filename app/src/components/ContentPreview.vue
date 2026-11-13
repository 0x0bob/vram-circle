<script setup lang="ts">
import { ref } from 'vue'

export interface ContentState {
  status: 'loading' | 'match' | 'mismatch' | 'unauthorized' | 'forbidden' | 'unavailable'
  text: string | null
}

defineProps<{ submissionId: number; content: ContentState }>()
const showAnyway = ref(false)
</script>

<template>
  <div class="preview">
    <p v-if="content.status === 'loading'" class="note">Loading content…</p>
    <p v-else-if="content.status === 'unauthorized'" class="note">Sign in with your wallet to read this submission.</p>
    <p v-else-if="content.status === 'forbidden'" class="note">Only the project creator, its reviewers and the contributor can read this submission.</p>
    <p v-else-if="content.status === 'unavailable'" class="note">The content was not found in storage.</p>

    <template v-else>
      <p v-if="content.status === 'mismatch'" class="warn" :data-testid="`warn-content-hash-${submissionId}`">
        ⚠ This text does not match the hash stored on-chain. The storage may have been tampered with. Do not trust it.
        <button v-if="!showAnyway" class="secondary" :data-testid="`show-anyway-${submissionId}`" @click="showAnyway = true">Show anyway</button>
      </p>
      <p v-else class="note">Content matches the hash stored on-chain.</p>
      <!-- Text only, never HTML: the content is untrusted. -->
      <pre v-if="content.status === 'match' || showAnyway" class="content" :data-testid="`content-${submissionId}`">{{ content.text }}</pre>
    </template>
  </div>
</template>

<style scoped>
.content { white-space: pre-wrap; word-break: break-word; max-height: 18rem; overflow: auto; margin: 0.4rem 0; padding: 0.6rem 0.75rem; background: #fff; border: 1px solid var(--line); border-radius: 10px; font-family: var(--font-mono); font-size: 0.8rem; }
.warn { margin: 0.5rem 0; padding: 0.45rem 0.6rem; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--warn-bg); font-weight: 500; }
</style>
