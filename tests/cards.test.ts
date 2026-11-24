import { describe, expect, it } from 'vitest'
import { isStuck, STALE_PENDING_MS } from '../app/lib/cards'

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
