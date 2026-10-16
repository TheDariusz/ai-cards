import { Form, Link, redirect, useNavigation } from 'react-router'
import type { Route } from './+types/card-detail'
import { requireAuth } from '../lib/session'
import { createDb, getCard, updateCardContent, deleteCard, setAudioKey } from '../db/repo'
import { runCardPipeline, generateAudio } from '../lib/pipeline'
import { aiFromEnv } from '../lib/openrouter'
import { decodePartsFromText, decodePartsToText } from '../lib/ai'
import { hasCredits, usageRecorder } from '../lib/credits'
import { parseLocale } from '../lib/locale'
import { dict, useT } from '../lib/i18n'
import { MAX_TEXT_CHARS, MAX_WORD_CHARS } from '../lib/limits'

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const card = await getCard(createDb(env.DB), userId, Number(params.id))
  if (!card) throw new Response('Not found', { status: 404 })
  return { card, outOfCredits: !(await hasCredits(createDb(env.DB), userId)) }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const id = Number(params.id)
  const card = await getCard(db, userId, id)
  if (!card) throw new Response('Not found', { status: 404 })
  const form = await request.formData()
  const intent = form.get('intent')
  const t = dict[parseLocale(request.headers.get('Cookie'))]
  const ai = aiFromEnv(env, usageRecorder(db, userId))

  if (intent === 'delete') {
    await deleteCard(db, userId, id)
    if (card.audioKey) context.cloudflare.ctx.waitUntil(env.AUDIO.delete(card.audioKey).catch(() => {}))
    return redirect('/cards')
  }

  if ((intent === 'regenerate' || intent === 'retry-audio') && !(await hasCredits(db, userId))) {
    return { error: t.common.noCredits }
  }

  if (intent === 'regenerate') {
    const hint = String(form.get('hint') ?? '').trim() || undefined
    if (hint && hint.length > MAX_TEXT_CHARS) return { error: t.card.hintTooLong(MAX_TEXT_CHARS) }
    await runCardPipeline({ db, ai, audio: env.AUDIO }, userId, id, card.word, hint)
    return { regenerated: true }
  }

  if (intent === 'retry-audio') {
    // spec: TTS-only failure leaves a usable text-only card with a "generate audio" retry
    if (card.sentenceEn) {
      const sentenceEn = card.sentenceEn
      try {
        const newKey = await generateAudio({ ai, audio: env.AUDIO }, id, sentenceEn)
        if (card.audioKey && card.audioKey !== newKey) await env.AUDIO.delete(card.audioKey).catch(() => {})
        await setAudioKey(db, userId, id, newKey) // a text-only card gains audio here
      } catch (err) {
        console.error(`audio refresh failed for card ${id}:`, err)
        return { audioRetried: false }
      }
    }
    return { audioRetried: true }
  }

  if (intent === 'save') {
    const sentenceEn = String(form.get('sentenceEn') ?? '')
    let decodeParts
    try {
      decodeParts = decodePartsFromText(String(form.get('decodeParts') ?? ''), sentenceEn)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : t.card.invalidDecode }
    }
    if (card.firstLearnedAt === null && !decodeParts) {
      return { saved: false, error: t.card.needsDecode }
    }
    const content = {
      wordPl: String(form.get('wordPl') ?? ''),
      explanationEn: String(form.get('explanationEn') ?? ''),
      sentenceEn,
      sentencePl: String(form.get('sentencePl') ?? ''),
      decodeParts,
    }
    // saved text is replayed into later LLM and TTS calls (answer check, audio), so cap it here
    if (
      content.wordPl.length > MAX_WORD_CHARS ||
      [content.explanationEn, content.sentenceEn, content.sentencePl].some((s) => s.length > MAX_TEXT_CHARS)
    ) {
      return { saved: false, error: t.card.textTooLong(MAX_WORD_CHARS, MAX_TEXT_CHARS) }
    }
    await updateCardContent(db, userId, id, content)
    const sentenceChanged = content.sentenceEn !== card.sentenceEn
    if (sentenceChanged && !(await hasCredits(db, userId))) {
      // no credits for new audio; the old one no longer matches, so the card becomes text-only
      if (card.audioKey) {
        await setAudioKey(db, userId, id, null)
        context.cloudflare.ctx.waitUntil(env.AUDIO.delete(card.audioKey).catch(() => {}))
      }
    } else if (sentenceChanged) {
      // sentence changed → regenerate audio to match (content is already saved)
      context.cloudflare.ctx.waitUntil(
        (async () => {
          const newKey = await generateAudio({ ai, audio: env.AUDIO }, id, content.sentenceEn)
          if (card.audioKey && card.audioKey !== newKey) await env.AUDIO.delete(card.audioKey).catch(() => {})
          await setAudioKey(db, userId, id, newKey)
        })().catch(async (err) => {
          console.error(`audio refresh failed for card ${id}:`, err)
          // TTS failed for the new sentence — the old audio (if any) no longer
          // matches, so clear it and fall back to a text-only card with retry.
          if (card.audioKey) {
            await env.AUDIO.delete(card.audioKey).catch(() => {})
            await setAudioKey(db, userId, id, null)
          }
        }),
      )
    }
    // spec: "offers to re-translate" — surface a sync hint when EN changed but PL didn't
    const staleTranslation = sentenceChanged && content.sentencePl === card.sentencePl
    return { saved: true, staleTranslation }
  }
  return null
}

export default function CardDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { card, outOfCredits } = loaderData
  const nav = useNavigation()
  const busy = nav.state !== 'idle'
  const t = useT()
  // Remount the edit form when the editable content changes (e.g. after
  // Regenerate) so its uncontrolled defaultValue inputs re-read fresh values.
  // audioKey is deliberately excluded: a background audio refresh after Save
  // must not remount the form and wipe in-progress typing.
  const contentKey = [card.wordPl, card.explanationEn, card.sentenceEn, card.sentencePl, JSON.stringify(card.decodeParts)].join('|')
  return (
    <main className="page">
      <h1><Link to="/cards">←</Link> {card.word}</h1>
      {card.audioKey ? (
        <audio controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey ?? '')}`} />
      ) : card.status === 'ready' && outOfCredits ? (
        <p className="muted">{t.card.noAudio} {t.common.noCredits}</p>
      ) : card.status === 'ready' ? (
        <Form method="post">
          <input type="hidden" name="intent" value="retry-audio" />
          <button type="submit" disabled={busy}>{t.card.generateAudio}</button>
          {busy && <span className="pending"> ⏳</span>}
        </Form>
      ) : null}

      <Form method="post" key={contentKey}>
        <input type="hidden" name="intent" value="save" />
        <label>{t.card.polishWord} <input name="wordPl" maxLength={MAX_WORD_CHARS} defaultValue={card.wordPl ?? ''} /></label>
        <label>{t.card.explanation} <textarea name="explanationEn" maxLength={MAX_TEXT_CHARS} defaultValue={card.explanationEn ?? ''} /></label>
        <label>{t.card.englishSentence} <textarea name="sentenceEn" className="study" maxLength={MAX_TEXT_CHARS} defaultValue={card.sentenceEn ?? ''} /></label>
        <label>{t.card.polishSentence} <textarea name="sentencePl" className="study" maxLength={MAX_TEXT_CHARS} defaultValue={card.sentencePl ?? ''} /></label>
        <label>
          {t.card.literalDecode} <span className="muted">{t.card.decodeFormat}</span>
          <textarea name="decodeParts" rows={5} defaultValue={decodePartsToText(card.decodeParts)} />
        </label>
        <button type="submit">{t.card.save}</button>
        {actionData && 'saved' in actionData && actionData.saved && <span className="ok"> {t.card.saved}</span>}
        {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}
        {actionData && 'staleTranslation' in actionData && actionData.staleTranslation && (
          <p className="pending">{t.card.staleTranslation}</p>
        )}
      </Form>

      {!outOfCredits && (
        <Form method="post" className="quick-add">
          <input type="hidden" name="intent" value="regenerate" />
          <input name="hint" maxLength={MAX_TEXT_CHARS} placeholder={t.card.hintPlaceholder} />
          <button type="submit" disabled={busy}>{t.card.regenerate}</button>
          {busy && <span className="pending"> ⏳</span>}
        </Form>
      )}

      <Form
        method="post"
        onSubmit={(e) => { if (!confirm(t.card.deleteConfirm)) e.preventDefault() }}
      >
        <input type="hidden" name="intent" value="delete" />
        <button type="submit" className="danger-button">{t.card.delete}</button>
      </Form>
    </main>
  )
}
