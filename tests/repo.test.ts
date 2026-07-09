import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { insertPendingCard, getDueCards, countDue, getCard, listCards, markReady, applyReview, completedDays, updateCardContent, deleteCard } from '../app/db/repo'
import { dayKey } from '../app/lib/streak'

const NOW = 1_750_000_000_000
const DAY = 86_400_000

const CONTENT = {
  wordPl: 'x', explanationEn: 'x', sentenceEn: 'x', sentencePl: 'x',
}

describe('repo', () => {
  it('inserts a pending card due tomorrow', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    const card = await getCard(db, id)
    expect(card!.status).toBe('pending')
    expect(card!.word).toBe('reluctant')
    expect(card!.dueAt).toBe(NOW + DAY)
    expect(card!.ease).toBe(2.5)
  })

  it('due list contains only ready cards whose dueAt has passed', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    expect(await getDueCards(db, NOW + 2 * DAY)).toHaveLength(0) // still pending
    await markReady(db, id, {
      wordPl: 'niechętny',
      explanationEn: 'not wanting to do something',
      sentenceEn: 'She was reluctant to speak.',
      sentencePl: 'Była niechętna do mówienia.',
    }, 'audio/1.mp3')
    expect(await getDueCards(db, NOW)).toHaveLength(0)          // not due yet
    expect(await getDueCards(db, NOW + 2 * DAY)).toHaveLength(1)
    expect(await countDue(db, NOW + 2 * DAY)).toBe(1)
  })

  it('lists cards newest first', async () => {
    const db = testDb()
    await insertPendingCard(db, 'first', NOW)
    await insertPendingCard(db, 'second', NOW + 1000)
    const all = await listCards(db)
    expect(all.map((c) => c.word)).toEqual(['second', 'first'])
  })
})

describe('applyReview', () => {
  it('reschedules, logs, and completes the day when no cards remain due', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    const later = NOW + 2 * DAY
    await applyReview(db, id, 'good', 'flip', null, later)
    const card = await getCard(db, id)
    expect(card!.dueAt).toBeGreaterThan(later)          // rescheduled
    expect(await countDue(db, later)).toBe(0)
    expect(await completedDays(db)).toEqual([dayKey(later)])
  })

  it('does not complete the day while cards are still due', async () => {
    const db = testDb()
    const a = await insertPendingCard(db, 'a', NOW)
    const b = await insertPendingCard(db, 'b', NOW)
    await markReady(db, a, CONTENT, null)
    await markReady(db, b, CONTENT, null)
    const later = NOW + 2 * DAY
    await applyReview(db, a, 'good', 'flip', null, later)
    expect(await completedDays(db)).toEqual([])
  })
})

describe('updateCardContent / deleteCard', () => {
  it('updates content but preserves SRS state', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    const before = await getCard(db, id)
    await updateCardContent(db, id, { ...CONTENT, sentenceEn: 'He is reluctant to go.' })
    const after = await getCard(db, id)
    expect(after!.sentenceEn).toBe('He is reluctant to go.')
    expect(after!.dueAt).toBe(before!.dueAt)
    expect(after!.ease).toBe(before!.ease)
  })

  it('deletes a card and its review log rows', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    await markReady(db, id, CONTENT, null)
    await applyReview(db, id, 'good', 'flip', null, NOW + 2 * DAY)
    await deleteCard(db, id)
    expect(await getCard(db, id)).toBeUndefined()
  })
})
