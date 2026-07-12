import { Form, Link, redirect, useNavigation } from 'react-router'
import type { Route } from './+types/card-detail'
import { requireAuth } from '../lib/session'
import { createDb, getCard, updateCardContent, deleteCard, setAudioKey } from '../db/repo'
import { runCardPipeline, generateAudio } from '../lib/pipeline'
import { aiFromEnv } from '../lib/openrouter'

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const card = await getCard(createDb(env.DB), Number(params.id))
  if (!card) throw new Response('Not found', { status: 404 })
  return { card }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const id = Number(params.id)
  const card = await getCard(db, id)
  if (!card) throw new Response('Not found', { status: 404 })
  const form = await request.formData()
  const intent = form.get('intent')

  if (intent === 'delete') {
    await deleteCard(db, id)
    if (card.audioKey) context.cloudflare.ctx.waitUntil(env.AUDIO.delete(card.audioKey).catch(() => {}))
    return redirect('/cards')
  }

  if (intent === 'regenerate') {
    const hint = String(form.get('hint') ?? '').trim() || undefined
    await runCardPipeline({ db, ai: aiFromEnv(env), audio: env.AUDIO }, id, card.word, hint)
    return { regenerated: true }
  }

  if (intent === 'retry-audio') {
    // spec: TTS-only failure leaves a usable text-only card with a "generate audio" retry
    if (card.sentenceEn) {
      const sentenceEn = card.sentenceEn
      try {
        const newKey = await generateAudio({ ai: aiFromEnv(env), audio: env.AUDIO }, id, sentenceEn)
        if (card.audioKey && card.audioKey !== newKey) await env.AUDIO.delete(card.audioKey).catch(() => {})
        await setAudioKey(db, id, newKey) // a text-only card gains audio here
      } catch (err) {
        console.error(`audio refresh failed for card ${id}:`, err)
        return { audioRetried: false }
      }
    }
    return { audioRetried: true }
  }

  if (intent === 'save') {
    const content = {
      wordPl: String(form.get('wordPl') ?? ''),
      explanationEn: String(form.get('explanationEn') ?? ''),
      sentenceEn: String(form.get('sentenceEn') ?? ''),
      sentencePl: String(form.get('sentencePl') ?? ''),
    }
    await updateCardContent(db, id, content)
    const sentenceChanged = content.sentenceEn !== card.sentenceEn
    if (sentenceChanged) {
      // sentence changed → regenerate audio to match (content is already saved)
      context.cloudflare.ctx.waitUntil(
        (async () => {
          const newKey = await generateAudio({ ai: aiFromEnv(env), audio: env.AUDIO }, id, content.sentenceEn)
          if (card.audioKey && card.audioKey !== newKey) await env.AUDIO.delete(card.audioKey).catch(() => {})
          await setAudioKey(db, id, newKey)
        })().catch(async (err) => {
          console.error(`audio refresh failed for card ${id}:`, err)
          // TTS failed for the new sentence — the old audio (if any) no longer
          // matches, so clear it and fall back to a text-only card with retry.
          if (card.audioKey) {
            await env.AUDIO.delete(card.audioKey).catch(() => {})
            await setAudioKey(db, id, null)
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
  const { card } = loaderData
  const nav = useNavigation()
  const busy = nav.state !== 'idle'
  // Remount the edit form when the editable content changes (e.g. after
  // Regenerate) so its uncontrolled defaultValue inputs re-read fresh values.
  // audioKey is deliberately excluded: a background audio refresh after Save
  // must not remount the form and wipe in-progress typing.
  const contentKey = [card.wordPl, card.explanationEn, card.sentenceEn, card.sentencePl].join('|')
  return (
    <main className="page">
      <h1><Link to="/cards">←</Link> {card.word}</h1>
      {card.audioKey ? (
        <audio controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey ?? '')}`} />
      ) : card.status === 'ready' ? (
        <Form method="post">
          <input type="hidden" name="intent" value="retry-audio" />
          <button type="submit" disabled={busy}>Generate audio</button>
          {busy && <span className="pending"> ⏳</span>}
        </Form>
      ) : null}

      <Form method="post" key={contentKey}>
        <input type="hidden" name="intent" value="save" />
        <label>Polish word <input name="wordPl" defaultValue={card.wordPl ?? ''} /></label>
        <label>Explanation <textarea name="explanationEn" defaultValue={card.explanationEn ?? ''} /></label>
        <label>English sentence <textarea name="sentenceEn" defaultValue={card.sentenceEn ?? ''} /></label>
        <label>Polish sentence <textarea name="sentencePl" defaultValue={card.sentencePl ?? ''} /></label>
        <button type="submit">Save</button>
        {actionData && 'saved' in actionData && <span className="ok"> Saved ✓</span>}
        {actionData && 'staleTranslation' in actionData && actionData.staleTranslation && (
          <p className="pending">English sentence changed — update the Polish translation too, or tap Regenerate.</p>
        )}
      </Form>

      <Form method="post" className="quick-add">
        <input type="hidden" name="intent" value="regenerate" />
        <input name="hint" placeholder="Hint (optional): e.g. business context" />
        <button type="submit" disabled={busy}>Regenerate</button>
        {busy && <span className="pending"> ⏳</span>}
      </Form>

      <Form
        method="post"
        onSubmit={(e) => { if (!confirm('Delete this card?')) e.preventDefault() }}
      >
        <input type="hidden" name="intent" value="delete" />
        <button type="submit" className="grade-again">Delete</button>
      </Form>
    </main>
  )
}
