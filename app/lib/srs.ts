export type Grade = 'again' | 'good' | 'easy'
export interface SrsState { dueAt: number; intervalDays: number; ease: number }
export const DAY_MS = 86_400_000
export function newCardSrs(now: number): SrsState {
  return { dueAt: now + DAY_MS, intervalDays: 1, ease: 2.5 }
}
