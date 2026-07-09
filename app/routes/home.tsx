import { Form, Link, useRevalidator } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { requireAuth } from '../lib/session'
import { createDb, insertPendingCard, getCard, listCards } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { aiFromEnv } from '../lib/openrouter'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const all = await listCards(db)
  return {
    pending: all.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, word: c.word })),
    failed: all.filter((c) => c.status === 'failed').map((c) => ({ id: c.id, word: c.word })),
    total: all.length,
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
  const { pending, failed, total } = loaderData
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

      <nav className="nav">
        <Link to="/review">Review</Link>
        <Link to="/cards">Cards ({total})</Link>
      </nav>
    </main>
  )
}
