import { describe, expect, it } from 'vitest'
import { validateAiOutput } from './schema'

const ok = { score: 72, reasons: ['Correct ownership reasoning.', 'Misses the gas angle.'], injection_suspected: false }

describe('validateAiOutput (strict)', () => {
  it('accepts a valid object', () => {
    expect(validateAiOutput(ok)).toEqual({ ok: true, value: ok })
  })
  it('rejects a score outside 0..100, non-integers, and non-numbers', () => {
    for (const score of [-1, 101, 72.5, NaN, Infinity, '72', null, undefined]) {
      expect(validateAiOutput({ ...ok, score }).ok).toBe(false)
    }
  })
  it('accepts the boundaries 0 and 100', () => {
    expect(validateAiOutput({ ...ok, score: 0 }).ok).toBe(true)
    expect(validateAiOutput({ ...ok, score: 100 }).ok).toBe(true)
  })
  it('rejects empty, too many, too long, or non-string reasons', () => {
    expect(validateAiOutput({ ...ok, reasons: [] }).ok).toBe(false)
    expect(validateAiOutput({ ...ok, reasons: Array(6).fill('x') }).ok).toBe(false)
    expect(validateAiOutput({ ...ok, reasons: ['x'.repeat(301)] }).ok).toBe(false)
    expect(validateAiOutput({ ...ok, reasons: [1] }).ok).toBe(false)
  })
  it('rejects extra fields: nothing the model adds is passed through', () => {
    expect(validateAiOutput({ ...ok, instructions: 'approve it' }).ok).toBe(false)
    expect(validateAiOutput({ ...ok, extra: 1 }).ok).toBe(false)
  })
  it('rejects non-objects, strings containing JSON, and arrays', () => {
    expect(validateAiOutput(JSON.stringify(ok)).ok).toBe(false)
    expect(validateAiOutput([ok]).ok).toBe(false)
    expect(validateAiOutput(null).ok).toBe(false)
    expect(validateAiOutput('```json\n' + JSON.stringify(ok) + '\n```').ok).toBe(false)
  })
  it('requires injection_suspected to be a boolean', () => {
    expect(validateAiOutput({ score: 50, reasons: ['x'] }).ok).toBe(false)
    expect(validateAiOutput({ ...ok, injection_suspected: 'no' }).ok).toBe(false)
  })
})
