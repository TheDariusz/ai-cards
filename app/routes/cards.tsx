import { Link } from 'react-router'
import type { Route } from './+types/cards'
import { requireAuth } from '../lib/session'
import { createDb, isNewCard, listCards } from '../db/repo'
import { useT } from '../lib/i18n'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const rows = await listCards(createDb(env.DB), userId)
  return {
    cards: rows.map((c) => ({
      id: c.id,
      word: c.word,
      wordPl: c.wordPl,
      sentenceEn: c.sentenceEn,
      tag: (isNewCard(c) ? 'new' : c.status !== 'ready' ? c.status : null) as 'pending' | 'failed' | 'new' | null,
    })),
  }
}

export default function Cards({ loaderData }: Route.ComponentProps) {
  const { cards: t, nav } = useT()
  const { cards } = loaderData
  return (
    <main className="page cards-page">
      <header className="cards-head">
        <h1>{t.title}</h1>
        <span className="muted">{cards.length}</span>
      </header>
      {cards.length === 0 ? (
        <div className="surface-card cards-empty">
          <p className="muted">{t.empty}</p>
          <Link to="/" className="cards-empty-link">{nav.today}</Link>
        </div>
      ) : (
        <div className="surface-card cards-list">
          {cards.map((c) => (
            <Link key={c.id} to={`/cards/${c.id}`} className="card-row">
              <span className="card-row-head">
                <span className="card-row-word">
                  <b>{c.word}</b>
                  {c.wordPl && <span className="muted"> · {c.wordPl}</span>}
                </span>
                {c.tag && <span className="tag" data-tag={c.tag}>{t.tag[c.tag]}</span>}
              </span>
              {c.sentenceEn && <span className="card-row-sentence">{c.sentenceEn}</span>}
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
