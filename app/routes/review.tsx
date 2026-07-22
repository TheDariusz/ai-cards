import { Link, useFetcher, useSearchParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import type { Route } from './+types/review'
import { requireAuth } from '../lib/session'
import { createDb, getDueCards, applyReview } from '../db/repo'
import { diffAnswer, type DiffResult } from '../lib/diff'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const due = await getDueCards(createDb(env.DB), Date.now())
  return { due }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const grade = String(form.get('grade'))
  const mode = form.get('mode') === 'write' ? 'write' : 'flip'
  if (grade !== 'again' && grade !== 'good' && grade !== 'easy') return { ok: false as const }
  try {
    await applyReview(
      createDb(env.DB),
      Number(form.get('cardId')),
      grade,
      mode,
      form.get('typed') ? String(form.get('typed')) : null,
      Date.now(),
    )
    return { ok: true as const }
  } catch (err) {
    console.error('review submission failed:', err)
    return { ok: false as const }
  }
}

// useFetcher (not a navigating Form) so a network failure keeps the revealed card
// on screen — the grade is "held in memory" (spec) and the user just taps again.
function GradeButtons({ cardId, mode, typed }: { cardId: number; mode: string; typed?: string }) {
  const fetcher = useFetcher<typeof action>()
  const failed = fetcher.state === 'idle' && fetcher.data?.ok === false
  return (
    <fetcher.Form method="post" className="grades">
      <input type="hidden" name="cardId" value={cardId} />
      <input type="hidden" name="mode" value={mode} />
      {typed !== undefined && <input type="hidden" name="typed" value={typed} />}
      <button name="grade" value="again" className="grade-again" disabled={fetcher.state !== 'idle'}>Again</button>
      <button name="grade" value="good" disabled={fetcher.state !== 'idle'}>Good</button>
      <button name="grade" value="easy" className="grade-easy" disabled={fetcher.state !== 'idle'}>Easy</button>
      {failed && <p className="error">Didn’t reach the server — tap your grade again.</p>}
    </fetcher.Form>
  )
}

function FlipCard({ card }: { card: Route.ComponentProps['loaderData']['due'][number] }) {
  const [revealed, setRevealed] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (revealed) audioRef.current?.play().catch(() => {}) // autoplay may need a tap on iOS
  }, [revealed])

  return (
    <>
      <div className="card-face"><p lang="pl">{card.sentencePl}</p></div>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <div className="card-face">
            <p lang="en"><b>{card.sentenceEn}</b></p>
            <p className="muted">{card.word} = {card.wordPl} — {card.explanationEn}</p>
            {card.audioKey && <audio ref={audioRef} controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />}
          </div>
          <GradeButtons cardId={card.id} mode="flip" />
        </>
      )}
    </>
  )
}

function WriteCard({ card }: { card: Route.ComponentProps['loaderData']['due'][number] }) {
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<DiffResult | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (result) audioRef.current?.play().catch(() => {})
  }, [result])

  const check = () => setResult(diffAnswer(card.sentenceEn ?? '', typed, card.word))

  return (
    <>
      <div className="card-face"><p lang="pl">{card.sentencePl}</p></div>
      {!result ? (
        <form onSubmit={(e) => { e.preventDefault(); check() }}>
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Write the English sentence…"
            autoFocus
            rows={3}
          />
          <button type="submit">Check</button>
        </form>
      ) : (
        <>
          <div className="card-face">
            <p>
              {result.tokens.map((t, i) => (
                <span key={i} className={`diff-${t.kind}${t.head ? ' diff-head' : ''}`}>{t.text} </span>
              ))}
            </p>
            <p lang="en"><b>{card.sentenceEn}</b></p>
            <p className="muted">
              {Math.round(result.score * 100)}% — suggested: <b>{result.suggestedGrade}</b>
            </p>
            {result.headword === 'missing' && <p className="error">Main word missing: <b>{card.word}</b></p>}
            {result.headword === 'typo' && <p className="muted">Main word had a typo.</p>}
            {card.audioKey && <audio ref={audioRef} controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />}
          </div>
          <GradeButtons cardId={card.id} mode="write" typed={typed} />
        </>
      )}
    </>
  )
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'write' ? 'write' : 'flip'
  const card = loaderData.due[0] // action revalidates the loader → next card appears

  if (!card) {
    return (
      <main className="page">
        <h1><Link to="/">←</Link> Review</h1>
        <p className="ok">All done for today 🎉</p>
      </main>
    )
  }

  return (
    <main className="page">
      <h1><Link to="/">←</Link> Review <span className="muted">({loaderData.due.length} left)</span></h1>
      <button
        className="muted-toggle"
        onClick={() => setParams({ mode: mode === 'flip' ? 'write' : 'flip' })}
      >
        Mode: {mode === 'flip' ? 'Flip' : 'Write it'}
      </button>
      {mode === 'flip'
        ? <FlipCard key={card.id} card={card} />
        : <WriteCard key={card.id} card={card} />}
    </main>
  )
}

export function ErrorBoundary() {
  return (
    <main className="page">
      <p className="error">Something went wrong submitting your review.</p>
      <a href="/review">Back to review</a>
    </main>
  )
}
