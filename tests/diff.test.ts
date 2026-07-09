import { describe, it, expect } from 'vitest'
import { diffAnswer } from '../app/lib/diff'

describe('diffAnswer', () => {
  it('perfect answer (ignoring case and punctuation) is easy', () => {
    const r = diffAnswer('She was reluctant to speak.', 'she was reluctant to speak')
    expect(r.score).toBe(1)
    expect(r.suggestedGrade).toBe('easy')
    expect(r.tokens.every((t) => t.kind === 'match')).toBe(true)
  })

  it('small typo counts as typo, not miss', () => {
    const r = diffAnswer('She was reluctant to speak.', 'she was relucant to speak')
    const typo = r.tokens.find((t) => t.kind === 'typo')
    expect(typo?.text).toBe('reluctant')
    expect(r.score).toBe(0.9) // (4 + 0.5) / 5
    expect(r.suggestedGrade).toBe('good')
  })

  it('missing word appears as missing', () => {
    const r = diffAnswer('She was reluctant to speak.', 'she was reluctant speak')
    expect(r.tokens.filter((t) => t.kind === 'missing').map((t) => t.text)).toEqual(['to'])
    expect(r.suggestedGrade).toBe('good') // 4/5 = 0.8
  })

  it('extra word appears as extra', () => {
    const r = diffAnswer('She was reluctant.', 'she was very reluctant')
    expect(r.tokens.filter((t) => t.kind === 'extra').map((t) => t.text)).toEqual(['very'])
  })

  it('mostly wrong answer suggests again', () => {
    const r = diffAnswer('She was reluctant to speak.', 'the dog runs')
    expect(r.suggestedGrade).toBe('again')
  })

  it('empty answer is again with score 0', () => {
    const r = diffAnswer('She was reluctant.', '')
    expect(r.score).toBe(0)
    expect(r.suggestedGrade).toBe('again')
  })
})
