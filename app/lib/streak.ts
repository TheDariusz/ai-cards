export function dayKey(epochMs: number, timeZone = 'Europe/Warsaw'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochMs)) // en-CA yields YYYY-MM-DD
}

function prevDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function computeStreak(completedDays: string[], today: string): number {
  const done = new Set(completedDays)
  let cursor = done.has(today) ? today : prevDay(today)
  let streak = 0
  while (done.has(cursor)) {
    streak++
    cursor = prevDay(cursor)
  }
  return streak
}
