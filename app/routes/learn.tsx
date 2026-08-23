import { Form, Link, useNavigation } from 'react-router'
import { useState } from 'react'
import type { Route } from './+types/learn'
import { requireAuth } from '../lib/session'
import { completeFirstLearning, createDb, getNewCards } from '../db/repo'
import type { DecodePart } from '../lib/ai'

const STEPS = ['Decode', 'Listen & understand', 'Without help', 'Speak once']

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const cards = await getNewCards(createDb(env.DB))
  return { card: cards[0] ?? null, remaining: cards.length }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  if (form.get('intent') !== 'complete') return { ok: false as const }
  const ok = await completeFirstLearning(createDb(env.DB), Number(form.get('cardId')), Date.now())
  return { ok }
}

function Decode({ parts }: { parts: DecodePart[] }) {
  return (
    <div className="decode-grid">
      {parts.map((part, index) => (
        <div className="decode-pair" key={`${index}-${part.en}`}>
          <span lang="en">{part.en}</span>
          <span lang="pl">{part.pl}</span>
        </div>
      ))}
    </div>
  )
}

function LearningCard({ card }: { card: NonNullable<Route.ComponentProps['loaderData']['card']> }) {
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

  const backLabel = step === 1 ? 'Back to decode' : step === 2 ? 'Back to listen' : 'Back to understanding'

  return (
    <>
      <p className="step-progress">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
      <div className="card-face learning-card">
        <p className="answer" lang="en">{card.sentenceEn}</p>

        {step === 0 && (
          <>
            <p>Read from left to right. The Polish line stays deliberately literal.</p>
            <Decode parts={parts} />
            <p className="muted">Natural Polish: {card.sentencePl}</p>
          </>
        )}

        {step === 1 && (
          <>
            <p>Replay the sentence until you can follow its meaning.</p>
            {card.audioKey
              ? <audio controls autoPlay src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />
              : <p className="pending">Audio is unavailable — read the sentence aloud instead.</p>}
            <Decode parts={parts} />
          </>
        )}

        {step === 2 && (
          <>
            <p>Confirm each word or expression. If one is unclear, reveal only that hint or return to listening.</p>
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
                      <span lang="en">{part.en}</span>
                    </label>
                    <button
                      type="button"
                      className="hint-button"
                      aria-expanded={hintsShown.has(index)}
                      onClick={() => toggleHint(index)}
                    >
                      {hintsShown.has(index) ? 'Hide Polish' : 'Show Polish'}
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
              {showExplanation ? 'Hide extra explanation' : 'I still need more explanation'}
            </button>
            {showExplanation && (
              <div className="explanation-help">
                <p><b>{card.word}</b> = {card.wordPl}</p>
                <p>{card.explanationEn}</p>
                <Decode parts={parts} />
                <p className="muted">Natural Polish: {card.sentencePl}</p>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <p>Play it once or twice and speak together with the recording.</p>
            {card.audioKey
              ? <audio controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />
              : <p className="pending">Read the sentence aloud once.</p>}
            <label className="spoken-check">
              <input type="checkbox" checked={spoken} onChange={(event) => setSpoken(event.target.checked)} />
              I spoke along once
            </label>
          </>
        )}
      </div>

      <div className="learning-actions">
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
            {step === 0 ? 'I see the structure' : step === 1 ? 'I understand with help' : 'I understand now'}
          </button>
        ) : (
          <Form method="post" className="finish-form">
            <input type="hidden" name="intent" value="complete" />
            <input type="hidden" name="cardId" value={card.id} />
            <button type="submit" className="primary-wide" disabled={!spoken || navigation.state !== 'idle'}>
              Finish · review tomorrow
            </button>
          </Form>
        )}
      </div>
    </>
  )
}

export default function Learn({ loaderData, actionData }: Route.ComponentProps) {
  if (!loaderData.card) {
    return (
      <main className="page">
        <h1><Link to="/">←</Link> New to learn</h1>
        <p className="ok">First learning complete. Your new cards will return tomorrow.</p>
      </main>
    )
  }

  return (
    <main className="page">
      <h1><Link to="/">←</Link> {loaderData.card.word} <span className="muted">({loaderData.remaining} new)</span></h1>
      {actionData?.ok === false && <p className="error">This card could not be completed. Reload and try again.</p>}
      <LearningCard key={loaderData.card.id} card={loaderData.card} />
    </main>
  )
}
