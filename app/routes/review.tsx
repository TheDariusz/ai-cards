import { Link, useFetcher, useSearchParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import type { Route } from './+types/review'
import { requireAuth } from '../lib/session'
import { createDb, getDueCards, applyReview, completedDays, countReviewsOn } from '../db/repo'
import { diffAnswer, type DiffResult, type HeadwordStatus } from '../lib/diff'
import { headwordInAnswer, suggestGrade } from '../lib/evaluate'
import { highlightHeadword } from '../lib/headword'
import type { Grade } from '../lib/srs'
import { computeStreak, dayKey } from '../lib/streak'
import type { CheckResult } from './review-check'

const KEY_TO_GRADE: Record<string, 'again' | 'good' | 'easy'> = { '1': 'again', '2': 'good', '3': 'easy' }

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const now = Date.now()
  const today = dayKey(now)
  return {
    due: await getDueCards(db, userId, now),
    streak: computeStreak(await completedDays(db, userId), today),
    doneToday: await countReviewsOn(db, userId, today),
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const form = await request.formData()
  const grade = String(form.get('grade'))
  const mode = form.get('mode') === 'write' ? 'write' : 'flip'
  if (grade !== 'again' && grade !== 'good' && grade !== 'easy') return { ok: false as const }
  try {
    await applyReview(
      createDb(env.DB),
      userId,
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

function Sentence({ text, headword, lang, bold }: {
  text: string | null
  headword: string | null
  lang: string
  bold?: boolean
}) {
  if (!text) return null
  return (
    <p lang={lang} className={bold ? 'study answer' : 'study'}>
      {highlightHeadword(text, headword).map((s, i) =>
        s.head ? <b className="head" key={i}>{s.text}</b> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}

// useFetcher (not a navigating Form) so a network failure keeps the revealed card
// on screen — the grade is "held in memory" (spec) and the user just taps again.
function GradeButtons({ cardId, mode, typed, suggested }: { cardId: number; mode: string; typed?: string; suggested?: Grade }) {
  const fetcher = useFetcher<typeof action>()
  const failed = fetcher.state === 'idle' && fetcher.data?.ok === false
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const grade = KEY_TO_GRADE[e.key]
      if (!grade) return
      const el = e.target
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (fetcher.state !== 'idle') return
      e.preventDefault()
      fetcher.submit(
        { cardId: String(cardId), mode, grade, ...(typed !== undefined ? { typed } : {}) },
        { method: 'post' },
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fetcher, cardId, mode, typed])
  return (
    <fetcher.Form method="post" className="grades">
      <input type="hidden" name="cardId" value={cardId} />
      <input type="hidden" name="mode" value={mode} />
      {typed !== undefined && <input type="hidden" name="typed" value={typed} />}
      {(['again', 'good', 'easy'] as const).map((grade, i) => (
        <button
          key={grade}
          name="grade"
          value={grade}
          className={grade === suggested ? 'grade-suggested' : undefined}
          disabled={fetcher.state !== 'idle'}
        >
          {grade[0].toUpperCase() + grade.slice(1)} <kbd>{i + 1}</kbd>
        </button>
      ))}
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
  useEffect(() => {
    if (revealed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      if (el instanceof HTMLElement && ['BUTTON', 'A', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return
      e.preventDefault() // Space must not scroll the page
      setRevealed(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed])

  return (
    <>
      <div className="card-face"><Sentence text={card.sentencePl} headword={card.wordPl} lang="pl" /></div>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <div className="card-face">
            <Sentence text={card.sentenceEn} headword={card.word} lang="en" bold />
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
  // Computed on Check: instant, and the fallback when AI feedback is unavailable
  const [local, setLocal] = useState<{ diff: DiffResult; headword: HeadwordStatus } | null>(null)
  const [checked, setChecked] = useState<CheckResult | null>(null)
  const done = local !== null && checked !== null
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (done) audioRef.current?.play().catch(() => {})
  }, [done])

  const check = async () => {
    if (!typed.trim() || local) return
    setLocal({
      diff: diffAnswer(card.sentenceEn ?? '', typed, card.word),
      headword: headwordInAnswer(typed, card.word),
    })
    const body = new FormData()
    body.set('cardId', String(card.id))
    body.set('typed', typed)
    try {
      const res = await fetch('/review/check', { method: 'POST', body })
      setChecked(res.ok ? ((await res.json()) as CheckResult) : { ok: false })
    } catch {
      setChecked({ ok: false }) // offline / dropped connection → local diff
    }
  }

  const evaluation = checked?.ok ? checked.evaluation : null
  const suggested: Grade | null = !local
    ? null
    : evaluation
      ? suggestGrade(evaluation.verdict, local.headword)
      : local.headword === 'missing' ? 'again' : local.diff.suggestedGrade

  return (
    <>
      <div className="card-face"><Sentence text={card.sentencePl} headword={card.wordPl} lang="pl" /></div>
      {!local ? (
        <form onSubmit={(e) => { e.preventDefault(); check() }}>
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                check()
              }
            }}
            placeholder="Write the English sentence…"
            autoFocus
            rows={3}
          />
          <button type="submit" disabled={!typed.trim()}>Check</button>
        </form>
      ) : !done ? (
        <div className="card-face">
          <p lang="en" className="typed-answer">{typed}</p>
          <p className="muted">Checking…</p>
        </div>
      ) : (
        <>
          <div className="card-face">
            {evaluation ? (
              <div className="feedback">
                <p lang="en" className="typed-answer">{typed}</p>
                <p lang="pl" className={`verdict verdict-${evaluation.verdict}`}>{evaluation.summaryPl}</p>
                {evaluation.corrected !== typed.trim() && (
                  <Sentence text={evaluation.corrected} headword={card.word} lang="en" />
                )}
                {evaluation.notesPl.length > 0 && (
                  <ul lang="pl" className="feedback-notes">
                    {evaluation.notesPl.map((note, i) => <li key={i}>{note}</li>)}
                  </ul>
                )}
                <p className="alt-label">Another correct version</p>
              </div>
            ) : (
              <p>
                {local.diff.tokens.map((t, i) => (
                  <span key={i} className={`diff-${t.kind}${t.head ? ' diff-head' : ''}`}>{t.text} </span>
                ))}
              </p>
            )}
            <Sentence text={card.sentenceEn} headword={card.word} lang="en" bold />
            <p className="muted">
              {!evaluation && `${Math.round(local.diff.score * 100)}% — `}suggested: <b>{suggested}</b>
            </p>
            {!evaluation && <p className="muted">AI feedback unavailable</p>}
            {local.headword === 'missing' && <p className="error">Main word missing: <b>{card.word}</b></p>}
            {local.headword === 'typo' && <p className="muted">Main word had a typo.</p>}
            {card.audioKey && <audio ref={audioRef} controls src={`/audio/${card.id}?v=${encodeURIComponent(card.audioKey)}`} />}
          </div>
          <GradeButtons cardId={card.id} mode="write" typed={typed} suggested={suggested ?? undefined} />
        </>
      )}
    </>
  )
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'flip' ? 'flip' : 'write'
  const card = loaderData.due[0] // action revalidates the loader → next card appears

  if (!card) {
    return (
      <main className="page">
        <h1><Link to="/">←</Link> Review</h1>
        <p className="ok">All done for today 🎉</p>
      </main>
    )
  }

  const { streak, doneToday } = loaderData
  const left = loaderData.due.length
  // an Again-graded card stays due, so doneToday can grow while left doesn't drop
  const pct = Math.min(100, Math.round((doneToday / (doneToday + left)) * 100))

  return (
    <main className="page">
      <h1 className="review-head">
        <Link to="/">←</Link> Review <span className="muted">· {left} left{streak > 0 ? ` · 🔥 ${streak}` : ''}</span>
      </h1>
      <div
        className="progress"
        role="progressbar"
        aria-label="Today's reviews"
        aria-valuemin={0}
        aria-valuemax={doneToday + left}
        aria-valuenow={doneToday}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
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
