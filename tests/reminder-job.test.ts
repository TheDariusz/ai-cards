import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDb } from './helpers/db'
import { insertPendingCard, markReady, completeFirstLearning, getSetting, setSetting, type Db } from '../app/db/repo'
import { cards, dayLog, users, OWNER_USER_ID as U } from '../app/db/schema'
import { reminderRecipient, runAllReminders, runReminder } from '../app/lib/reminder-job'
import type { MailMessage, Mailer } from '../app/lib/mailer'

const NOW = Date.parse('2026-09-27T17:00:00Z')
const DAY = 86_400_000
const CONTENT = {
  wordPl: 'x', explanationEn: 'x', sentenceEn: 'x', sentencePl: 'x',
  decodeParts: [{ en: 'x', pl: 'x' }],
}

function fakeMailer() {
  const sent: MailMessage[] = []
  const mailer: Mailer & { sent: MailMessage[] } = { sent, send: async (m) => { sent.push(m) } }
  return mailer
}

async function addDueCard(db: Db, userId = U) {
  const id = await insertPendingCard(db, userId, 'reluctant', NOW - 3 * DAY)
  await markReady(db, id, CONTENT, null)
  await completeFirstLearning(db, userId, id, NOW - 2 * DAY)
  await db.update(cards).set({ dueAt: NOW - 1 }).where(eq(cards.id, id))
}

const deps = (db: Db, mailer: Mailer) => ({ db, mailer, appUrl: 'https://x.dev' })

describe('runReminder', () => {
  it('sends and records lastSent', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: true, due: 1, fresh: 0, streak: 0 })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].subject).toBe('1 karta do powtórki')
    expect(await getSetting(db, U, 'reminderLastSent')).toBe('2026-09-27')
  })

  it('does not send twice the same day', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await runReminder(deps(db, mailer), U, NOW)
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: false, reason: 'already-sent' })
    expect(mailer.sent).toHaveLength(1)
  })

  it('skips when disabled', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await setSetting(db, U, 'reminderEnabled', 'false')
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: false, reason: 'disabled' })
    expect(mailer.sent).toHaveLength(0)
  })

  it('skips when the day is done', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await db.insert(dayLog).values({ date: '2026-09-27' })
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: false, reason: 'day-done' })
    expect(mailer.sent).toHaveLength(0)
  })

  it('skips when there is nothing to do', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: false, reason: 'nothing-to-do' })
    expect(mailer.sent).toHaveLength(0)
  })

  it('counts cards that come due later tonight', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    // due at 21:30 Warsaw, after the 19:00 run but before midnight
    await db.update(cards).set({ dueAt: NOW + 2.5 * 3_600_000 })
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: true, due: 1, fresh: 0, streak: 0 })
    // /review shows nothing yet, so the mail must say when the card is ready
    expect(mailer.sent[0].text).toContain('Będzie gotowa o 21:30.')
  })

  it('tells apart cards due now and later tonight', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await addDueCard(db)
    const [, second] = await db.select().from(cards)
    await db.update(cards).set({ dueAt: NOW + 3 * 3_600_000 }).where(eq(cards.id, second.id))
    await runReminder(deps(db, mailer), U, NOW)
    expect(mailer.sent[0].text).toContain('Teraz możesz powtórzyć 1, ostatnia będzie gotowa o 22:00.')
  })

  it('ignores cards due after midnight', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    // 00:30 Warsaw tomorrow
    await db.update(cards).set({ dueAt: NOW + 5.5 * 3_600_000 })
    expect(await runReminder(deps(db, mailer), U, NOW)).toEqual({ send: false, reason: 'nothing-to-do' })
  })

  it('includes the streak from previous days', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await db.insert(dayLog).values({ date: '2026-09-26' })
    await runReminder(deps(db, mailer), U, NOW)
    expect(mailer.sent[0].subject.endsWith(' · streak 1 dzień')).toBe(true)
  })

  it('leaves lastSent unset when sending fails', async () => {
    const db = testDb()
    await addDueCard(db)
    const failing: Mailer = { send: async () => { throw new Error('boom') } }
    await expect(runReminder(deps(db, failing), U, NOW)).rejects.toThrow('boom')
    expect(await getSetting(db, U, 'reminderLastSent')).toBeNull()
  })

  it('force sends despite day-done and disabled, marks [Test], keeps lastSent unset', async () => {
    const db = testDb()
    const mailer = fakeMailer()
    await addDueCard(db)
    await db.insert(dayLog).values({ date: '2026-09-27' })
    await setSetting(db, U, 'reminderEnabled', 'false')
    const result = await runReminder(deps(db, mailer), U, NOW, { force: true })
    expect(result.send).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].subject.startsWith('[Test] ')).toBe(true)
    expect(await getSetting(db, U, 'reminderLastSent')).toBeNull()
  })
})

describe('reminderRecipient', () => {
  it('uses the login email, falling back to REMINDER_TO for the owner only', () => {
    expect(reminderRecipient({ id: 2, email: 'f@x.dev' }, 'o@x.dev')).toBe('f@x.dev')
    expect(reminderRecipient({ id: U, email: null }, ' o@x.dev ')).toBe('o@x.dev')
    expect(reminderRecipient({ id: U, email: null })).toBeNull()
    expect(reminderRecipient({ id: 2, email: null }, 'o@x.dev')).toBeNull()
  })
})

describe('runAllReminders', () => {
  it('reminds each user at their own address about their own cards', async () => {
    const db = testDb()
    const [friend] = await db.insert(users).values({ email: 'f@x.dev', createdAt: 0 }).returning()
    const [idle] = await db.insert(users).values({ email: 'idle@x.dev', createdAt: 0 }).returning()
    await addDueCard(db, U)
    await addDueCard(db, friend.id)
    await addDueCard(db, friend.id)
    const inbox = new Map<string, MailMessage[]>()
    const mailerFor = (to: string): Mailer => ({ send: async (m) => { inbox.set(to, [...(inbox.get(to) ?? []), m]) } })

    const results = await runAllReminders({ db, appUrl: 'https://x.dev', mailerFor, ownerFallback: 'o@x.dev' }, NOW)

    expect(inbox.get('o@x.dev')?.[0].subject).toBe('1 karta do powtórki')
    expect(inbox.get('f@x.dev')?.[0].subject).toBe('2 karty do powtórki')
    expect(inbox.has('idle@x.dev')).toBe(false)
    expect(results.find((r) => r.userId === idle.id)?.result).toEqual({ send: false, reason: 'nothing-to-do' })
    expect(await getSetting(db, friend.id, 'reminderLastSent')).toBe('2026-09-27')
  })

  it('one failing address does not stop the others', async () => {
    const db = testDb()
    const [friend] = await db.insert(users).values({ email: 'f@x.dev', createdAt: 0 }).returning()
    await addDueCard(db, U)
    await addDueCard(db, friend.id)
    const sent: string[] = []
    const mailerFor = (to: string): Mailer => ({
      send: async () => { if (to === 'o@x.dev') throw new Error('Resend 422'); sent.push(to) },
    })
    const results = await runAllReminders({ db, appUrl: 'https://x.dev', mailerFor, ownerFallback: 'o@x.dev' }, NOW)
    expect(results.find((r) => r.userId === U)?.error).toBe('Resend 422')
    expect(sent).toEqual(['f@x.dev'])
  })
})
