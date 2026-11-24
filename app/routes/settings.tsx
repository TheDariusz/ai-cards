import { Form, Link, useFetcher, useRouteLoaderData } from 'react-router'
import type { Route } from './+types/settings'
import { requireAuth } from '../lib/session'
import { createDb, getBalance, getSetting, getUserEmail } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import { toCredits } from '../lib/credits'
import { useT } from '../lib/i18n'
import type { ThemePref } from '../lib/theme'
import { LocaleSwitch } from '../welcome/locale-switch'
import type { loader as rootLoader } from '../root'
import type { action as reminderAction } from './reminder'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const balance = await getBalance(db, userId)
  return {
    email: await getUserEmail(db, userId),
    reminderEnabled: (await getSetting(db, userId, 'reminderEnabled')) !== 'false',
    isOwner: userId === OWNER_USER_ID,
    credits: { left: toCredits(balance.balanceMicros), granted: toCredits(balance.grantedMicros), spentMicros: balance.spentMicros },
  }
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { email, reminderEnabled, isOwner, credits } = loaderData
  const t = useT()
  const theme = useRouteLoaderData<typeof rootLoader>('root')?.theme ?? 'auto'
  const reminder = useFetcher<typeof reminderAction>()
  const sendingTest = reminder.state !== 'idle' && reminder.formData?.get('intent') === 'test'
  // Show the switch flipped as soon as it is pressed, before the revalidated loader catches up.
  const pendingIntent = reminder.formData?.get('intent')
  const enabled = pendingIntent === 'on' ? true : pendingIntent === 'off' ? false : reminderEnabled
  const share = credits.granted > 0 ? Math.min(1, Math.max(0, credits.left / credits.granted)) : 0

  return (
    <main className="page settings-page">
      <h1>{t.settings.title}</h1>

      <section className="surface-card settings-card" aria-labelledby="set-appearance">
        <h2 id="set-appearance" className="section-label">{t.settings.appearance}</h2>
        <div className="setting-row">
          <span>{t.settings.themeLabel}</span>
          <Form method="post" action="/theme" className="segmented">
            <input type="hidden" name="redirectTo" value="/settings" />
            {(['auto', 'light', 'dark'] as ThemePref[]).map((value) => (
              <button key={value} type="submit" name="theme" value={value} aria-pressed={theme === value}>
                {t.settings.theme[value]}
              </button>
            ))}
          </Form>
        </div>
        <div className="setting-row">
          <span>{t.settings.languageLabel}</span>
          <LocaleSwitch />
        </div>
      </section>

      <section className="surface-card settings-card" aria-labelledby="set-reminder">
        <h2 id="set-reminder" className="section-label">{t.settings.reminder}</h2>
        <reminder.Form method="post" action="/reminder" className="setting-row">
          <span id="set-reminder-label">{t.settings.reminderLabel}</span>
          <button
            type="submit"
            name="intent"
            value={enabled ? 'off' : 'on'}
            className="switch"
            aria-pressed={enabled}
            aria-labelledby="set-reminder-label"
          />
        </reminder.Form>
        <reminder.Form method="post" action="/reminder">
          <button type="submit" name="intent" value="test" className="link-button" disabled={sendingTest}>
            {sendingTest ? t.settings.sending : t.settings.sendTest}
          </button>
        </reminder.Form>
        {reminder.state === 'idle' && reminder.data && 'reminderSent' in reminder.data && <p className="ok">{t.settings.sent}</p>}
        {reminder.state === 'idle' && reminder.data && 'reminderError' in reminder.data && (
          <p className="error">⚠ {reminder.data.reminderError}</p>
        )}
      </section>

      <section className="surface-card settings-card" aria-labelledby="set-credits">
        <h2 id="set-credits" className="section-label">{t.settings.credits}</h2>
        {isOwner ? (
          <p className="setting-row">{t.home.spent((credits.spentMicros / 1e6).toFixed(2))}</p>
        ) : (
          <>
            <p className="setting-row">
              <b>{t.settings.creditsLeft(credits.left, credits.granted)}</b>
              <span className="muted">{t.settings.creditsNote}</span>
            </p>
            <div className="credit-meter" role="meter" aria-valuemin={0} aria-valuemax={credits.granted} aria-valuenow={credits.left} aria-label={t.settings.credits}>
              <span style={{ width: `${share * 100}%` }} />
            </div>
          </>
        )}
      </section>

      <section className="surface-card settings-card" aria-labelledby="set-data">
        <h2 id="set-data" className="section-label">{t.settings.data}</h2>
        <a href="/export/csv" download className="setting-link">{t.settings.exportCsv}</a>
        <a href="/export/json" download className="setting-link">{t.settings.backupJson}</a>
        {isOwner && <Link to="/admin" className="setting-link">{t.settings.users}</Link>}
      </section>

      <footer className="settings-foot">
        {email && <span className="muted">{email}</span>}
        <Form method="post" action="/logout">
          <button type="submit" className="link-button">{t.settings.logOut}</button>
        </Form>
      </footer>
    </main>
  )
}
