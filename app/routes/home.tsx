import { Form, Link, useFetcher, useLocation, useRevalidator, useRouteLoaderData } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { getUserId, requireAuth } from '../lib/session'
import { Landing } from '../welcome/landing'
import { createDb, insertPendingCard, markPending, getCard, listCards, countDue, completedDays, getNewCards, getSetting, getBalance } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { OWNER_USER_ID } from '../db/schema'
import { aiFromEnv } from '../lib/openrouter'
import { canAddCard, dailyCardLimit } from '../lib/quota'
import { MAX_WORD_CHARS } from '../lib/limits'
import { hasCredits, starterMicros, toCredits, usageRecorder } from '../lib/credits'
import { parseLocale } from '../lib/locale'
import { dict, useT } from '../lib/i18n'
import { LocaleSwitch } from '../welcome/locale-switch'
import { computeStreak, dayKey } from '../lib/streak'
import type { ThemePref } from '../lib/theme'
import type { loader as rootLoader } from '../root'
import type { action as reminderAction } from './reminder'

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
  const days = await completedDays(db, userId)
  const newCards = await getNewCards(db, userId)
  const today = dayKey(now)
  const balance = await getBalance(db, userId)
  const isOwner = userId === OWNER_USER_ID
  return {
    pending: all.filter((c) => c.status === 'pending' && !isStuck(c, now)).map((c) => ({ id: c.id, word: c.word })),
    failed: all.filter((c) => c.status === 'failed' || isStuck(c, now)).map((c) => ({ id: c.id, word: c.word })),
    total: all.length,
    due: await countDue(db, userId, now),
    newCards: newCards.map((c) => ({ id: c.id, word: c.word })),
    streak: computeStreak(days, today),
    completed: days.filter((d) => d.startsWith(today.slice(0, 7))), // this month
    today,
    reminderEnabled: (await getSetting(db, userId, 'reminderEnabled')) !== 'false',
    isOwner,
    credits: { left: toCredits(balance.balanceMicros), granted: toCredits(balance.grantedMicros), spentMicros: balance.spentMicros },
    outOfCredits: !isOwner && balance.balanceMicros <= 0,
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
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
      runCardPipeline({ db, ai: aiFromEnv(env, usageRecorder(db, userId)), audio: env.AUDIO }, userId, id, word),
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
        runCardPipeline({ db, ai: aiFromEnv(env, usageRecorder(db, userId)), audio: env.AUDIO }, userId, id, card.word),
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

function UserHome({ loaderData, actionData }: { loaderData: UserHome; actionData: Route.ComponentProps['actionData'] }) {
  const { pending, failed, total, due, newCards, streak, completed, today, reminderEnabled, isOwner, credits, outOfCredits } = loaderData
  const revalidator = useRevalidator()
  const location = useLocation()
  const theme = useRouteLoaderData<typeof rootLoader>('root')?.theme ?? 'auto'
  const reminder = useFetcher<typeof reminderAction>()
  const t = useT()
  const sendingTest = reminder.state !== 'idle' && reminder.formData?.get('intent') === 'test'

  // light polling while cards are generating
  useEffect(() => {
    if (pending.length === 0) return
    const t = setInterval(() => revalidator.revalidate(), 3000)
    return () => clearInterval(t)
  }, [pending.length, revalidator])

  return (
    <main className="page">
      <h1 className="home-head">AI Cards {streak > 0 && <span className="streak-chip">🔥 {streak}</span>}</h1>
      {outOfCredits ? (
        <p className="error">{t.common.noCredits}</p>
      ) : (
        <Form method="post" className="quick-add">
          <input type="hidden" name="intent" value="add" />
          <input name="word" placeholder={t.home.newWord} autoComplete="off" maxLength={MAX_WORD_CHARS} autoFocus />
          <button type="submit">{t.home.add}</button>
        </Form>
      )}
      <p className="muted credits">
        {isOwner ? t.home.spent((credits.spentMicros / 1e6).toFixed(2)) : t.home.credits(credits.left, credits.granted)}
      </p>
      {actionData && 'added' in actionData && <p className="ok">{t.home.added(actionData.added ?? '')}</p>}
      {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}

      {pending.length > 0 && (
        <p className="pending">⏳ {t.home.generating} {pending.map((c) => c.word).join(', ')}</p>
      )}
      {failed.map((c) => (
        <Form method="post" key={c.id} className="failed-row">
          <input type="hidden" name="intent" value="retry" />
          <input type="hidden" name="cardId" value={c.id} />
          <span className="error">{t.home.failed(c.word)}</span>
          {!outOfCredits && <button type="submit">{t.home.retry}</button>}
        </Form>
      ))}

      <div className="stats">
        <div className="stat"><b>{due}</b> {t.home.dueToday(due)}</div>
        <div className="stat"><b>🔥 {streak}</b> {t.home.dayStreak(streak)}</div>
      </div>
      {newCards.length > 0 && (
        <section className="new-queue">
          <div>
            <b>{t.home.newToLearn(newCards.length)}</b>
            <p className="muted">{t.home.startWith(newCards[0].word)}</p>
          </div>
          <Link to="/learn"><button>{t.home.learnNow}</button></Link>
        </section>
      )}
      {due > 0 && <Link to="/review"><button className="primary-wide">{t.home.startReview}</button></Link>}
      <div className="calendar">
        {Array.from({ length: Number(today.slice(8, 10)) }, (_, i) => {
          const d = `${today.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
          return <span key={d} className={`day ${completed.includes(d) ? 'done' : ''}`}>{i + 1}</span>
        })}
      </div>

      <nav className="nav">
        <Link to="/review" className="nav-tile">{t.home.navReview} <span>→</span></Link>
        <Link to="/cards" className="nav-tile">{t.home.navCards} <span>{total}</span></Link>
      </nav>
      <details className="settings">
        <summary>⚙ {t.home.settings}</summary>
        <div className="settings-links">
          <a href="/export/csv" download>{t.home.exportCsv}</a>
          <a href="/export/json" download>{t.home.backupJson}</a>
          {isOwner && <Link to="/admin">{t.home.users}</Link>}
        </div>
        <Form method="post" action="/theme" className="theme-switch">
          <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
          {(['auto', 'light', 'dark'] as ThemePref[]).map((value) => (
            <button key={value} type="submit" name="theme" value={value} aria-pressed={theme === value}>
              {t.home.theme[value]}
            </button>
          ))}
        </Form>
        <LocaleSwitch />
        <reminder.Form method="post" action="/reminder" className="reminder-switch">
          <span>{t.home.reminderAt}</span>
          <span className="reminder-segment">
            <button type="submit" name="intent" value="on" aria-pressed={reminderEnabled}>{t.home.on}</button>
            <button type="submit" name="intent" value="off" aria-pressed={!reminderEnabled}>{t.home.off}</button>
          </span>
          <button type="submit" name="intent" value="test" className="link-button" disabled={sendingTest}>
            {sendingTest ? t.home.sending : t.home.sendTest}
          </button>
        </reminder.Form>
        {reminder.state === 'idle' && reminder.data && 'reminderSent' in reminder.data && <p className="ok">{t.home.sent}</p>}
        {reminder.state === 'idle' && reminder.data && 'reminderError' in reminder.data && (
          <p className="error">⚠ {reminder.data.reminderError}</p>
        )}
      </details>
      <Form method="post" action="/logout" className="logout">
        <button type="submit" className="link-button">{t.home.logOut}</button>
      </Form>
    </main>
  )
}
