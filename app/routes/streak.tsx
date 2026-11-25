import type { Route } from './+types/streak'
import { requireAuth } from '../lib/session'
import { completedDays, countCards, createDb } from '../db/repo'
import { useT } from '../lib/i18n'
import { parseLocale } from '../lib/locale'
import { computeStreak, dayKey, dayStatus, longestStreak, monthGrid } from '../lib/streak'
import { formatMonth } from '../lib/today'
import { TaskHead } from '../ui/task-head'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const today = dayKey(Date.now())
  const [days, total] = await Promise.all([completedDays(db, userId), countCards(db, userId)])
  const month = today.slice(0, 7)
  const locale = parseLocale(request.headers.get('Cookie'))
  return {
    today,
    monthName: formatMonth(today, locale),
    streak: computeStreak(days, today),
    longest: longestStreak(days),
    grid: monthGrid(today),
    done: days.filter((d) => d.startsWith(month)),
    total,
  }
}

export default function Streak({ loaderData }: Route.ComponentProps) {
  const { today, monthName, streak, longest, grid, done, total } = loaderData
  const t = useT()
  const doneSet = new Set(done)
  const rows = Array.from({ length: Math.ceil(grid.length / 7) }, (_, i) => {
    const row = grid.slice(i * 7, i * 7 + 7)
    return [...row, ...Array<null>(7 - row.length).fill(null)]
  })

  const stateLabel = { done: t.streak.dayDone, today: t.streak.dayToday, future: t.streak.dayFuture, missed: t.streak.dayMissed }

  return (
    <main className="page streak-page">
      <TaskHead to="/" label={t.streak.back}><h1>{t.streak.title}</h1></TaskHead>

      <div className="streak-hero">
        <span className="streak-number">{streak}</span>
        <p>
          {t.streak.inARow(streak)}
          <br />
          <span className="muted">{t.streak.longest(longest)}</span>
        </p>
      </div>

      <section className="surface-card">
        <h2 className="streak-month">{monthName}</h2>
        <table className="cal">
          <thead>
            <tr>{t.home.weekdays.map((w) => <th key={w} scope="col">{w}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((day, c) => {
                  if (day === null) return <td key={c} />
                  const status = dayStatus(day, today, doneSet)
                  return (
                    <td key={c} className={status}>
                      <span className="cal-day">{Number(day.slice(8))}</span>
                      <span className="visually-hidden">, {stateLabel[status]}</span>
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
