import { useFetcher, useSearchParams } from 'react-router'
import { useEffect, useState } from 'react'
import type { Route } from './+types/review'
import { requireAuth } from '../lib/session'
import { createDb, getDueCards, applyReview, countReviewsOn, completedDays } from '../db/repo'
import { diffAnswer, type DiffResult, type HeadwordStatus } from '../lib/diff'
import { headwordInAnswer, suggestGrade } from '../lib/evaluate'
import { highlightHeadword } from '../lib/headword'
import type { Grade } from '../lib/srs'
import { dayKey } from '../lib/streak'
import { finishSummary } from '../lib/today'
import type { CheckResult } from './review-check'
import { MAX_TEXT_CHARS } from '../lib/limits'
import { useT } from '../lib/i18n'
import { ProgressBar } from '../ui/progress-bar'
import { TaskHead } from '../ui/task-head'
import { TaskFinish } from '../ui/task-finish'
import { AudioPlayer } from '../ui/audio-player'

const KEY_TO_GRADE: Record<string, 'again' | 'good' | 'easy'> = { '1': 'again', '2': 'good', '3': 'easy' }

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const now = Date.now()
  const today = dayKey(now)
  const [due, doneToday] = await Promise.all([getDueCards(db, userId, now), countReviewsOn(db, userId, today)])
  // Nothing left: the closing screen reports today's reviews and, once today counts, the streak.
  if (due.length === 0) return { due, doneToday, finish: finishSummary(doneToday, await completedDays(db, userId), today) }
  return { due, doneToday, finish: null }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const form = await request.formData()
  const grade = String(form.get('grade'))
  const mode = form.get('mode') === 'write' ? 'write' : 'flip'
  const cardId = Number(form.get('cardId'))
  if (grade !== 'again' && grade !== 'good' && grade !== 'easy') return { ok: false as const }
  try {
    await applyReview(
      createDb(env.DB),
      userId,
      cardId,
      grade,
      mode,
      form.get('typed') ? String(form.get('typed')) : null,
      Date.now(),
    )
    return { ok: true as const }
  } catch (err) {
    console.error(`review submission failed: ${err}`)
    context.log.error('review submission failed', { user_id: userId, card_id: cardId }, err)
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
  const t = useT().review
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
          {t.grades[grade]} <kbd>{i + 1}</kbd>
        </button>
      ))}
      {failed && <p className="error">{t.gradeFailed}</p>}
    </fetcher.Form>
  )
}

function FlipCard({ card }: { card: Route.ComponentProps['loaderData']['due'][number] }) {
  const t = useT().review
  const [revealed, setRevealed] = useState(false)
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
      <div className="task-prompt">
        <p className="section-label">{t.promptFlip}</p>
        <Sentence text={card.sentencePl} headword={card.wordPl} lang="pl" />
      </div>
      {!revealed ? (
        <div className="bottom-actions">
          <button className="primary-wide" onClick={() => setRevealed(true)}>{t.showAnswer}</button>
        </div>
      ) : (
        <>
          <div className="surface-card">
            <p className="section-label">{t.answer}</p>
            <Sentence text={card.sentenceEn} headword={card.word} lang="en" bold />
            <p className="muted">{card.word} = {card.wordPl} · {card.explanationEn}</p>
            {card.audioKey && <AudioPlayer autoPlay cardId={card.id} audioKey={card.audioKey} />}
          </div>
          <div className="bottom-actions">
            <GradeButtons cardId={card.id} mode="flip" />
          </div>
        </>
      )}
    </>
  )
}

function WriteCard({ card }: { card: Route.ComponentProps['loaderData']['due'][number] }) {
  const t = useT().review
  const [typed, setTyped] = useState('')
  // Computed on Check: instant, and the fallback when AI feedback is unavailable
  const [local, setLocal] = useState<{ diff: DiffResult; headword: HeadwordStatus } | null>(null)
  const [checked, setChecked] = useState<CheckResult | null>(null)
  const done = local !== null && checked !== null

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
      <div className="task-prompt">
        <p className="section-label">{t.promptWrite}</p>
        <Sentence text={card.sentencePl} headword={card.wordPl} lang="pl" />
      </div>
      {!local ? (
        <form className="write-form" onSubmit={(e) => { e.preventDefault(); check() }}>
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                check()
              }
            }}
            placeholder={t.writePlaceholder}
            aria-label={t.yourAnswer}
            maxLength={MAX_TEXT_CHARS}
            autoFocus
            rows={3}
          />
          <div className="bottom-actions">
            <button type="submit" className="primary-wide" disabled={!typed.trim()}>{t.check}</button>
          </div>
        </form>
      ) : !done ? (
        <div className="surface-card">
          <p className="section-label">{t.yourAnswer}</p>
          <p lang="en" className="study typed-answer">{typed}</p>
          <p className="muted">{t.checking}</p>
        </div>
      ) : (
        <>
          <div className="surface-card">
            <p className="section-label">{t.yourAnswer}</p>
            {evaluation ? (
              <p lang="en" className="study typed-answer">{typed}</p>
            ) : (
              <p className="study typed-answer">
                {local.diff.tokens.map((t, i) => (
                  <span key={i} className={`diff-${t.kind}${t.head ? ' diff-head' : ''}`}>{t.text} </span>
                ))}
              </p>
            )}
          </div>
          {evaluation && (
            <div className={evaluation.verdict === 'wrong' ? 'verdict-block verdict-block-wrong' : 'verdict-block surface-card'}>
              <p lang="pl" className={`verdict verdict-${evaluation.verdict}`}>{evaluation.summaryPl}</p>
              {evaluation.corrected !== typed.trim() && (
                <Sentence text={evaluation.corrected} headword={card.word} lang="en" />
              )}
              {evaluation.notesPl.length > 0 && (
                <ul lang="pl" className="feedback-notes">
                  {evaluation.notesPl.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="surface-card">
            <p className="section-label">{evaluation ? t.alternative : t.answer}</p>
            <Sentence text={card.sentenceEn} headword={card.word} lang="en" bold />
            {!evaluation && (
              <p className="muted">
                {`${Math.round(local.diff.score * 100)}%`} · {checked && !checked.ok && checked.reason === 'no-credits' ? t.aiNoCredits : t.aiUnavailable}
              </p>
            )}
            {local.headword === 'missing' && <p className="error">{t.headwordMissing} <b>{card.word}</b></p>}
            {local.headword === 'typo' && <p className="muted">{t.headwordTypo}</p>}
            {card.audioKey && <AudioPlayer autoPlay cardId={card.id} audioKey={card.audioKey} />}
          </div>
          <div className="bottom-actions">
            {suggested && <p className="section-label">{t.suggested} {t.grades[suggested].toLowerCase()}</p>}
            <GradeButtons cardId={card.id} mode="write" typed={typed} suggested={suggested ?? undefined} />
          </div>
        </>
      )}
    </>
  )
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const tAll = useT()
  const t = tAll.review
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'flip' ? 'flip' : 'write'
  const card = loaderData.due[0] // action revalidates the loader → next card appears

  if (loaderData.finish) {
    const { done, streak } = loaderData.finish
    return (
      <main className="page task-screen">
        <TaskHead to="/" label={t.close} icon="close"><h1>{t.title}</h1></TaskHead>
        <TaskFinish title={t.allDone} line={done !== null ? tAll.home.doneReviewed(done) : null} streak={streak} />
      </main>
    )
  }

  const { doneToday } = loaderData
  const left = loaderData.due.length

  return (
    <main className="page task-screen">
      <h1 className="visually-hidden">{t.title}</h1>
      <TaskHead to="/" label={t.close} icon="close">
        {/* an Again-graded card stays due, so doneToday can grow while left doesn't drop */}
        <ProgressBar value={doneToday} max={doneToday + left} label={t.progress} />
        <span className="muted">{t.left(left)}</span>
      </TaskHead>
      <div className="segmented" role="group" aria-label={t.mode}>
        {(['write', 'flip'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => { if (mode !== option) setParams({ mode: option }) }}
          >
            {option === 'flip' ? t.modeFlip : t.modeWrite}
          </button>
        ))}
      </div>
      {mode === 'flip'
        ? <FlipCard key={card.id} card={card} />
        : <WriteCard key={card.id} card={card} />}
    </main>
  )
}

export function ErrorBoundary() {
  const t = useT().review
  return (
    <main className="page">
      <p className="error">{t.submitError}</p>
      <a href="/review">{t.backToReview}</a>
    </main>
  )
}
