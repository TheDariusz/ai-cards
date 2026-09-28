import { completedDays, countDue, countNew, getSetting, isDayDone, nextDueAt, setSetting, type Db } from '../db/repo'
import type { Mailer } from './mailer'
import { buildReminder, shouldRemind, type SkipReason } from './reminder'
import { computeStreak, dayKey, endOfDay } from './streak'

export type ReminderDeps = { db: Db; mailer: Mailer; appUrl: string }
export type ReminderResult =
  | { send: false; reason: SkipReason }
  | { send: true; due: number; fresh: number; streak: number }

export async function runReminder(
  deps: ReminderDeps, now: number, { force = false }: { force?: boolean } = {},
): Promise<ReminderResult> {
  const { db, mailer, appUrl } = deps
  const today = dayKey(now)
  const enabled = (await getSetting(db, 'reminderEnabled')) !== 'false'
  const lastSent = await getSetting(db, 'reminderLastSent')
  const dayDone = await isDayDone(db, today)
  // cards that come due later tonight still count: the day is only lost at midnight
  const due = await countDue(db, endOfDay(now))
  const laterCount = due - (await countDue(db, now))
  const later = laterCount > 0 ? { count: laterCount, from: (await nextDueAt(db, now))! } : undefined
  const fresh = await countNew(db)

  if (!force) {
    const decision = shouldRemind({ enabled, today, lastSent, dayDone, due, fresh })
    if (!decision.send) return decision
  }

  const streak = computeStreak(await completedDays(db), today)
  const msg = buildReminder({ due, fresh, streak, appUrl, later })
  if (force) msg.subject = `[Test] ${msg.subject}`
  // send first, then record: a failed send never blocks a later attempt
  await mailer.send(msg)
  if (!force) await setSetting(db, 'reminderLastSent', today)
  return { send: true, due, fresh, streak }
}
