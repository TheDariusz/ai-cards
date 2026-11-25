import { describe, expect, it } from 'vitest'
import { cardStatus, countLearnedOn, isStuck, STALE_PENDING_MS } from '../app/lib/cards'

describe('isStuck', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  it('is false for a freshly created pending card', () => {
    expect(isStuck({ status: 'pending', createdAt: now - 1000 }, now)).toBe(false)
  })
  it('is true for a pending card older than the threshold', () => {
    expect(isStuck({ status: 'pending', createdAt: now - STALE_PENDING_MS - 1 }, now)).toBe(true)
  })
  it('is false for an old card that is not pending', () => {
    expect(isStuck({ status: 'ready', createdAt: now - STALE_PENDING_MS * 10 }, now)).toBe(false)
  })
})

describe('cardStatus', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  const base = { createdAt: now - 1000, firstLearnedAt: null, decodeParts: [{ en: 'x', pl: 'x' }] }
  it('shows a fresh pending card as pending', () => {
    expect(cardStatus({ ...base, status: 'pending' }, now)).toBe('pending')
  })
  it('shows a stuck pending card as failed', () => {
    expect(cardStatus({ ...base, status: 'pending', createdAt: now - STALE_PENDING_MS - 1 }, now)).toBe('failed')
  })
  it('shows a failed card as failed', () => {
    expect(cardStatus({ ...base, status: 'failed' }, now)).toBe('failed')
  })
  it('shows a ready card not yet learned as new', () => {
    expect(cardStatus({ ...base, status: 'ready' }, now)).toBe('new')
  })
  it('shows a learned card as ready', () => {
    expect(cardStatus({ ...base, status: 'ready', firstLearnedAt: now }, now)).toBe('ready')
  })
})

describe('countLearnedOn', () => {
  it('counts cards first learned on the given Warsaw day', () => {
    // 2026-11-24 23:30 UTC is already 2026-11-25 in Warsaw
    const cards = [
      { firstLearnedAt: Date.UTC(2026, 10, 24, 12) },
      { firstLearnedAt: Date.UTC(2026, 10, 24, 23, 30) },
      { firstLearnedAt: Date.UTC(2026, 10, 23, 12) },
      { firstLearnedAt: null },
    ]
    expect(countLearnedOn(cards, '2026-11-24')).toBe(1)
    expect(countLearnedOn(cards, '2026-11-25')).toBe(1)
  })
})
