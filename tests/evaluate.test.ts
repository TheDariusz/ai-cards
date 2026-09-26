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
  it('reports a dropped letter as a typo, not a match', () => {
    expect(headwordInAnswer('She deliberatly ignored him.', 'deliberately')).toBe('typo')
  })
  it('does not accept a shorter word that merely prefixes the headword', () => {
    expect(headwordInAnswer('I waited for him.', 'forget')).toBe('missing')
    expect(headwordInAnswer("I don't care.", 'careful')).toBe('missing')
    expect(headwordInAnswer('She is in the room.', 'into')).toBe('missing')
    expect(headwordInAnswer('He went off.', 'offer')).toBe('missing')
    expect(headwordInAnswer('I agree with you.', 'within')).toBe('missing')
  })
  it('treats a word one edit away as a typo — indistinguishable from a real one', () => {
    expect(headwordInAnswer('Please sit.', 'pleased')).toBe('typo')
  })
  it('accepts regular English inflections', () => {
    expect(headwordInAnswer('She kept ignoring me.', 'ignore')).toBe('match')
    expect(headwordInAnswer('He tried again.', 'try')).toBe('match')
    expect(headwordInAnswer('It stopped.', 'stop')).toBe('match')
    expect(headwordInAnswer('She carried it.', 'carry')).toBe('match')
    expect(headwordInAnswer('He relies on her.', 'rely')).toBe('match')
    expect(headwordInAnswer('It happens.', 'happen')).toBe('match')
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
