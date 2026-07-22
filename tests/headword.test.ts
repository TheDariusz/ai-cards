import { describe, it, expect } from 'vitest'
import { findHeadwordIndices, highlightHeadword, tokenMatchesHeadword } from '../app/lib/headword'

describe('tokenMatchesHeadword', () => {
  it('matches identical words', () => {
    expect(tokenMatchesHeadword('deliberately', 'deliberately')).toBe(true)
  })

  it('matches an English inflection via the prefix rule', () => {
    expect(tokenMatchesHeadword('ignored', 'ignore')).toBe(true)
  })

  it('matches a longer suffix inflection the edit distance would miss', () => {
    // "helpful" is 3 edits from "help" — too many for similar(), fine for prefix
    expect(tokenMatchesHeadword('helpful', 'help')).toBe(true)
  })

  it('matches a Polish inflection via edit distance', () => {
    // "ignorowała" vs "ignorować": 2 edits on a 10-letter word
    expect(tokenMatchesHeadword('ignorowała', 'ignorować')).toBe(true)
  })

  it('keeps short headwords exact-only', () => {
    // "up" must never claim "upset"
    expect(tokenMatchesHeadword('upset', 'up')).toBe(false)
    expect(tokenMatchesHeadword('up', 'up')).toBe(true)
  })

  it('rejects unrelated words', () => {
    expect(tokenMatchesHeadword('argument', 'deliberately')).toBe(false)
  })
})

describe('findHeadwordIndices', () => {
  it('finds a single word', () => {
    expect(findHeadwordIndices(['she', 'deliberately', 'ignored'], ['deliberately'])).toEqual([[1]])
  })

  it('finds a phrasal verb as consecutive tokens', () => {
    expect(findHeadwordIndices(['never', 'give', 'up', 'hope'], ['give', 'up'])).toEqual([[1, 2]])
  })

  it('finds every occurrence', () => {
    expect(findHeadwordIndices(['run', 'fast', 'run'], ['run'])).toEqual([[0], [2]])
  })

  it('returns [] when absent', () => {
    expect(findHeadwordIndices(['she', 'ignored', 'him'], ['deliberately'])).toEqual([])
  })

  it('returns [] for an empty headword', () => {
    expect(findHeadwordIndices(['she'], [])).toEqual([])
  })
})

describe('highlightHeadword', () => {
  const rejoin = (s: string, h: string | null) => highlightHeadword(s, h).map((x) => x.text).join('')
  const heads = (s: string, h: string) => highlightHeadword(s, h).filter((x) => x.head).map((x) => x.text)

  it('always reassembles to the exact input', () => {
    const s = 'She deliberately ignored his calls, after the argument!'
    expect(rejoin(s, 'deliberately')).toBe(s)
    expect(rejoin(s, null)).toBe(s)
    expect(rejoin(s, 'absent')).toBe(s)
  })

  it('flags the headword', () => {
    expect(heads('She deliberately ignored him.', 'deliberately')).toEqual(['deliberately'])
  })

  it('keeps punctuation attached to a highlighted word', () => {
    expect(heads('He was ignored, then left.', 'ignore')).toEqual(['ignored,'])
  })

  it('ignores casing', () => {
    expect(heads('Deliberately, she left.', 'deliberately')).toEqual(['Deliberately,'])
  })

  it('flags a phrasal verb as one continuous span', () => {
    expect(heads('Never give up hope.', 'give up')).toEqual(['give up'])
  })

  it('returns one plain segment when the headword is absent', () => {
    expect(highlightHeadword('She left.', 'deliberately')).toEqual([{ text: 'She left.', head: false }])
  })

  it('handles empty input', () => {
    expect(highlightHeadword('', 'x')).toEqual([])
  })
})
