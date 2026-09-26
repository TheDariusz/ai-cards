import { describe, it, expect } from 'vitest'
import { validateAnswerEvaluation } from '../app/lib/ai'

const VALID = { verdict: 'minor', summaryPl: ' Prawie dobrze. ', corrected: ' She ignored him on purpose. ', notesPl: [' Użyj "deliberately". '] }

describe('validateAnswerEvaluation', () => {
  it('passes a valid evaluation through, trimmed', () => {
    expect(validateAnswerEvaluation(VALID, 'x')).toEqual({
      verdict: 'minor', summaryPl: 'Prawie dobrze.', corrected: 'She ignored him on purpose.', notesPl: ['Użyj "deliberately".'],
    })
  })
  it('rejects an unknown verdict', () => {
    expect(() => validateAnswerEvaluation({ ...VALID, verdict: 'great' }, 'x')).toThrow(/verdict/)
  })
  it('rejects a blank summary', () => {
    expect(() => validateAnswerEvaluation({ ...VALID, summaryPl: ' ' }, 'x')).toThrow(/summaryPl/)
  })
  it('rejects a non-object', () => {
    expect(() => validateAnswerEvaluation('nope', 'x')).toThrow()
  })
  it('keeps at most three notes and drops blank or non-string ones', () => {
    const notes = ['a', ' ', 7, 'b', 'c', 'd']
    expect(validateAnswerEvaluation({ ...VALID, notesPl: notes }, 'x').notesPl).toEqual(['a', 'b', 'c'])
  })
  it('defaults missing notes to an empty list', () => {
    const noNotes = { verdict: VALID.verdict, summaryPl: VALID.summaryPl, corrected: VALID.corrected }
    expect(validateAnswerEvaluation(noNotes, 'x').notesPl).toEqual([])
  })
  it('falls back to the typed sentence when corrected is blank', () => {
    expect(validateAnswerEvaluation({ ...VALID, corrected: '' }, 'my sentence').corrected).toBe('my sentence')
  })
})
