import type { Route } from './+types/export'
import { requireAuth } from '../lib/session'
import { createDb, listCards, completedDays } from '../db/repo'
import { reviewLog } from '../db/schema'
import { toCsv } from '../lib/csv'

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const cards = await listCards(db)

  if (params.format === 'csv') {
    const rows = [
      ['word', 'word_pl', 'explanation_en', 'sentence_en', 'sentence_pl'],
      ...cards
        .filter((c) => c.status === 'ready')
        .map((c) => [c.word, c.wordPl ?? '', c.explanationEn ?? '', c.sentenceEn ?? '', c.sentencePl ?? '']),
    ]
    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ai-cards.csv"',
      },
    })
  }

  if (params.format === 'json') {
    const body = {
      exportedAt: new Date().toISOString(),
      cards,
      reviewLog: await db.select().from(reviewLog),
      completedDays: await completedDays(db),
    }
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="ai-cards-backup.json"',
      },
    })
  }

  throw new Response('Not found', { status: 404 })
}
