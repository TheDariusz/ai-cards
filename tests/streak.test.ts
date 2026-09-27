import { describe, it, expect } from 'vitest'
import { dayKey, computeStreak, endOfDay } from '../app/lib/streak'

describe('dayKey', () => {
  it('formats in Europe/Warsaw', () => {
    // 2026-07-07 23:30 UTC == 2026-07-08 01:30 in Warsaw (CEST)
    expect(dayKey(Date.UTC(2026, 6, 7, 23, 30))).toBe('2026-07-08')
    expect(dayKey(Date.UTC(2026, 6, 7, 12, 0))).toBe('2026-07-07')
  })
})

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-07-05', '2026-07-06', '2026-07-07'], '2026-07-07')).toBe(3)
  })
  it('still alive if yesterday done but today not yet', () => {
    expect(computeStreak(['2026-07-05', '2026-07-06'], '2026-07-07')).toBe(2)
  })
  it('broken streak counts only the recent run', () => {
    expect(computeStreak(['2026-07-01', '2026-07-06', '2026-07-07'], '2026-07-07')).toBe(2)
  })
  it('dead streak is 0', () => {
    expect(computeStreak(['2026-07-01'], '2026-07-07')).toBe(0)
  })
  it('empty is 0', () => {
    expect(computeStreak([], '2026-07-07')).toBe(0)
  })
})

describe('endOfDay', () => {
  it('returns the last ms of the Warsaw day in CEST', () => {
    // Warsaw midnight 2026-09-28 == 2026-09-27 22:00 UTC
    expect(endOfDay(Date.UTC(2026, 8, 27, 17, 0))).toBe(Date.UTC(2026, 8, 27, 22, 0) - 1)
  })
  it('returns the last ms of the Warsaw day in CET', () => {
    expect(endOfDay(Date.UTC(2026, 0, 15, 18, 0))).toBe(Date.UTC(2026, 0, 15, 23, 0) - 1)
  })
  it('handles the DST switch day and the moment right after midnight', () => {
    // 2026-10-25 has 25 hours in Warsaw; it ends at 23:00 UTC
    expect(endOfDay(Date.UTC(2026, 9, 24, 22, 0))).toBe(Date.UTC(2026, 9, 25, 23, 0) - 1)
  })
})
