import { z } from 'zod'

export const MAX_REASONS = 5
export const MAX_REASON_CHARS = 300

/**
 * The ONLY shape accepted from the model. Strict: an unknown field fails validation, so nothing the model (or an attacker
 * talking through it) adds is ever passed on. The API's structured-output mode enforces this too; this is the second lock.
 */
export const AiOutputSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string().max(MAX_REASON_CHARS)).min(1).max(MAX_REASONS),
  injection_suspected: z.boolean(),
})

export type AiOutput = z.infer<typeof AiOutputSchema>

export type Validated = { ok: true; value: AiOutput } | { ok: false; error: string }

export function validateAiOutput(raw: unknown): Validated {
  const r = AiOutputSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
}
