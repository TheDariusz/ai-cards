import { Form, Link, useRevalidator } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { getUserId, requireAuth } from '../lib/session'
import { Landing } from '../welcome/landing'
import { createDb, insertPendingCard, markPending, getCard, listCards, countDue, completedDays, getNewCards, getBalance, countReviewsOn, nextDueAt } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { OWNER_USER_ID } from '../db/schema'
import { aiFromEnv } from '../lib/openrouter'
import { canAddCard, dailyCardLimit } from '../lib/quota'
import { MAX_WORD_CHARS } from '../lib/limits'
import { hasCredits, starterMicros, toCredits, usageRecorder } from '../lib/credits'
import { parseLocale } from '../lib/locale'
import { dict, useLocale, useT } from '../lib/i18n'
import { computeStreak, dayKey, weekDays } from '../lib/streak'
import { doneLine, formatDayLine, reviewMinutes, todayState, weekdayShort, type TodayState } from '../lib/today'
import { Icon } from '../ui/icons'

// A pipeline killed mid-flight (isolate reclaimed) never reaches markFailed, so
// the row is stranded in `pending`. Past this age, treat it as failed and offer Retry.
const STALE_PENDING_MS = 5 * 60_000
const isStuck = (c: { status: string; createdAt: number }, now: number) =>
  c.status === 'pending' && now - c.createdAt > STALE_PENDING_MS

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  // Visitors get the public landing page; requireAuth still guards the rest (blocked users included).
  if ((await getUserId(request, env)) === null) {
    return { guest: { starterCredits: toCredits(starterMicros(env)), dailyCardLimit: dailyCardLimit(env) } }
  }
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const all = await listCards(db, userId)
  const now = Date.now()
  const today = dayKey(now)
  const days = await completedDays(db, userId)
  const newCards = await getNewCards(db, userId)
  const due = await countDue(db, userId, now)
  const next = await nextDueAt(db, userId, now)
  const balance = await getBalance(db, userId)
  const isOwner = userId === OWNER_USER_ID
  const state: TodayState = todayState({
    total: all.length,
    ready: all.filter((c) => c.status === 'ready').length,
    due,
    newCount: newCards.length,
    todayDone: days.includes(today),
  })
  return {
    state,
    today,
    week: weekDays(today).map((day) => ({ day, done: days.includes(day) })),
    streak: computeStreak(days, today),
    due,
    minutes: reviewMinutes(due),
    newCards: newCards.map((c) => ({ id: c.id, word: c.word })),
    pending: all.filter((c) => c.status === 'pending' && !isStuck(c, now)).map((c) => ({ id: c.id, word: c.word })),
    failed: all.filter((c) => c.status === 'failed' || isStuck(c, now)).map((c) => ({ id: c.id, word: c.word })),
    reviewedToday: await countReviewsOn(db, userId, today),
    learnedToday: all.filter((c) => c.firstLearnedAt !== null && dayKey(c.firstLearnedAt) === today).length,
    nextDue: next === null ? null : dayKey(next),
    isOwner,
    credits: { left: toCredits(balance.balanceMicros), granted: toCredits(balance.grantedMicros), spentMicros: balance.spentMicros },
    outOfCredits: !isOwner && balance.balanceMicros <= 0,
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
    if (card && (card.status === 'failed' || isStuck(card, Date.now()))) {
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
  const { state, today, week, streak, newCards, pending, failed, outOfCredits } = loaderData
  const revalidator = useRevalidator()
  const t = useT()
  const locale = useLocale()

  // light polling while cards are generating
  useEffect(() => {
    if (pending.length === 0) return
    const t = setInterval(() => revalidator.revalidate(), 3000)
    return () => clearInterval(t)
  }, [pending.length, revalidator])

  const showTile = state !== 'learn' && newCards.length > 0
  const weekLabel = `${t.home.weekLabel} · ${streak} ${t.home.dayStreak(streak)}`

  return (
    <main className="page today-screen">
      <header className="today-head">
        <div>
          <p className="today-date">{formatDayLine(today, locale)}</p>
          <h1>{t.home.today}</h1>
        </div>
        {streak > 0 && (
          <Link to="/streak" className="streak-chip" aria-label={`${streak} ${t.home.dayStreak(streak)}`}>
            <span><Icon name="flame" />{streak}</span>
          </Link>
        )}
      </header>

      {state !== 'first-run' && (
        <div className="today-add">
          <AddWord outOfCredits={outOfCredits} placeholder={t.home.newWord} />
          <Feedback actionData={actionData} />
          {/* While preparing, the primary card carries the failed cards and their Retry. */}
          {state !== 'preparing' && <FailedCards failed={failed} outOfCredits={outOfCredits} />}
        </div>
      )}

      <div className="today-cols">
        <div className="today-main">
          <TodayCard data={loaderData} actionData={actionData} />
          {state === 'first-run' && <FirstSteps data={loaderData} />}
        </div>
        {state !== 'first-run' && (
          <div className="today-side">
            {showTile && (
              <section className="surface-card today-tile">
                <div>
                  <b>{t.home.newWords(newCards.length)}</b>
                  <p className="muted">{t.home.startWith(newCards[0].word)}</p>
                </div>
                <Link to="/learn" className="tile-action">{t.home.learnNow}</Link>
              </section>
            )}
            <section className="week-card">
              <h2>{t.home.weekLabel}</h2>
              <Link to="/streak" className="week" aria-label={weekLabel}>
                {week.map(({ day, done }) => (
                  <span key={day} className={done ? 'done' : day === today ? 'today' : undefined}>
                    {weekdayShort(day, locale)}
                  </span>
                ))}
              </Link>
            </section>
            {pending.length > 0 && (
              <p className="muted today-status">{t.home.generating} {pending.map((c) => c.word).join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

// The one primary card; its content follows `state` (see todayState).
function TodayCard({ data, actionData }: { data: UserHome; actionData: ActionData }) {
  const { state, due, minutes, newCards, pending, failed, reviewedToday, learnedToday, nextDue, outOfCredits } = data
  const t = useT()
  const locale = useLocale()

  switch (state) {
    case 'first-run':
      return (
        <section className="primary-card today-card" data-state={state}>
          <h2>{t.home.firstTitle}</h2>
          <p>{t.home.firstBody}</p>
          <AddWord outOfCredits={outOfCredits} placeholder={t.home.firstPlaceholder} />
          <Feedback actionData={actionData} />
        </section>
      )
    case 'preparing':
      return (
        <section className="primary-card today-card" data-state={state}>
          {failed.length > 0 ? (
            <FailedCards failed={failed} outOfCredits={outOfCredits} />
          ) : (
            <>
              <h2>{t.home.preparingTitle}</h2>
              {pending.length > 0 && <p>{t.home.preparingBody(pending[0].word)}</p>}
            </>
          )}
        </section>
      )
    case 'review':
      return (
        <section className="primary-card today-card" data-state={state}>
          <div>
            <p className="today-count">{due}</p>
            <p>{t.home.reviewLine(due, minutes)}</p>
          </div>
          <Link to="/review" className="today-action">{t.home.startReview}</Link>
        </section>
      )
    case 'learn':
      return (
        <section className="primary-card today-card" data-state={state}>
          <div>
            <h2>{t.home.newWords(newCards.length)}</h2>
            <p>{t.home.startWith(newCards[0].word)}</p>
          </div>
          <Link to="/learn" className="today-action">{t.home.learnNow}</Link>
        </section>
      )
    case 'done': {
      const line = doneLine(reviewedToday, learnedToday)
      return (
        <section className="primary-card today-card" data-state={state}>
          <Icon name="check" />
          <div>
            <h2>{t.home.doneTitle}</h2>
            {line && <p className="muted">{line.kind === 'reviewed' ? t.home.doneReviewed(line.n) : t.home.doneLearned(line.n)}</p>}
          </div>
        </section>
      )
    }
    case 'nothing-due':
      return (
        <section className="primary-card today-card" data-state={state}>
          <h2>{t.home.nothingTitle}</h2>
          {nextDue && <p className="muted">{t.home.nothingNext(formatDayLine(nextDue, locale))}</p>}
        </section>
      )
  }
}

function AddWord({ outOfCredits, placeholder }: { outOfCredits: boolean; placeholder: string }) {
  const t = useT()
  if (outOfCredits) return <p className="error today-no-credits">{t.common.noCredits}</p>
  return (
    <Form method="post" className="add-word">
      <input type="hidden" name="intent" value="add" />
      <input name="word" placeholder={placeholder} aria-label={t.home.newWord} autoComplete="off" maxLength={MAX_WORD_CHARS} autoFocus />
      <button type="submit">{t.home.add}</button>
    </Form>
  )
}

function Feedback({ actionData }: { actionData: ActionData }) {
  const t = useT()
  if (actionData && 'added' in actionData) return <p className="ok">{t.home.added(actionData.added ?? '')}</p>
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
function FirstSteps({ data }: { data: UserHome }) {
  const t = useT()
  const steps = [t.home.stepNow, t.home.stepThen, t.home.stepTomorrow]
  return (
    <>
      <ol className="surface-card today-steps">
        {steps.map(([label, sentence]) => (
          <li key={label}><b>{label}</b><span>{sentence}</span></li>
        ))}
      </ol>
      {!data.isOwner && !data.outOfCredits && <p className="muted today-note">{t.home.starterNote(data.credits.granted)}</p>}
    </>
  )
}
