import { completedDays, countDue, countNew, getSetting, isDayDone, listUsers, nextDueAt, setSetting, type Db } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import type { Mailer } from './mailer'
import { buildReminder, shouldRemind, type SkipReason } from './reminder'
import { computeStreak, dayKey, endOfDay } from './streak'

export type ReminderDeps = { db: Db; mailer: Mailer; appUrl: string }
export type ReminderResult =
  | { send: false; reason: SkipReason }
  | { send: true; due: number; fresh: number; streak: number }

export async function runReminder(
  deps: ReminderDeps, userId: number, now: number, { force = false }: { force?: boolean } = {},
): Promise<ReminderResult> {
  const { db, mailer, appUrl } = deps
  const today = dayKey(now)
  const enabled = (await getSetting(db, userId, 'reminderEnabled')) !== 'false'
  const lastSent = await getSetting(db, userId, 'reminderLastSent')
  const dayDone = await isDayDone(db, userId, today)
  // cards that come due later tonight still count: the day is only lost at midnight
  const due = await countDue(db, userId, endOfDay(now))
  const laterCount = due - (await countDue(db, userId, now))
  const later = laterCount > 0 ? { count: laterCount, from: (await nextDueAt(db, userId, now))! } : undefined
  const fresh = await countNew(db, userId)

  if (!force) {
    const decision = shouldRemind({ enabled, today, lastSent, dayDone, due, fresh })
    if (!decision.send) return decision
  }

  const streak = computeStreak(await completedDays(db, userId), today)
  const msg = buildReminder({ due, fresh, streak, appUrl, later })
  if (force) msg.subject = `[Test] ${msg.subject}`
  // send first, then record: a failed send never blocks a later attempt
  await mailer.send(msg)
  if (!force) await setSetting(db, userId, 'reminderLastSent', today)
  return { send: true, due, fresh, streak }
}

// The user's login email; the owner falls back to REMINDER_TO until their first email login.
export function reminderRecipient(user: { id: number; email: string | null }, ownerFallback?: string): string | null {
  return user.email ?? (user.id === OWNER_USER_ID ? ownerFallback?.trim() || null : null)
}

export type AllRemindersDeps = {
  db: Db
  appUrl: string
  mailerFor: (to: string) => Mailer | null
  ownerFallback?: string
}

// One user's failure (bad address, Resend error) never stops the others.
export async function runAllReminders(deps: AllRemindersDeps, now: number) {
  const results: { userId: number; result?: ReminderResult; error?: string }[] = []
  for (const user of await listUsers(deps.db)) {
    const to = reminderRecipient(user, deps.ownerFallback)
    const mailer = to ? deps.mailerFor(to) : null
    if (!mailer) {
      results.push({ userId: user.id, error: 'no recipient or mailer' })
      continue
    }
    try {
      results.push({ userId: user.id, result: await runReminder({ db: deps.db, mailer, appUrl: deps.appUrl }, user.id, now) })
    } catch (err) {
      results.push({ userId: user.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
