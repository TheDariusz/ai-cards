import { Link } from 'react-router'
import type { Route } from './+types/streak'
import { requireAuth } from '../lib/session'
import { completedDays, createDb, listCards } from '../db/repo'
import { useLocale, useT } from '../lib/i18n'
import { computeStreak, dayKey, longestStreak, monthGrid } from '../lib/streak'
import { Icon } from '../ui/icons'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const today = dayKey(Date.now())
  const days = await completedDays(db, userId)
  const month = today.slice(0, 7)
  return {
    today,
    streak: computeStreak(days, today),
    longest: longestStreak(days),
    grid: monthGrid(today),
    done: days.filter((d) => d.startsWith(month)),
    total: (await listCards(db, userId)).length,
  }
}

export default function Streak({ loaderData }: Route.ComponentProps) {
  const { today, streak, longest, grid, done, total } = loaderData
  const t = useT()
  const locale = useLocale()
  const doneSet = new Set(done)
  // Noon UTC keeps the month name stable in any viewer time zone.
  const month = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${today.slice(0, 8)}01T12:00:00Z`))
  const rows = Array.from({ length: Math.ceil(grid.length / 7) }, (_, i) => {
    const row = grid.slice(i * 7, i * 7 + 7)
    return [...row, ...Array<null>(7 - row.length).fill(null)]
  })

  const cell = (day: string) => {
    if (doneSet.has(day)) return { className: 'done', state: t.streak.dayDone }
    if (day === today) return { className: 'today', state: t.streak.dayToday }
    if (day > today) return { className: 'future', state: t.streak.dayFuture }
    return { className: undefined, state: t.streak.dayMissed }
  }

  return (
    <main className="page streak-page">
      <header className="task-head">
        <Link to="/" aria-label={t.streak.back}><Icon name="back" /></Link>
        <h1>{t.streak.title}</h1>
      </header>

      <div className="streak-hero">
        <span className="streak-number">{streak}</span>
        <p>
          {t.streak.inARow(streak)}
          <br />
          <span className="muted">{t.streak.longest(longest)}</span>
        </p>
      </div>

      <section className="surface-card">
        <h2 className="streak-month">{month}</h2>
        <table className="cal">
          <thead>
            <tr>{t.home.weekdays.map((w) => <th key={w} scope="col">{w}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((day, c) => {
                  if (day === null) return <td key={c} className="empty" />
                  const { className, state } = cell(day)
                  return (
                    <td key={c} className={className}>
                      {Number(day.slice(8))}
                      <span className="cal-hidden">, {state}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="streak-stats">
        <div className="surface-card"><b>{done.length}</b><span className="muted">{t.streak.studyDays}</span></div>
        <div className="surface-card"><b>{total}</b><span className="muted">{t.streak.totalCards}</span></div>
      </div>
    </main>
  )
}
