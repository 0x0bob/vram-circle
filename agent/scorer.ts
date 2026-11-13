import { buildScoringRequest, PROMPT_VERSION } from './rubric'
import { validateAiOutput, type AiOutput } from './schema'

/** Everything the scorer ever sends to the model: one fixed system prompt and one user message. No tools, no sampling knobs. */
export interface ScoreRequest {
  model: string
  system: string
  user: string
  maxTokens: number
}

export interface ScoringClient {
  parse(req: ScoreRequest): Promise<{ parsed: unknown; stopReason: string | null; usage: { input: number; output: number } }>
}

export const MAX_OUTPUT_TOKENS = 4_000

export type ScoreResult =
  | {
      status: 'ok'
      output: AiOutput
      usage: { input: number; output: number }
      model: string
      promptVersion: string
      truncated: boolean
    }
  | {
      status: 'error'
      reason: 'refusal' | 'unparseable' | 'invalid_output' | 'provider_error'
      detail?: string
      model: string
      promptVersion: string
    }

/**
 * Scores one submission. The ONLY source of the score is the structured output of the model, validated strictly. Text inside
 * the submission is never parsed, interpreted or executed here, so an answer that contains a fake result, fake tags or
 * instructions cannot set its own score.
 */
export async function scoreSubmission(
  client: ScoringClient,
  input: { instructions: string; submission: string; model: string },
): Promise<ScoreResult> {
  const { system, user, truncated } = buildScoringRequest(input)
  const base = { model: input.model, promptVersion: PROMPT_VERSION }
  let res: Awaited<ReturnType<ScoringClient['parse']>>
  try {
    res = await client.parse({ model: input.model, system, user, maxTokens: MAX_OUTPUT_TOKENS })
  } catch {
    // Deliberately no detail: provider errors can echo request fragments or credentials.
    return { status: 'error', reason: 'provider_error', ...base }
  }
  if (res.stopReason === 'refusal') return { status: 'error', reason: 'refusal', ...base }
  if (res.parsed === null || res.parsed === undefined) return { status: 'error', reason: 'unparseable', ...base }
  const v = validateAiOutput(res.parsed)
  if (!v.ok) return { status: 'error', reason: 'invalid_output', detail: v.error, ...base }
  return { status: 'ok', output: v.value, usage: res.usage, truncated, ...base }
}
