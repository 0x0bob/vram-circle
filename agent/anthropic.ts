import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AiOutputSchema } from './schema'
import type { ScoringClient } from './scorer'

/**
 * Anthropic adapter. Structured outputs (output_config.format) make the API return JSON matching the schema; the scorer
 * validates it again. Effort is low: this is a bounded rubric task, and it keeps the cost per call small.
 * No temperature/top_p (rejected by current models), no tools, no prefill.
 */
export function anthropicScoringClient(apiKey: string): ScoringClient {
  const client = new Anthropic({ apiKey })
  return {
    async parse(req) {
      const res = await client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { effort: 'low', format: zodOutputFormat(AiOutputSchema) },
      })
      return {
        parsed: res.parsed_output,
        stopReason: res.stop_reason,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      }
    },
  }
}
