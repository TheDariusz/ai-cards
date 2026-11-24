import type { Locale } from './locale'

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

export function formatDayLine(today: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${today}T12:00:00Z`))
}
