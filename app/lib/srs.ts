export type Grade = 'again' | 'good' | 'easy'

export interface SrsState {
  dueAt: number
  intervalDays: number
  ease: number
}

export const DAY_MS = 86_400_000

export function newCardSrs(now: number): SrsState {
  return { dueAt: now + DAY_MS, intervalDays: 1, ease: 2.5 }
}

export function schedule(state: SrsState, grade: Grade, now: number): SrsState {
  if (grade === 'again') {
    const ease = Math.max(1.3, round2(state.ease - 0.2))
    return { intervalDays: 1, ease, dueAt: now + DAY_MS }
  }
  const goodInterval = state.intervalDays <= 1 ? 3 : state.intervalDays * state.ease
  if (grade === 'good') {
    return { intervalDays: goodInterval, ease: state.ease, dueAt: due(now, goodInterval) }
  }
  // easy
  const intervalDays = goodInterval * 1.3
  const ease = Math.min(3.0, round2(state.ease + 0.15))
  return { intervalDays, ease, dueAt: due(now, intervalDays) }
}

function due(now: number, intervalDays: number): number {
  return Math.round(now + intervalDays * DAY_MS)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
