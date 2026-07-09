import { describe, it, expect } from 'vitest'
import { dayKey, computeStreak } from '../app/lib/streak'

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
