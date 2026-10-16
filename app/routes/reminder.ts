import type { Route } from './+types/reminder'
import { requireAuth } from '../lib/session'
import { createDb, getUserEmail, setSetting } from '../db/repo'
import { mailerFromEnv } from '../lib/resend'
import { reminderRecipient, runReminder } from '../lib/reminder-job'
import { dict } from '../lib/i18n'
import { parseLocale } from '../lib/locale'

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const intent = (await request.formData()).get('intent')
  const t = dict[parseLocale(request.headers.get('Cookie'))]

  if (intent === 'on' || intent === 'off') {
    await setSetting(db, userId, 'reminderEnabled', intent === 'on' ? 'true' : 'false')
    return { ok: true as const }
  }
  if (intent === 'test') {
    const to = reminderRecipient({ id: userId, email: await getUserEmail(db, userId) }, env.REMINDER_TO)
    const mailer = to ? mailerFromEnv(env, to) : null
    if (!mailer) return { reminderError: t.home.reminderNotConfigured }
    try {
      await runReminder({ db, mailer, appUrl: env.APP_URL }, userId, Date.now(), { force: true })
      return { reminderSent: true as const }
    } catch (err) {
      console.error('reminder: test failed', err)
      return { reminderError: t.home.reminderFailed }
    }
  }
  throw new Response('Bad Request', { status: 400 })
}
