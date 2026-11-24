import { Form, Link, useNavigation } from 'react-router'
import { useState } from 'react'
import type { Route } from './+types/learn'
import { requireAuth } from '../lib/session'
import { completeFirstLearning, createDb, getNewCards } from '../db/repo'
import type { DecodePart } from '../lib/ai'
import { headwordPairIndices } from '../lib/headword'
import { useT } from '../lib/i18n'
import { Icon } from '../ui/icons'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const cards = await getNewCards(createDb(env.DB), userId)
  return { card: cards[0] ?? null, remaining: cards.length }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const form = await request.formData()
  if (form.get('intent') !== 'complete') return { ok: false as const }
  const ok = await completeFirstLearning(createDb(env.DB), userId, Number(form.get('cardId')), Date.now())
  return { ok }
}

// `headword` marks the pair that holds the card's word.
function Decode({ parts, headword }: { parts: DecodePart[]; headword?: string }) {
  const heads = headwordPairIndices(parts.map((part) => part.en), headword)
  return (
    <div className="decode-grid">
      {parts.map((part, index) => (
        <div className={heads.has(index) ? 'decode-pair decode-head' : 'decode-pair'} key={`${index}-${part.en}`}>
          <span lang="en" className="study">{part.en}</span>
          <span lang="pl">{part.pl}</span>
        </div>
      ))}
    </div>
  )
}

function LearningCard({ card, remaining, failed }: {
  card: NonNullable<Route.ComponentProps['loaderData']['card']>
  remaining: number
  failed: boolean
}) {
  const t = useT().learn
  const [step, setStep] = useState(0)
  const [understood, setUnderstood] = useState(() => new Set<number>())
  const [hintsShown, setHintsShown] = useState(() => new Set<number>())
  const [showExplanation, setShowExplanation] = useState(false)
  const [spoken, setSpoken] = useState(false)
  const navigation = useNavigation()
  const parts = card.decodeParts ?? []
  const allUnderstood = understood.size === parts.length

  const toggleUnderstood = (index: number) => {
    setUnderstood((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleHint = (index: number) => {
    setHintsShown((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const backLabel = step === 1 ? t.backToDecode : step === 2 ? t.backToListen : t.backToUnderstanding
  const total = t.steps.length

  return (
    <>
      <header className="task-head">
        <Link to="/" aria-label={t.back}><Icon name="back" /></Link>
        <div
          className="task-progress"
          role="progressbar"
          aria-label={t.progress}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={step + 1}
          aria-valuetext={t.step(step + 1, total, t.steps[step])}
        >
          <span style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
        <span className="muted">{`${step + 1} / ${total}`}</span>
      </header>
      <div className="task-intro">
        <p className="section-label">{t.steps[step]}</p>
        <h1 className="task-word">{card.word} {t.remaining(remaining)}</h1>
      </div>
      {failed && <p className="error">{t.completeFailed}</p>}

      <p className="study answer task-sentence" lang="en">{card.sentenceEn}</p>

      {step === 0 && (
        <>
          <p className="muted">{t.decodeHint}</p>
          <Decode parts={parts} headword={card.word} />
          <div className="surface-card">
            <p className="section-label">{t.naturalPolish}</p>
            <p className="study" lang="pl">{card.sentencePl}</p>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <p className="muted">{t.listenHint}</p>
          {card.audioKey
            ? <audio controls autoPlay src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />
            : <p className="pending">{t.noAudio}</p>}
          <Decode parts={parts} headword={card.word} />
        </>
      )}

      {step === 2 && (
        <>
          <p className="muted">{t.confirmHint}</p>
          <div className="understanding-list">
            {parts.map((part, index) => (
              <div className="understanding-item" key={`${index}-${part.en}`}>
                <div className="understanding-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={understood.has(index)}
                      onChange={() => toggleUnderstood(index)}
                    />
                    <span lang="en" className="study">{part.en}</span>
                  </label>
                  <button
                    type="button"
                    className="hint-button"
                    aria-expanded={hintsShown.has(index)}
                    onClick={() => toggleHint(index)}
                  >
                    {hintsShown.has(index) ? t.hidePolish : t.showPolish}
                  </button>
                </div>
                {hintsShown.has(index) && <p className="word-hint" lang="pl">{part.pl}</p>}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="explanation-toggle"
            aria-expanded={showExplanation}
            onClick={() => setShowExplanation((shown) => !shown)}
          >
            {showExplanation ? t.hideExplanation : t.moreExplanation}
          </button>
          {showExplanation && (
            <div className="surface-card explanation-help">
              <p><b>{card.word}</b> = {card.wordPl}</p>
              <p>{card.explanationEn}</p>
              <Decode parts={parts} headword={card.word} />
              <p className="section-label">{t.naturalPolish}</p>
              <p className="study" lang="pl">{card.sentencePl}</p>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <p className="muted">{t.speakHint}</p>
          {card.audioKey
            ? <audio controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />
            : <p className="pending">{t.readAloudOnce}</p>}
          <label className="spoken-check">
            <input type="checkbox" checked={spoken} onChange={(event) => setSpoken(event.target.checked)} />
            {t.spokeAlong}
          </label>
        </>
      )}

      <div className="bottom-actions learning-actions">
        {step > 0 && (
          <button type="button" className="secondary-button" onClick={() => setStep((current) => current - 1)}>
            {backLabel}
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            className="primary-wide"
            disabled={step === 2 && !allUnderstood}
            onClick={() => setStep((current) => current + 1)}
          >
            {step === 0 ? t.seeStructure : step === 1 ? t.understandWithHelp : t.understandNow}
          </button>
        ) : (
          <Form method="post" className="finish-form">
            <input type="hidden" name="intent" value="complete" />
            <input type="hidden" name="cardId" value={card.id} />
            <button type="submit" className="primary-wide" disabled={!spoken || navigation.state !== 'idle'}>
              {t.finish}
            </button>
          </Form>
        )}
      </div>
    </>
  )
}

export default function Learn({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT().learn
  if (!loaderData.card) {
    return (
      <main className="page task-screen">
        <header className="task-head">
          <Link to="/" aria-label={t.back}><Icon name="back" /></Link>
          <h1>{t.title}</h1>
        </header>
        <div className="task-done">
          <Icon name="check" />
          <div>
            <p>{t.allLearned}</p>
            <Link to="/" className="task-done-link">{t.back}</Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page task-screen">
      <LearningCard
        key={loaderData.card.id}
        card={loaderData.card}
        remaining={loaderData.remaining}
        failed={actionData?.ok === false}
      />
    </main>
  )
}
