import type { Route } from './+types/review-check'
import { requireAuth } from '../lib/session'
import { createDb, getCard } from '../db/repo'
import { aiFromEnv } from '../lib/openrouter'
import type { AnswerEvaluation } from '../lib/ai'
import { hasCredits, usageRecorder } from '../lib/credits'
import { MAX_TEXT_CHARS } from '../lib/limits'

export type CheckResult = { ok: true; evaluation: AnswerEvaluation } | { ok: false; reason?: 'no-credits' }

const json = (body: CheckResult, status = 200) => Response.json(body, { status })

// Called with plain fetch (not a fetcher) so a network failure lands in the
// caller's catch → local-diff fallback, and the /review loader isn't revalidated.
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const form = await request.formData()
  const typed = String(form.get('typed') ?? '').trim()
  if (!typed || typed.length > MAX_TEXT_CHARS) return json({ ok: false }, 400)
  const db = createDb(env.DB)
  const card = await getCard(db, userId, Number(form.get('cardId')))
  if (!card || card.status !== 'ready' || !card.sentencePl || !card.sentenceEn) return json({ ok: false }, 404)
  if (!(await hasCredits(db, userId))) return json({ ok: false, reason: 'no-credits' })
  try {
    const evaluation = await aiFromEnv(env, usageRecorder(db, userId)).evaluateAnswer({
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
