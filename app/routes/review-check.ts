import { data } from 'react-router'
import type { Route } from './+types/review-check'
import { requireAuth } from '../lib/session'
import { createDb, getCard } from '../db/repo'
import { aiFromEnv } from '../lib/openrouter'

// Failures are returned, never thrown: a thrown response from a fetcher action
// renders the ErrorBoundary instead of the local-diff fallback.
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const typed = String(form.get('typed') ?? '').trim()
  if (!typed) return data({ ok: false as const }, { status: 400 })
  const card = await getCard(createDb(env.DB), Number(form.get('cardId')))
  if (!card || card.status !== 'ready' || !card.sentencePl || !card.sentenceEn) {
    return data({ ok: false as const }, { status: 404 })
  }
  try {
    const evaluation = await aiFromEnv(env).evaluateAnswer({
      word: card.word,
      wordPl: card.wordPl,
      sentencePl: card.sentencePl,
      sentenceEn: card.sentenceEn,
      typed,
    })
    return { ok: true as const, evaluation }
  } catch (err) {
    console.error('answer evaluation failed:', err)
    return { ok: false as const }
  }
}
