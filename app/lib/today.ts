import type { Locale } from './locale'
import { computeStreak } from './streak'

const SECONDS_PER_CARD = 30

export function reviewMinutes(due: number): number {
  return Math.max(1, Math.round((due * SECONDS_PER_CARD) / 60))
}

export type TodayState = 'first-run' | 'preparing' | 'review' | 'learn' | 'done' | 'nothing-due'

export function todayState(i: {
  total: number
  ready: number
  due: number
  newCount: number
  todayDone: boolean
}): TodayState {
  if (i.total === 0) return 'first-run'
  if (i.ready === 0) return 'preparing'
  if (i.due > 0) return 'review'
  if (i.todayDone) return 'done'
  if (i.newCount > 0) return 'learn'
  return 'nothing-due'
}

// Noon UTC keeps the date stable in any time zone.
const formatDay = (day: string, locale: Locale, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', { timeZone: 'UTC', ...options }).format(new Date(`${day}T12:00:00Z`))

export function formatDayLine(today: string, locale: Locale): string {
  return formatDay(today, locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function formatMonth(today: string, locale: Locale): string {
  return formatDay(today, locale, { month: 'long' })
}

// What the Done card reports: reviews when there were any today, otherwise words learned today.
export function doneLine(reviewedToday: number, learnedToday: number): { kind: 'reviewed' | 'learned'; n: number } | null {
  if (reviewedToday > 0) return { kind: 'reviewed', n: reviewedToday }
  if (learnedToday > 0) return { kind: 'learned', n: learnedToday }
  return null
}

// The closing screen when Learn or Review has nothing left: how many were done today (null when none),
// and the streak only once today is a completed day (reviews still due keep it open).
export function finishSummary(doneToday: number, completedDays: string[], today: string): { done: number | null; streak: number | null } {
  return {
    done: doneToday > 0 ? doneToday : null,
    streak: completedDays.includes(today) ? computeStreak(completedDays, today) : null,
  }
}
