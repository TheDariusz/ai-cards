import { describe, it, expect } from 'vitest'
import { reviewMinutes, todayState, formatDayLine } from '../app/lib/today'

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
