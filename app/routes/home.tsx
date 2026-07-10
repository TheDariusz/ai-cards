import { Form, Link, useRevalidator } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { requireAuth } from '../lib/session'
import { createDb, insertPendingCard, getCard, listCards, countDue, completedDays } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { aiFromEnv } from '../lib/openrouter'
import { computeStreak, dayKey } from '../lib/streak'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const all = await listCards(db)
  const now = Date.now()
  const days = await completedDays(db)
  const today = dayKey(now)
  return {
    pending: all.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, word: c.word })),
    failed: all.filter((c) => c.status === 'failed').map((c) => ({ id: c.id, word: c.word })),
    total: all.length,
    due: await countDue(db, now),
    streak: computeStreak(days, today),
    completed: days.filter((d) => d.startsWith(today.slice(0, 7))), // this month
    today,
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const form = await request.formData()
  const intent = form.get('intent')

  if (intent === 'add') {
    const word = String(form.get('word') ?? '').trim()
    if (!word) return { error: 'Type a word first' }
    const id = await insertPendingCard(db, word, Date.now())
    context.cloudflare.ctx.waitUntil(
      runCardPipeline({ db, ai: aiFromEnv(env), audio: env.AUDIO }, id, word),
    )
    return { added: word }
  }

  if (intent === 'retry') {
    const id = Number(form.get('cardId'))
    const card = await getCard(db, id)
    if (card?.status === 'failed') {
      context.cloudflare.ctx.waitUntil(
        runCardPipeline({ db, ai: aiFromEnv(env), audio: env.AUDIO }, id, card.word),
      )
    }
    return { retried: id }
  }
  return null
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { pending, failed, total, due, streak, completed, today } = loaderData
  const revalidator = useRevalidator()

  // light polling while cards are generating
  useEffect(() => {
    if (pending.length === 0) return
    const t = setInterval(() => revalidator.revalidate(), 3000)
    return () => clearInterval(t)
  }, [pending.length, revalidator])

  return (
    <main className="page">
      <h1>AI Cards</h1>
      <Form method="post" className="quick-add">
        <input type="hidden" name="intent" value="add" />
        <input name="word" placeholder="New word…" autoComplete="off" autoFocus />
        <button type="submit">Add</button>
      </Form>
      {actionData && 'added' in actionData && <p className="ok">Added “{actionData.added}” — generating…</p>}
      {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}

      {pending.length > 0 && (
        <p className="pending">⏳ Generating: {pending.map((c) => c.word).join(', ')}</p>
      )}
      {failed.map((c) => (
        <Form method="post" key={c.id} className="failed-row">
          <input type="hidden" name="intent" value="retry" />
          <input type="hidden" name="cardId" value={c.id} />
          <span className="error">“{c.word}” failed</span>
          <button type="submit">Retry</button>
        </Form>
      ))}

      <div className="stats">
        <div className="stat"><b>{due}</b> due today</div>
        <div className="stat"><b>🔥 {streak}</b> day streak</div>
      </div>
      {due > 0 && <Link to="/review"><button style={{ width: '100%' }}>Start review</button></Link>}
      <div className="calendar">
        {Array.from({ length: Number(today.slice(8, 10)) }, (_, i) => {
          const d = `${today.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
          return <span key={d} className={`day ${completed.includes(d) ? 'done' : ''}`}>{i + 1}</span>
        })}
      </div>

      <nav className="nav">
        <Link to="/review">Review</Link>
        <Link to="/cards">Cards ({total})</Link>
        <a href="/export/csv" download>Export CSV</a>
        <a href="/export/json" download>Backup JSON</a>
      </nav>
    </main>
  )
}
