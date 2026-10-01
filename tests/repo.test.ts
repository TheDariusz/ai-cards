import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { eq } from 'drizzle-orm'
import { insertPendingCard, getDueCards, countDue, getCard, listCards, markReady, applyReview, completedDays, updateCardContent, deleteCard, getNewCards, completeFirstLearning, countReviewsOn, getSetting, setSetting, isDayDone, countNew, nextDueAt, setAudioKey, listReviewLog, type Db } from '../app/db/repo'
import { reviewLog, dayLog, users, OWNER_USER_ID as U } from '../app/db/schema'
import { dayKey } from '../app/lib/streak'

const NOW = 1_750_000_000_000
const DAY = 86_400_000

const CONTENT = {
  wordPl: 'x', explanationEn: 'x', sentenceEn: 'x', sentencePl: 'x',
  decodeParts: [{ en: 'x', pl: 'x' }],
}

describe('repo', () => {
  it('inserts a pending card due tomorrow', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    const card = await getCard(db, U, id)
    expect(card!.status).toBe('pending')
    expect(card!.word).toBe('reluctant')
    expect(card!.dueAt).toBe(NOW + DAY)
    expect(card!.ease).toBe(2.5)
    expect(card!.firstLearnedAt).toBeNull()
  })

  it('due list contains only ready cards whose dueAt has passed', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    expect(await getDueCards(db, U, NOW + 2 * DAY)).toHaveLength(0) // still pending
    await markReady(db, id, {
      wordPl: 'niechętny',
      explanationEn: 'not wanting to do something',
      sentenceEn: 'She was reluctant to speak.',
      sentencePl: 'Była niechętna do mówienia.',
      decodeParts: [{ en: 'She was reluctant to speak.', pl: 'Ona była niechętna żeby mówić.' }],
    }, 'audio/1.mp3')
    expect(await getNewCards(db, U, U)).toHaveLength(1)
    expect(await getDueCards(db, U, NOW + 2 * DAY)).toHaveLength(0) // first learning still pending
    expect(await completeFirstLearning(db, U, id, NOW + 2 * DAY)).toBe(true)
    expect(await completeFirstLearning(db, U, id, NOW + 2 * DAY + 1000)).toBe(false)
    expect(await getNewCards(db, U, U)).toHaveLength(0)
    expect((await getCard(db, U, id))!.dueAt).toBe(NOW + 3 * DAY)
    expect(await getDueCards(db, U, NOW + 2 * DAY)).toHaveLength(0) // first review is tomorrow
    expect(await getDueCards(db, U, NOW + 3 * DAY)).toHaveLength(1)
    expect(await countDue(db, U, NOW + 3 * DAY)).toBe(1)
  })

  it('lists cards newest first', async () => {
    const db = testDb()
    await insertPendingCard(db, U, 'first', NOW)
    await insertPendingCard(db, U, 'second', NOW + 1000)
    const all = await listCards(db, U, U)
    expect(all.map((c) => c.word)).toEqual(['second', 'first'])
  })
})

describe('applyReview', () => {
  it('does not allow an unlearned card to bypass first learning', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    await applyReview(db, U, id, 'good', 'flip', null, NOW + 2 * DAY)
    expect(await getNewCards(db, U, U)).toHaveLength(1)
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })

  it('reschedules, logs, and completes the day when no cards remain due', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    await completeFirstLearning(db, U, id, NOW)
    const later = NOW + 2 * DAY
    await applyReview(db, U, id, 'good', 'flip', null, later)
    const card = await getCard(db, U, id)
    expect(card!.dueAt).toBeGreaterThan(later)          // rescheduled
    expect(await countDue(db, U, later)).toBe(0)
    expect(await completedDays(db, U, U)).toEqual([dayKey(later)])
  })

  it('does not complete the day while cards are still due', async () => {
    const db = testDb()
    const a = await insertPendingCard(db, U, 'a', NOW)
    const b = await insertPendingCard(db, U, 'b', NOW)
    await markReady(db, a, CONTENT, null)
    await markReady(db, b, CONTENT, null)
    await completeFirstLearning(db, U, a, NOW)
    await completeFirstLearning(db, U, b, NOW)
    const later = NOW + 2 * DAY
    await applyReview(db, U, a, 'good', 'flip', null, later)
    expect(await completedDays(db, U, U)).toEqual([])
  })
})

describe('updateCardContent / deleteCard', () => {
  it('updates content but preserves SRS state', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    await completeFirstLearning(db, U, id, NOW)
    const before = await getCard(db, U, id)
    await updateCardContent(db, U, id, { ...CONTENT, sentenceEn: 'He is reluctant to go.' })
    const after = await getCard(db, U, id)
    expect(after!.sentenceEn).toBe('He is reluctant to go.')
    expect(after!.dueAt).toBe(before!.dueAt)
    expect(after!.ease).toBe(before!.ease)
    expect(after!.intervalDays).toBe(before!.intervalDays)
  })

  it('deletes a card and its review log rows', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    await completeFirstLearning(db, U, id, NOW)
    await applyReview(db, U, id, 'good', 'flip', null, NOW + 2 * DAY)
    await deleteCard(db, U, id)
    expect(await getCard(db, U, id)).toBeUndefined()
    const orphans = await db.select().from(reviewLog).where(eq(reviewLog.cardId, id))
    expect(orphans).toHaveLength(0)
  })
})

describe('countReviewsOn', () => {
  it('counts only reviews on the given Warsaw day', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    const day = dayKey(NOW)
    // Warsaw midnight at the start of `day`, found by stepping back from NOW
    let midnight = NOW
    while (dayKey(midnight - 60_000) === day) midnight -= 60_000
    await db.insert(reviewLog).values([
      { cardId: id, reviewedAt: midnight - 60_000, mode: 'flip', grade: 'good', typed: null }, // previous day
      { cardId: id, reviewedAt: midnight, mode: 'flip', grade: 'good', typed: null },
      { cardId: id, reviewedAt: NOW, mode: 'write', grade: 'again', typed: 'x' },
    ])
    expect(await countReviewsOn(db, U, day)).toBe(2)
    expect(await countReviewsOn(db, U, dayKey(midnight - 60_000))).toBe(1)
  })
})

describe('settings', () => {
  it('returns null for a missing key and upserts values', async () => {
    const db = testDb()
    expect(await getSetting(db, U, 'reminderEnabled')).toBeNull()
    await setSetting(db, U, 'reminderEnabled', 'false')
    expect(await getSetting(db, U, 'reminderEnabled')).toBe('false')
    await setSetting(db, U, 'reminderEnabled', 'true')
    expect(await getSetting(db, U, 'reminderEnabled')).toBe('true')
  })
})

describe('isDayDone', () => {
  it('reads day_log for the given day only', async () => {
    const db = testDb()
    expect(await isDayDone(db, U, dayKey(NOW))).toBe(false)
    await db.insert(dayLog).values({ date: dayKey(NOW) })
    expect(await isDayDone(db, U, dayKey(NOW))).toBe(true)
    expect(await isDayDone(db, U, dayKey(NOW + DAY))).toBe(false)
  })
})

describe('countNew', () => {
  it('counts exactly what getNewCards returns', async () => {
    const db = testDb()
    const agree = async () => expect(await countNew(db, U, U)).toBe((await getNewCards(db, U, U)).length)
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    expect(await countNew(db, U, U)).toBe(0)
    await agree()
    await markReady(db, id, CONTENT, null)
    expect(await countNew(db, U, U)).toBe(1)
    await agree()
    const noDecode = await insertPendingCard(db, U, 'eager', NOW)
    await markReady(db, noDecode, CONTENT, null)
    await updateCardContent(db, U, noDecode, { ...CONTENT, decodeParts: null })
    expect(await countNew(db, U, U)).toBe(1)
    await agree()
    await completeFirstLearning(db, U, id, NOW)
    expect(await countNew(db, U, U)).toBe(0)
    await agree()
  })
})

describe('per-user isolation', () => {
  async function twoUsers() {
    const db = testDb()
    const [other] = await db.insert(users).values({ email: 'other@example.com', createdAt: NOW }).returning()
    const mine = await insertPendingCard(db, U, 'reluctant', NOW - 3 * DAY)
    await markReady(db, mine, CONTENT, 'audio/mine.mp3')
    await completeFirstLearning(db, U, mine, NOW - 2 * DAY)
    return { db, other: other.id, mine }
  }

  async function snapshot(db: Db) {
    return { card: await getCard(db, U, (await listCards(db, U))[0].id), log: await listReviewLog(db, U) }
  }

  it('another user sees none of my cards, counts or history', async () => {
    const { db, other, mine } = await twoUsers()
    await applyReview(db, U, mine, 'good', 'flip', null, NOW)
    expect(await getCard(db, other, mine)).toBeUndefined()
    expect(await listCards(db, other)).toEqual([])
    expect(await getDueCards(db, other, NOW + 365 * DAY)).toEqual([])
    expect(await countDue(db, other, NOW + 365 * DAY)).toBe(0)
    expect(await nextDueAt(db, other, NOW)).toBeNull()
    expect(await countReviewsOn(db, other, dayKey(NOW))).toBe(0)
    expect(await listReviewLog(db, other)).toEqual([])
    expect(await completedDays(db, other)).toEqual([])
    expect(await isDayDone(db, other, dayKey(NOW))).toBe(false)
    expect(await listReviewLog(db, U)).toHaveLength(1)
    expect(await completedDays(db, U)).toEqual([dayKey(NOW)])
  })

  it('another user cannot change or delete my card by id', async () => {
    const { db, other, mine } = await twoUsers()
    const before = await snapshot(db)
    await applyReview(db, other, mine, 'easy', 'flip', null, NOW)
    await updateCardContent(db, other, mine, { ...CONTENT, wordPl: 'hacked' })
    await setAudioKey(db, other, mine, null)
    await deleteCard(db, other, mine)
    expect(await snapshot(db)).toEqual(before)
  })

  it('new cards and first learning are per user', async () => {
    const db = testDb()
    const [other] = await db.insert(users).values({ email: 'other@example.com', createdAt: NOW }).returning()
    const id = await insertPendingCard(db, U, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    expect(await countNew(db, other.id)).toBe(0)
    expect(await getNewCards(db, other.id)).toEqual([])
    expect(await completeFirstLearning(db, other.id, id, NOW)).toBe(false)
    expect(await countNew(db, U)).toBe(1)
  })

  it('settings are per user', async () => {
    const db = testDb()
    const [other] = await db.insert(users).values({ email: 'other@example.com', createdAt: NOW }).returning()
    await setSetting(db, U, 'reminderEnabled', 'false')
    expect(await getSetting(db, other.id, 'reminderEnabled')).toBeNull()
    await setSetting(db, other.id, 'reminderEnabled', 'true')
    expect(await getSetting(db, U, 'reminderEnabled')).toBe('false')
  })
})
