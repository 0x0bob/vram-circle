import { reactive, type Ref } from 'vue'
import type { Address } from 'viem'
import type { Details } from '../components/ReviewQueue.vue'
import { fetchAdvice, fetchSubmission, runScreen, type AccessHeaders } from '../services/agentApi'
import type { SubmissionView } from '../services/chain'

/**
 * State of the "content and agent advice" panels in the reviewer queue. Every step is an explicit reviewer click: the wallet
 * is asked to sign in (read-only, once per project) when a panel is opened, and the model is called only when the reviewer
 * presses Run screening. Nothing here can approve, reject or pay.
 */
export function useReviewDetails(o: {
  vault: Ref<Address | null>
  submissions: () => SubmissionView[]
  access: { headers(vault: Address): Promise<AccessHeaders> }
}) {
  const details = reactive<Record<number, Details | undefined>>({})

  async function open(id: number) {
    const vault = o.vault.value
    const sub = o.submissions().find((s) => s.id === id)
    if (!vault || !sub) return
    details[id] = { content: { status: 'loading', text: null }, advice: null, loading: false }
    let headers: AccessHeaders
    try {
      headers = await o.access.headers(vault)
    } catch {
      // The reviewer closed or rejected the wallet prompt: show how to retry.
      details[id] = { content: { status: 'unauthorized', text: null }, advice: null, loading: false }
      return
    }
    const [content, stored] = await Promise.all([
      fetchSubmission({ vault, submissionId: id, hash: sub.contentHash }, headers),
      fetchAdvice({ vault, submissionId: id }, headers).catch(() => []),
    ])
    details[id] = { content, advice: stored[0] ?? null, loading: false }
  }

  async function screen(id: number) {
    const vault = o.vault.value
    const d = details[id]
    if (!vault || !d || d.loading) return // a second click while one is running must not spend twice
    d.loading = true
    d.error = undefined
    try {
      d.advice = await runScreen({ vault, submissionId: id }, await o.access.headers(vault))
    } catch (e) {
      d.error = (e as Error).message
    } finally {
      d.loading = false
    }
  }

  return { details, open, screen }
}
