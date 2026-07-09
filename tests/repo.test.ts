import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { insertPendingCard, getDueCards, countDue, getCard, listCards, markReady } from '../app/db/repo'

const NOW = 1_750_000_000_000
const DAY = 86_400_000

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
