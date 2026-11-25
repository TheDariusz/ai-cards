import { describe, it, expect } from 'vitest'
import { reviewMinutes, todayState, formatDayLine, formatMonth, doneLine, finishSummary } from '../app/lib/today'

const base = { total: 5, ready: 5, due: 0, newCount: 0, todayDone: false }

describe('todayState', () => {
  it('first run when there are no cards', () => expect(todayState({ ...base, total: 0, ready: 0 })).toBe('first-run'))
  it('preparing when cards exist but none is ready', () => expect(todayState({ ...base, total: 1, ready: 0 })).toBe('preparing'))
  it('review wins whenever something is due', () => expect(todayState({ ...base, due: 3, newCount: 2, todayDone: true })).toBe('review'))
  it('learn when nothing is due, the day is open and new cards wait', () => expect(todayState({ ...base, newCount: 2 })).toBe('learn'))
  it('done when nothing is due and the day is complete, even with new cards', () => expect(todayState({ ...base, newCount: 2, todayDone: true })).toBe('done'))
  it('nothing due otherwise', () => expect(todayState(base)).toBe('nothing-due'))
})

describe('reviewMinutes', () => {
  it('is 30 seconds per card, rounded, at least 1', () => {
    expect([1, 2, 3, 12, 25].map(reviewMinutes)).toEqual([1, 1, 2, 6, 13])
  })
})

describe('formatDayLine', () => {
  it('formats in Polish', () => expect(formatDayLine('2026-11-24', 'pl')).toBe('wtorek, 24 listopada'))
  it('formats in English', () => expect(formatDayLine('2026-11-24', 'en')).toMatch(/Tuesday.*24.*November/))
})

describe('doneLine', () => {
  it('reports reviews when there were any today', () => expect(doneLine(12, 2)).toEqual({ kind: 'reviewed', n: 12 }))
  it('reports learned words when there were no reviews', () => expect(doneLine(0, 1)).toEqual({ kind: 'learned', n: 1 }))
  it('has nothing to report when neither happened', () => expect(doneLine(0, 0)).toBeNull())
})

describe('finishSummary', () => {
  const today = '2026-11-25'
  it('shows the streak, today included, once today is a completed day', () =>
    expect(finishSummary(3, ['2026-11-23', '2026-11-24', today], today)).toEqual({ done: 3, streak: 3 }))
  it('has no streak line while today is not complete, even with a running streak', () =>
    expect(finishSummary(2, ['2026-11-23', '2026-11-24'], today)).toEqual({ done: 2, streak: null }))
  it('starts the streak at 1 when today completes after a gap', () =>
    expect(finishSummary(1, ['2026-11-20', today], today)).toEqual({ done: 1, streak: 1 }))
  it('reports nothing done when nothing happened today', () =>
    expect(finishSummary(0, [], today)).toEqual({ done: null, streak: null }))
})

describe('formatMonth', () => {
  it('formats in Polish', () => expect(formatMonth('2026-11-24', 'pl')).toBe('listopad'))
  it('formats in English', () => expect(formatMonth('2026-11-24', 'en')).toBe('November'))
})
