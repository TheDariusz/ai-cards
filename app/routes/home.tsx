import { Form, Link, useNavigate, useRevalidator, useRouteLoaderData } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { getUserId, requireAuth } from '../lib/session'
import { Landing } from '../welcome/landing'
import { createDb, insertPendingCard, markPending, getCard, listCards, countDue, completedDays, countReviewsOn, nextDueAt } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { aiFromEnv } from '../lib/openrouter'
import { canAddCard, dailyCardLimit } from '../lib/quota'
import { MAX_WORD_CHARS } from '../lib/limits'
import { hasCredits, starterMicros, toCredits, usageRecorder } from '../lib/credits'
import { parseLocale } from '../lib/locale'
import { cardStatus, countLearnedOn, isNewCard } from '../lib/cards'
import { dict, useT } from '../lib/i18n'
import { computeStreak, dayKey, dayStatus, weekDays } from '../lib/streak'
import { doneLine, formatDayLine, reviewMinutes, todayState, type TodayState } from '../lib/today'
import { Icon } from '../ui/icons'
import type { loader as shellLoader } from './shell'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const locale = parseLocale(request.headers.get('Cookie'))
  // Visitors get the public landing page; requireAuth still guards the rest (blocked users included).
  if ((await getUserId(request, env)) === null) {
    return { guest: { starterCredits: toCredits(starterMicros(env)), dailyCardLimit: dailyCardLimit(env) } }
  }
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const now = Date.now()
  const today = dayKey(now)
  // Credits and owner status come from the shell loader, which runs alongside this one.
  const [all, days, due, next, reviewedToday] = await Promise.all([
    listCards(db, userId),
    completedDays(db, userId),
    countDue(db, userId, now),
    nextDueAt(db, userId, now),
    countReviewsOn(db, userId, today),
  ])
  const status = all.map((c) => ({ id: c.id, word: c.word, status: cardStatus(c, now) }))
  const cardsWith = (s: string) => status.filter((c) => c.status === s).map(({ id, word }) => ({ id, word }))
  // oldest first, like getNewCards (listCards is newest first)
  const newCards = all.filter(isNewCard).reverse()
  const doneSet = new Set(days)
  const state: TodayState = todayState({
    total: all.length,
    ready: all.filter((c) => c.status === 'ready').length,
    due,
    newCount: newCards.length,
    todayDone: doneSet.has(today),
  })
  return {
    state,
    dateLine: formatDayLine(today, locale),
    week: weekDays(today).map((day) => ({ day, status: dayStatus(day, today, doneSet) })),
    streak: computeStreak(days, today),
    due,
    minutes: reviewMinutes(due),
    newCards: newCards.map((c) => ({ id: c.id, word: c.word })),
    pending: cardsWith('pending'),
    failed: cardsWith('failed'),
    reviewedToday,
    learnedToday: countLearnedOn(all, today),
    nextDueLine: next === null ? null : formatDayLine(dayKey(next), locale),
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const log = context.log
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const form = await request.formData()
  const intent = form.get('intent')
  const t = dict[parseLocale(request.headers.get('Cookie'))]

  if (intent === 'add') {
    const word = String(form.get('word') ?? '').trim()
    if (!word) return { error: t.home.typeWordFirst }
    if (word.length > MAX_WORD_CHARS) return { error: t.home.wordTooLong(MAX_WORD_CHARS) }
    if (!(await hasCredits(db, userId))) return { error: t.common.noCredits }
    const limit = dailyCardLimit(env)
    if (!(await canAddCard(db, userId, Date.now(), limit))) {
      return { error: t.home.dailyLimit(limit) }
    }
    const id = await insertPendingCard(db, userId, word, Date.now())
    context.cloudflare.ctx.waitUntil(
      runCardPipeline({ db, ai: aiFromEnv(env, usageRecorder(db, userId, log)), audio: env.AUDIO, log }, userId, id, word),
    )
    return { added: word }
  }

  if (intent === 'retry') {
    const id = Number(form.get('cardId'))
    const card = await getCard(db, userId, id)
    if (!(await hasCredits(db, userId))) return { error: t.common.noCredits }
    if (card && cardStatus(card, Date.now()) === 'failed') {
      // shortcut: a stuck card stays shown as failed (isStuck keys off createdAt) until its retry finishes
      await markPending(db, userId, id)
      context.cloudflare.ctx.waitUntil(
        runCardPipeline({ db, ai: aiFromEnv(env, usageRecorder(db, userId, log)), audio: env.AUDIO, log }, userId, id, card.word),
      )
    }
    return { retried: id }
  }
  return null
}

type UserHome = Exclude<Route.ComponentProps['loaderData'], { guest: object }>

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.guest) return <Landing {...loaderData.guest} />
  return <UserHome loaderData={loaderData} actionData={actionData} />
}

type ActionData = Route.ComponentProps['actionData']

function UserHome({ loaderData, actionData }: { loaderData: UserHome; actionData: ActionData }) {
  const { state, dateLine, week, streak, newCards, pending, failed } = loaderData
  // requireAuth passed, so the shell has its signed-in data
  const { isOwner, credits, outOfCredits } = useRouteLoaderData<typeof shellLoader>('routes/shell')!
  const revalidator = useRevalidator()
  const t = useT()

  // light polling while cards are generating
  useEffect(() => {
    if (pending.length === 0) return
    const t = setInterval(() => revalidator.revalidate(), 3000)
    return () => clearInterval(t)
  }, [pending.length, revalidator])

  // Enter starts the review from anywhere on the page, unless a control already owns the key
  const navigate = useNavigate()
  useEffect(() => {
    if (state !== 'review') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, button, a, [contenteditable]')) return
      navigate('/review')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, navigate])

  const showTile = state !== 'learn' && newCards.length > 0
  const weekLabel = `${t.home.weekLabel} · ${streak} ${t.streak.inARow(streak)}`
  // While the first card is on its way the primary card already says so: no "added" line, no status line.
  const quietProgress = state === 'preparing' && failed.length === 0

  return (
    <main className="page today-screen" data-state={state}>
      <header className="today-head">
        <div>
          <p className="today-date">{dateLine}</p>
          <h1>{t.nav.today}</h1>
        </div>
        {streak > 0 && (
          <Link to="/streak" className="today-streak" aria-label={`${streak} ${t.streak.inARow(streak)}`}>
            <span><Icon name="flame" />{streak}</span>
          </Link>
        )}
      </header>

      {state !== 'first-run' && (
        <div className="today-add">
          <AddWord outOfCredits={outOfCredits} placeholder={t.home.newWord} />
          <Feedback actionData={actionData} hideAdded={quietProgress} />
          {/* While preparing, the primary card carries the first failed card and its Retry. */}
          <FailedCards failed={state === 'preparing' ? failed.slice(1) : failed} outOfCredits={outOfCredits} />
        </div>
      )}

      <div className="today-cols">
        <div className="today-main">
          <TodayCard data={loaderData} actionData={actionData} outOfCredits={outOfCredits} />
          {state === 'first-run' && <FirstSteps starterCredits={isOwner || outOfCredits ? null : credits.granted} />}
        </div>
        {state !== 'first-run' && (
          <div className="today-side">
            {showTile && (
              <section className="surface-card today-tile">
                <div>
                  <b>{t.home.newWords(newCards.length)}</b>
                  <p className="muted">{state === 'done' ? t.home.startWithOptional(newCards[0].word) : t.home.startWith(newCards[0].word)}</p>
                </div>
                <Link to="/learn" className="tile-action">{t.home.learnNow}</Link>
              </section>
            )}
            <section className="week-card">
              <h2>{t.home.weekLabel}</h2>
              <Link to="/streak" className="week" aria-label={weekLabel}>
                {week.map(({ day, status }, i) => (
                  <span key={day} className={status}>
                    {t.home.weekdays[i]}
                  </span>
                ))}
              </Link>
            </section>
            {pending.length > 0 && !quietProgress && (
              <p className="muted today-status">{t.home.generating} {pending.map((c) => c.word).join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

// The one primary card; its content follows `state` (see todayState).
function TodayCard({ data, actionData, outOfCredits }: { data: UserHome; actionData: ActionData; outOfCredits: boolean }) {
  const { state, due, minutes, newCards, pending, failed, reviewedToday, learnedToday, nextDueLine } = data
  const t = useT()

  switch (state) {
    case 'first-run':
      return (
        <section className="primary-card today-card" data-state={state}>
          <h2>{t.home.firstTitle}</h2>
          <p>{t.home.firstBody}</p>
          <AddWord outOfCredits={outOfCredits} placeholder={t.home.firstPlaceholder} autoFocus />
          <Feedback actionData={actionData} />
        </section>
      )
    case 'preparing':
      // A failure is not a call to action: a calm tinted card with a red heading, not the accent card.
      if (failed.length > 0) {
        const card = failed[0]
        return (
          <section className="today-card today-failed" data-state={state}>
            <div>
              <h2>{t.home.failedTitle}</h2>
              <p><b lang="en">{card.word}</b></p>
              <p>{t.home.failedHint}</p>
            </div>
            {!outOfCredits && (
              <Form method="post">
                <input type="hidden" name="intent" value="retry" />
                <input type="hidden" name="cardId" value={card.id} />
                <button type="submit">{t.home.retry}</button>
              </Form>
            )}
          </section>
        )
      }
      return (
        <section className="primary-card today-card" data-state={state}>
          <h2>{t.home.preparingTitle}</h2>
          {pending.length > 0 && <p>{t.home.preparingBody(pending[0].word)}</p>}
        </section>
      )
    case 'review':
      return (
        <section className="primary-card today-card" data-state={state}>
          <div>
            <p className="today-count">{due}</p>
            <p>{t.home.reviewLine(due, minutes)}</p>
          </div>
          <Link to="/review" className="today-action">{t.home.startReview} <kbd>Enter</kbd></Link>
        </section>
      )
    case 'learn':
      return (
        <section className="primary-card today-card" data-state={state}>
          <div>
            <p className="today-eyebrow">{t.home.newWords(newCards.length)}</p>
            <h2 className="today-word study" lang="en">{newCards[0].word}</h2>
            <p>{t.home.learnTomorrow}</p>
          </div>
          <Link to="/learn" className="today-action">{t.home.learnNow}</Link>
        </section>
      )
    case 'done': {
      const line = doneLine(reviewedToday, learnedToday)
      return (
        <section className="today-card" data-state={state}>
          <Icon name="check" />
          <div>
            <h2>{t.home.doneTitle}</h2>
            {line && <p>{line.kind === 'reviewed' ? t.home.doneReviewed(line.n) : t.home.doneLearned(line.n)}</p>}
          </div>
        </section>
      )
    }
    case 'nothing-due':
      return (
        <section className="surface-card today-card" data-state={state}>
          <h2>{t.home.nothingTitle}</h2>
          {nextDueLine && <p className="muted">{t.home.nothingNext(nextDueLine)}</p>}
        </section>
      )
  }
}

// autoFocus only on first run: elsewhere the field would outshine the primary card with a permanent focus ring.
function AddWord({ outOfCredits, placeholder, autoFocus = false }: { outOfCredits: boolean; placeholder: string; autoFocus?: boolean }) {
  const t = useT()
  if (outOfCredits) return <p className="error">{t.common.noCredits}</p>
  return (
    <Form method="post" className="add-word">
      <input type="hidden" name="intent" value="add" />
      <input name="word" placeholder={placeholder} aria-label={t.home.newWord} autoComplete="off" maxLength={MAX_WORD_CHARS} autoFocus={autoFocus} />
      <button type="submit">{t.home.add}</button>
    </Form>
  )
}

function Feedback({ actionData, hideAdded = false }: { actionData: ActionData; hideAdded?: boolean }) {
  const t = useT()
  if (actionData && 'added' in actionData) return hideAdded ? null : <p className="ok">{t.home.added(actionData.added ?? '')}</p>
  if (actionData && 'error' in actionData) return <p className="error">{actionData.error}</p>
  return null
}

function FailedCards({ failed, outOfCredits }: { failed: { id: number; word: string }[]; outOfCredits: boolean }) {
  const t = useT()
  return failed.map((c) => (
    <Form method="post" key={c.id} className="failed-row">
      <input type="hidden" name="intent" value="retry" />
      <input type="hidden" name="cardId" value={c.id} />
      <span className="error">{t.home.failed(c.word)}</span>
      {!outOfCredits && <button type="submit">{t.home.retry}</button>}
    </Form>
  ))
}

// First run only: what happens after adding a word, and the starter credits.
// starterCredits is null for the owner and once credits run out: no note then.
function FirstSteps({ starterCredits }: { starterCredits: number | null }) {
  const t = useT()
  const steps = [t.home.stepNow, t.home.stepThen, t.home.stepTomorrow]
  return (
    <>
      <ol className="surface-card today-steps">
        {steps.map(([label, sentence]) => (
          <li key={label}><b>{label}</b><span>{sentence}</span></li>
        ))}
      </ol>
      {starterCredits !== null && <p className="muted today-note">{t.home.starterNote(starterCredits)}</p>}
    </>
  )
}
