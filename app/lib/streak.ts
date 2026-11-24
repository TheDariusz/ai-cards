export function dayKey(epochMs: number, timeZone = 'Europe/Warsaw'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochMs)) // en-CA yields YYYY-MM-DD
}

const HOUR = 3_600_000

// Last ms of the Warsaw day containing epochMs. Warsaw offsets are whole hours,
// so the next midnight is always on a UTC hour boundary.
export function endOfDay(epochMs: number): number {
  const today = dayKey(epochMs)
  let t = Math.floor(epochMs / HOUR) * HOUR
  while (dayKey(t) === today) t += HOUR
  return t - 1
}

// First ms of the Warsaw day containing epochMs (same whole-hour argument as endOfDay).
export function startOfDay(epochMs: number): number {
  const today = dayKey(epochMs)
  let t = Math.floor(epochMs / HOUR) * HOUR
  while (dayKey(t - HOUR) === today) t -= HOUR
  return t
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

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Monday = 0 … Sunday = 6
function mondayIndex(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}

export function longestStreak(completedDays: string[]): number {
  const done = new Set(completedDays)
  let best = 0
  for (const day of done) {
    if (done.has(prevDay(day))) continue // not the start of a run
    let length = 0
    for (let cursor = day; done.has(cursor); cursor = shiftDay(cursor, 1)) length++
    best = Math.max(best, length)
  }
  return best
}

export function weekDays(today: string): string[] {
  const monday = shiftDay(today, -mondayIndex(today))
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i))
}

export function monthGrid(today: string): (string | null)[] {
  const first = `${today.slice(0, 8)}01`
  const grid: (string | null)[] = Array(mondayIndex(first)).fill(null)
  for (let day = first; day.slice(0, 7) === first.slice(0, 7); day = shiftDay(day, 1)) grid.push(day)
  return grid
}
