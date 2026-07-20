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

  it('short unrelated words are not typos of each other', () => {
    // "use" is 2 edits from "the", but on 3-letter words that is no similarity
    // at all — it used to steal the alignment and orphan the correct "the".
    const r = diffAnswer(
      "If I were you, I'd take advantage of the discount before it ends.",
      'If I were you, I would use the discount before it ends.',
    )
    expect(r.tokens.filter((t) => t.kind === 'typo')).toEqual([])
    expect(r.tokens.filter((t) => t.kind === 'extra').map((t) => t.text)).toEqual(['i', 'would', 'use'])
    expect(r.tokens.filter((t) => t.kind === 'match').map((t) => t.text)).toContain('the')
  })

  it('a correctly written word stays a match when a lookalike precedes it', () => {
    // "when" is 2 edits from "she"; the real "she" must keep the alignment
    const r = diffAnswer(
      'Her comprehension improved once she started reading daily.',
      'Her comprehension improved when she started reading every day.',
    )
    expect(r.tokens.filter((t) => t.kind === 'typo')).toEqual([])
    expect(r.tokens.filter((t) => t.kind === 'match').map((t) => t.text)).toEqual([
      'her', 'comprehension', 'improved', 'she', 'started', 'reading',
    ])
  })

  it('prefers an exact match over an adjacent near-match', () => {
    // "starter" is a genuine typo of "started", but "started" itself is right
    // there — the exact pairing must win the alignment.
    const r = diffAnswer('She started reading.', 'she starter started reading')
    expect(r.tokens.map((t) => `${t.kind}:${t.text}`)).toEqual([
      'match:she', 'extra:starter', 'match:started', 'match:reading',
    ])
  })
})
