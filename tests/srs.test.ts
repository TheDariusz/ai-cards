import { describe, it, expect } from 'vitest'
import { newCardSrs, schedule, DAY_MS } from '../app/lib/srs'

const NOW = 1_750_000_000_000

describe('newCardSrs', () => {
  it('is due tomorrow with ease 2.5', () => {
    expect(newCardSrs(NOW)).toEqual({ dueAt: NOW + DAY_MS, intervalDays: 1, ease: 2.5 })
  })
})

describe('schedule', () => {
  const fresh = newCardSrs(NOW)

  it('again: resets interval to 1 day and drops ease', () => {
    const s = schedule({ dueAt: NOW, intervalDays: 7, ease: 2.5 }, 'again', NOW)
    expect(s.intervalDays).toBe(1)
    expect(s.ease).toBe(2.3)
    expect(s.dueAt).toBe(NOW + DAY_MS)
  })

  it('ease never drops below 1.3', () => {
    const s = schedule({ dueAt: NOW, intervalDays: 1, ease: 1.35 }, 'again', NOW)
    expect(s.ease).toBe(1.3)
  })

  it('good: first review jumps to 3 days', () => {
    const s = schedule(fresh, 'good', NOW)
    expect(s.intervalDays).toBe(3)
    expect(s.dueAt).toBe(NOW + 3 * DAY_MS)
    expect(s.ease).toBe(2.5)
  })

  it('good: later reviews multiply by ease (3 → 7.5 → 18.75)', () => {
    const s1 = schedule({ dueAt: NOW, intervalDays: 3, ease: 2.5 }, 'good', NOW)
    expect(s1.intervalDays).toBe(7.5)
    const s2 = schedule(s1, 'good', NOW)
    expect(s2.intervalDays).toBe(18.75)
  })

  it('easy: 1.3x the good interval and raises ease', () => {
    const s = schedule(fresh, 'easy', NOW)
    expect(s.intervalDays).toBeCloseTo(3.9)
    expect(s.ease).toBe(2.65)
  })

  it('ease caps at 3.0', () => {
    const s = schedule({ dueAt: NOW, intervalDays: 3, ease: 2.95 }, 'easy', NOW)
    expect(s.ease).toBe(3.0)
  })
})
