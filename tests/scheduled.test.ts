import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDb } from './helpers/db'
import { insertPendingCard, markReady, completeFirstLearning, type Db } from '../app/db/repo'
import { cards, users, OWNER_USER_ID as U } from '../app/db/schema'
import { createLogger, type LogEntry, type LogSink } from '../app/lib/logger'
import type { Mailer } from '../app/lib/mailer'
import { isReminderHour } from '../app/lib/reminder'
import { runReminderCron } from '../app/lib/reminder-cron'

const NOW = Date.parse('2026-09-27T17:00:00Z') // 19:00 in Warsaw (CEST)
const DAY = 86_400_000
const CONTENT = { wordPl: 'x', explanationEn: 'x', sentenceEn: 'x', sentencePl: 'x', decodeParts: [{ en: 'x', pl: 'x' }] }

async function addDueCard(db: Db, userId: number) {
  const id = await insertPendingCard(db, userId, 'reluctant', NOW - 3 * DAY)
  await markReady(db, id, CONTENT, null)
  await completeFirstLearning(db, userId, id, NOW - 2 * DAY)
  await db.update(cards).set({ dueAt: NOW - 1 }).where(eq(cards.id, id))
}

function fakeSink() {
  const entries: LogEntry[] = []
  const sink: LogSink = { write: vi.fn(async (batch) => { entries.push(...batch) }) }
  return { sink, entries }
}

describe('runReminderCron', () => {
  it('logs one reminders_run with sent, failed and user counts, then flushes', async () => {
    const db = testDb()
    const [friend] = await db.insert(users).values({ email: 'f@x.dev', createdAt: 0 }).returning()
    await db.insert(users).values({ email: 'idle@x.dev', createdAt: 0 })
    await addDueCard(db, U)
    await addDueCard(db, friend.id)
    const mailerFor = (to: string): Mailer => ({
      send: async () => { if (to === 'f@x.dev') throw new Error('Resend 422: rejected f@x.dev') },
    })
    const { sink, entries } = fakeSink()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runReminderCron({ db, appUrl: 'https://x.dev', mailerFor, ownerFallback: 'o@x.dev', log: createLogger(sink, 'cron') }, NOW)

    expect(sink.write).toHaveBeenCalledTimes(1)
    const runs = entries.filter((e) => e.event === 'reminders_run')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ level: 'info', logger: 'cron', count: 1, failed: 1, users: 3 })
    const failures = entries.filter((e) => e.msg === 'reminder failed')
    expect(failures).toEqual([expect.objectContaining({ level: 'error', user_id: friend.id, err: 'Resend 422: rejected <email>' })])
    // the address stays out of Loki; the full text still reaches wrangler tail
    expect(JSON.stringify(entries)).not.toContain('f@x.dev')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Resend 422: rejected f@x.dev'))
    err.mockRestore()
  })

  it('logs a failed run instead of throwing, and still flushes', async () => {
    const db = testDb()
    const broken = new Proxy(db, { get: (t, p, r) => (p === 'select' ? () => { throw new Error('D1 down') } : Reflect.get(t, p, r)) }) as Db
    const { sink, entries } = fakeSink()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runReminderCron({ db: broken, appUrl: 'https://x.dev', mailerFor: () => null, log: createLogger(sink, 'cron') }, NOW)).resolves.toBeUndefined()

    expect(entries).toEqual([expect.objectContaining({ level: 'error', msg: 'reminder run failed', err: 'Error: D1 down' })])
    expect(entries.some((e) => e.event === 'reminders_run')).toBe(false)
    err.mockRestore()
  })
})

describe('the cron hour guard', () => {
  it('only one of the two UTC triggers is the reminder hour, so the other never reaches runReminderCron', () => {
    expect(isReminderHour(NOW)).toBe(true)
    expect(isReminderHour(NOW + 3_600_000)).toBe(false)
  })
})
