import { describe, it, expect, vi, afterEach } from 'vitest'
import { testDb } from './helpers/db'
import { OWNER_USER_ID } from '../app/db/schema'
import { findOrCreateUser, getBalance, grantCredits, listUsersWithUsage, recordUsage, setBlocked, isUserBlocked, listUsers } from '../app/db/repo'
import { hasCredits, starterMicros, toCredits, usageRecorder, DEFAULT_STARTER_CREDITS } from '../app/lib/credits'
import type { UsageEvent } from '../app/lib/ai'

const NOW = Date.parse('2026-10-03T10:00:00Z')
const STARTER = 500_000
const event = (costMicros: number): UsageEvent => ({
  kind: 'card', model: 'm', costMicros, promptTokens: 1, completionTokens: 1, characters: null, generationId: null,
})

afterEach(() => vi.restoreAllMocks())

describe('starterMicros / toCredits', () => {
  it('reads STARTER_CREDITS in credits, otherwise the default', () => {
    expect(starterMicros({ STARTER_CREDITS: '100' })).toBe(100_000)
    expect(starterMicros({ STARTER_CREDITS: 'many' })).toBe(DEFAULT_STARTER_CREDITS * 1000)
    expect(starterMicros({})).toBe(DEFAULT_STARTER_CREDITS * 1000)
  })

  it('floors to whole credits and never shows a negative balance', () => {
    expect(toCredits(312_999)).toBe(312)
    expect(toCredits(-3_000)).toBe(0)
  })
})

describe('credit balance', () => {
  it('a new account starts with the starter pool, spends it, and a top-up restores access', async () => {
    const db = testDb()
    const id = await findOrCreateUser(db, 'new@example.com', 'owner@example.com', NOW, STARTER)
    expect(await getBalance(db, id)).toEqual({ grantedMicros: STARTER, spentMicros: 0, balanceMicros: STARTER })
    expect(await hasCredits(db, id)).toBe(true)

    await recordUsage(db, id, event(499_000), NOW)
    expect(await hasCredits(db, id)).toBe(true)
    await recordUsage(db, id, event(4_000), NOW) // the last call may overshoot
    expect((await getBalance(db, id)).balanceMicros).toBe(-3_000)
    expect(await hasCredits(db, id)).toBe(false)

    await grantCredits(db, id, STARTER, 'admin', NOW)
    expect(await hasCredits(db, id)).toBe(true)
  })

  it('logging in again does not grant a second pool', async () => {
    const db = testDb()
    const id = await findOrCreateUser(db, 'new@example.com', null, NOW, STARTER)
    expect(await findOrCreateUser(db, 'new@example.com', null, NOW + 1, STARTER)).toBe(id)
    expect((await getBalance(db, id)).grantedMicros).toBe(STARTER)
  })

  it('the owner gets no pool, is never limited, but usage is still logged', async () => {
    const db = testDb()
    expect(await findOrCreateUser(db, 'owner@example.com', 'owner@example.com', NOW, STARTER)).toBe(OWNER_USER_ID)
    await recordUsage(db, OWNER_USER_ID, event(9_000_000), NOW)
    expect(await getBalance(db, OWNER_USER_ID)).toEqual({ grantedMicros: 0, spentMicros: 9_000_000, balanceMicros: -9_000_000 })
    expect(await hasCredits(db, OWNER_USER_ID)).toBe(true)
  })

  it('usageRecorder charges the given user and swallows write failures', async () => {
    const db = testDb()
    const id = await findOrCreateUser(db, 'new@example.com', null, NOW, STARTER)
    await usageRecorder(db, id)(event(1_500))
    expect((await getBalance(db, id)).spentMicros).toBe(1_500)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(usageRecorder(db, 9999)(event(1))).resolves.toBeUndefined() // FK violation is logged, not thrown
  })
})

describe('blocking', () => {
  it('blocks and unblocks a user, never the owner; blocked users get no reminders', async () => {
    const db = testDb()
    const id = await findOrCreateUser(db, 'new@example.com', null, NOW, STARTER)
    expect(await setBlocked(db, OWNER_USER_ID, NOW)).toBe(false)
    expect(await setBlocked(db, id, NOW)).toBe(true)
    expect(await isUserBlocked(db, id)).toBe(true)
    expect((await listUsers(db)).map((u) => u.id)).toEqual([OWNER_USER_ID])
    await setBlocked(db, id, null)
    expect(await isUserBlocked(db, id)).toBe(false)
  })

  it('lists users with spend and balance for /admin', async () => {
    const db = testDb()
    const id = await findOrCreateUser(db, 'new@example.com', null, NOW, STARTER)
    await recordUsage(db, id, event(2_000), NOW)
    const row = (await listUsersWithUsage(db)).find((u) => u.id === id)
    expect(row).toMatchObject({ email: 'new@example.com', spentMicros: 2_000, balanceMicros: 498_000, blockedAt: null })
  })
})
