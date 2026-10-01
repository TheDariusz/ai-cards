import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDb } from './helpers/db'
import { insertPendingCard } from '../app/db/repo'
import { cards, users, OWNER_USER_ID } from '../app/db/schema'
import { canAddCard, dailyCardLimit, DEFAULT_DAILY_CARD_LIMIT } from '../app/lib/quota'

// 2026-10-01 10:00 in Warsaw (CEST, UTC+2)
const NOW = Date.parse('2026-10-01T08:00:00Z')
const MIDNIGHT = Date.parse('2026-09-30T22:00:00Z')

describe('dailyCardLimit', () => {
  it('reads a non-negative integer, otherwise the default', () => {
    expect(dailyCardLimit({ DAILY_CARD_LIMIT: '5' })).toBe(5)
    expect(dailyCardLimit({ DAILY_CARD_LIMIT: '0' })).toBe(0)
    expect(dailyCardLimit({ DAILY_CARD_LIMIT: 'lots' })).toBe(DEFAULT_DAILY_CARD_LIMIT)
    expect(dailyCardLimit({})).toBe(DEFAULT_DAILY_CARD_LIMIT)
  })
})

describe('canAddCard', () => {
  it('counts only the user’s cards created since Warsaw midnight', async () => {
    const db = testDb()
    const [friend] = await db.insert(users).values({ email: 'f@example.com', createdAt: 0 }).returning()
    const yesterday = await insertPendingCard(db, friend.id, 'old', MIDNIGHT - 1)
    await db.update(cards).set({ userId: friend.id }).where(eq(cards.id, yesterday))
    await insertPendingCard(db, OWNER_USER_ID, 'owner card', NOW)
    await insertPendingCard(db, friend.id, 'one', MIDNIGHT)
    expect(await canAddCard(db, friend.id, NOW, 2)).toBe(true)
    await insertPendingCard(db, friend.id, 'two', NOW)
    expect(await canAddCard(db, friend.id, NOW, 2)).toBe(false)
  })

  it('never limits the owner', async () => {
    const db = testDb()
    expect(await canAddCard(db, OWNER_USER_ID, NOW, 0)).toBe(true)
  })
})
