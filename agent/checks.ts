// Non-AI checks. Every result is ADVICE for a human reviewer: a flag is never an automatic rejection.

/** Content longer than this is flagged, and the AI scorer only reads the first MAX_CONTENT_CHARS characters. */
export const MAX_CONTENT_CHARS = 20_000
export const MIN_CONTENT_CHARS = 20

export type FormatFlag = 'empty' | 'too_short' | 'too_long' | 'control_characters' | 'repetitive'

export interface FormatResult {
  ok: boolean
  flags: FormatFlag[]
  chars: number
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export function formatChecks(text: string): FormatResult {
  const flags: FormatFlag[] = []
  const trimmed = text.trim()
  if (trimmed.length === 0) flags.push('empty')
  else if (trimmed.length < MIN_CONTENT_CHARS) flags.push('too_short')
  if (text.length > MAX_CONTENT_CHARS) flags.push('too_long')
  if (CONTROL.test(text)) flags.push('control_characters')
  if (trimmed.length > 0 && isRepetitive(trimmed)) flags.push('repetitive')
  return { ok: flags.length === 0, flags, chars: text.length }
}

function isRepetitive(t: string): boolean {
  const compact = t.replace(/\s+/g, '')
  if (compact.length >= 50) {
    const counts = new Map<string, number>()
    for (const ch of compact) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    if (Math.max(...counts.values()) / compact.length > 0.9) return true
  }
  const words = t.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length >= 10 && new Set(words).size / words.length < 0.2) return true
  return false
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|the\s+)?(above|previous|prior|earlier)/i,
  /\b(give|assign|award|set|output|return|rate)\b[^.\n]{0,40}\b(score|rating|grade)\b[^.\n]{0,20}\d{2,3}/i,
  /\brate\s+this\s+(answer|submission|response)\b[^.\n]{0,20}\d/i,
  /"score"\s*:\s*\d/i,
  /\bset\s+score\s*=\s*\d+/i,
  /\bsystem\s+prompt\b/i,
  /you\s+are\s+(now\s+)?(an?|the)\b[^.\n]{0,30}\b(grader|judge|evaluator|scorer|reviewer)\b/i,
  /<\/?(submission|task_instructions|instructions|system)\b/i,
  /\bnew\s+instructions?\s*:/i,
]

/**
 * Heuristic: does the content address the scorer instead of answering the task? Advice only. The AI scorer is isolated
 * from this text structurally (see rubric.ts), so a miss here does not open an attack path, and a hit does not change a
 * score; it adds a visible warning for the reviewer.
 */
export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text))
}
