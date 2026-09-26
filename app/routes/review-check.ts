import type { Route } from './+types/review-check'
import { requireAuth } from '../lib/session'
import { createDb, getCard } from '../db/repo'
import { aiFromEnv } from '../lib/openrouter'
import type { AnswerEvaluation } from '../lib/ai'

export type CheckResult = { ok: true; evaluation: AnswerEvaluation } | { ok: false }

const json = (body: CheckResult, status = 200) => Response.json(body, { status })

// Called with plain fetch (not a fetcher) so a network failure lands in the
// caller's catch → local-diff fallback, and the /review loader isn't revalidated.
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const typed = String(form.get('typed') ?? '').trim()
  if (!typed) return json({ ok: false }, 400)
  const card = await getCard(createDb(env.DB), Number(form.get('cardId')))
  if (!card || card.status !== 'ready' || !card.sentencePl || !card.sentenceEn) return json({ ok: false }, 404)
  try {
    const evaluation = await aiFromEnv(env).evaluateAnswer({
      word: card.word,
      wordPl: card.wordPl,
      sentencePl: card.sentencePl,
      sentenceEn: card.sentenceEn,
      typed,
    })
    return json({ ok: true, evaluation })
  } catch (err) {
    console.error('answer evaluation failed:', err)
    return json({ ok: false })
  }
}
