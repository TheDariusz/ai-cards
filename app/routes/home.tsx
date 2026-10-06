import { Form, Link, useFetcher, useLocation, useRevalidator, useRouteLoaderData } from 'react-router'
import { useEffect } from 'react'
import type { Route } from './+types/home'
import { requireAuth } from '../lib/session'
import { createDb, insertPendingCard, getCard, listCards, countDue, completedDays, getNewCards, getSetting, getBalance } from '../db/repo'
import { runCardPipeline } from '../lib/pipeline'
import { OWNER_USER_ID } from '../db/schema'
import { aiFromEnv } from '../lib/openrouter'
import { canAddCard, dailyCardLimit } from '../lib/quota'
import { MAX_WORD_CHARS } from '../lib/limits'
import { hasCredits, NO_CREDITS_MESSAGE, toCredits, usageRecorder } from '../lib/credits'
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

  if (intent === 'add') {
    const word = String(form.get('word') ?? '').trim()
    if (!word) return { error: 'Type a word first' }
    if (word.length > MAX_WORD_CHARS) return { error: `Keep it within ${MAX_WORD_CHARS} characters` }
    if (!(await hasCredits(db, userId))) return { error: NO_CREDITS_MESSAGE }
    const limit = dailyCardLimit(env)
    if (!(await canAddCard(db, userId, Date.now(), limit))) {
      return { error: `Daily limit of ${limit} new cards reached — try again tomorrow` }
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
    if (!(await hasCredits(db, userId))) return { error: NO_CREDITS_MESSAGE }
    if (card && (card.status === 'failed' || isStuck(card, Date.now()))) {
      context.cloudflare.ctx.waitUntil(
        runCardPipeline({ db, ai: aiFromEnv(env, usageRecorder(db, userId)), audio: env.AUDIO }, userId, id, card.word),
      )
    }
    return { retried: id }
  }
  return null
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { pending, failed, total, due, newCards, streak, completed, today, reminderEnabled, isOwner, credits, outOfCredits } = loaderData
  const revalidator = useRevalidator()
  const location = useLocation()
  const theme = useRouteLoaderData<typeof rootLoader>('root')?.theme ?? 'auto'
  const reminder = useFetcher<typeof reminderAction>()
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
        <p className="error">{NO_CREDITS_MESSAGE}</p>
      ) : (
        <Form method="post" className="quick-add">
          <input type="hidden" name="intent" value="add" />
          <input name="word" placeholder="New word…" autoComplete="off" maxLength={MAX_WORD_CHARS} autoFocus />
          <button type="submit">Add</button>
        </Form>
      )}
      <p className="muted credits">
        {isOwner ? `Spent: $${(credits.spentMicros / 1e6).toFixed(2)}` : `Credits: ${credits.left} / ${credits.granted}`}
      </p>
      {actionData && 'added' in actionData && <p className="ok">Added “{actionData.added}” — generating…</p>}
      {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}

      {pending.length > 0 && (
        <p className="pending">⏳ Generating: {pending.map((c) => c.word).join(', ')}</p>
      )}
      {failed.map((c) => (
        <Form method="post" key={c.id} className="failed-row">
          <input type="hidden" name="intent" value="retry" />
          <input type="hidden" name="cardId" value={c.id} />
          <span className="error">“{c.word}” failed</span>
          {!outOfCredits && <button type="submit">Retry</button>}
        </Form>
      ))}

      <div className="stats">
        <div className="stat"><b>{due}</b> due today</div>
        <div className="stat"><b>🔥 {streak}</b> day streak</div>
      </div>
      {newCards.length > 0 && (
        <section className="new-queue">
          <div>
            <b>{newCards.length} New to learn</b>
            <p className="muted">Start with {newCards[0].word}, then it joins tomorrow’s reviews.</p>
          </div>
          <Link to="/learn"><button>Learn now</button></Link>
        </section>
      )}
      {due > 0 && <Link to="/review"><button className="primary-wide">Start review</button></Link>}
      <div className="calendar">
        {Array.from({ length: Number(today.slice(8, 10)) }, (_, i) => {
          const d = `${today.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
          return <span key={d} className={`day ${completed.includes(d) ? 'done' : ''}`}>{i + 1}</span>
        })}
      </div>

      <nav className="nav">
        <Link to="/review" className="nav-tile">Review <span>→</span></Link>
        <Link to="/cards" className="nav-tile">Cards <span>{total}</span></Link>
      </nav>
      <details className="settings">
        <summary>⚙ Settings</summary>
        <div className="settings-links">
          <a href="/export/csv" download>Export CSV</a>
          <a href="/export/json" download>Backup JSON</a>
          {isOwner && <Link to="/admin">Users</Link>}
        </div>
        <Form method="post" action="/theme" className="theme-switch">
          <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
          {(['auto', 'light', 'dark'] as ThemePref[]).map((value) => (
            <button key={value} type="submit" name="theme" value={value} aria-pressed={theme === value}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </Form>
        <reminder.Form method="post" action="/reminder" className="reminder-switch">
          <span>Reminder at 19:00</span>
          <span className="reminder-segment">
            <button type="submit" name="intent" value="on" aria-pressed={reminderEnabled}>On</button>
            <button type="submit" name="intent" value="off" aria-pressed={!reminderEnabled}>Off</button>
          </span>
          <button type="submit" name="intent" value="test" className="link-button" disabled={sendingTest}>
            {sendingTest ? 'Sending…' : 'Send test'}
          </button>
        </reminder.Form>
        {reminder.state === 'idle' && reminder.data && 'reminderSent' in reminder.data && <p className="ok">Sent ✓</p>}
        {reminder.state === 'idle' && reminder.data && 'reminderError' in reminder.data && (
          <p className="error">⚠ {reminder.data.reminderError}</p>
        )}
      </details>
      <Form method="post" action="/logout" className="logout">
        <button type="submit" className="link-button">Log out</button>
      </Form>
    </main>
  )
}
