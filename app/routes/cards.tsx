import { Link } from 'react-router'
import type { Route } from './+types/cards'
import { requireAuth } from '../lib/session'
import { createDb, listCards } from '../db/repo'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { cards: await listCards(createDb(env.DB)) }
}

export default function Cards({ loaderData }: Route.ComponentProps) {
  return (
    <main className="page">
      <h1><Link to="/">←</Link> Cards</h1>
      {loaderData.cards.map((c) => (
        <Link key={c.id} to={`/cards/${c.id}`} className="card-row">
          <b>{c.word}</b> {c.status !== 'ready' && <em className="muted">({c.status})</em>}
          <br />
          <span className="muted">{c.sentenceEn ?? '…'}</span>
        </Link>
      ))}
    </main>
  )
}
