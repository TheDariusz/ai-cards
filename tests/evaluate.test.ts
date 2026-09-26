import { describe, it, expect } from 'vitest'
import { headwordInAnswer, suggestGrade } from '../app/lib/evaluate'

describe('headwordInAnswer', () => {
  it('finds the headword regardless of word order', () => {
    expect(headwordInAnswer('After the argument she ignored his calls deliberately.', 'deliberately')).toBe('match')
  })
  it('accepts an inflection', () => {
    expect(headwordInAnswer('He ignored me.', 'ignore')).toBe('match')
  })
  it('reports a typo', () => {
    expect(headwordInAnswer('She delibrately ignored him.', 'deliberately')).toBe('typo')
  })
  it('treats a late typo on a long shared stem as a match (inflection leniency)', () => {
    // tokenMatchesHeadword accepts a ≥6-letter shared stem — it cannot tell
    // "deliberatly" from an inflection; the AI notes still flag the spelling
    expect(headwordInAnswer('She deliberatly ignored him.', 'deliberately')).toBe('match')
  })
  it('reports a missing headword', () => {
    expect(headwordInAnswer('She ignored him on purpose.', 'deliberately')).toBe('missing')
  })
  it('finds a phrase headword', () => {
    expect(headwordInAnswer('I will never give up.', 'give up')).toBe('match')
  })
  it('reports a typo inside a phrase headword', () => {
    expect(headwordInAnswer('It was a delibrate choise.', 'deliberate choice')).toBe('typo')
  })
  it('keeps short headwords from claiming longer words', () => {
    expect(headwordInAnswer('I was upset.', 'up')).toBe('missing')
  })
  it('accepts any gloss alternative', () => {
    expect(headwordInAnswer('It was a decisive moment.', 'crucial / decisive')).toBe('match')
  })
})

describe('suggestGrade', () => {
  it.each([
    ['correct', 'missing', 'again'], ['minor', 'missing', 'again'], ['wrong', 'missing', 'again'],
    ['correct', 'typo', 'good'], ['minor', 'typo', 'good'], ['wrong', 'typo', 'again'],
    ['correct', 'match', 'easy'], ['minor', 'match', 'good'], ['wrong', 'match', 'again'],
  ] as const)('%s + %s → %s', (verdict, headword, grade) => {
    expect(suggestGrade(verdict, headword)).toBe(grade)
  })
})
