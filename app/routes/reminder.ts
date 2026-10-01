import type { Route } from './+types/reminder'
import { requireAuth } from '../lib/session'
import { createDb, setSetting } from '../db/repo'
import { mailerFromEnv } from '../lib/resend'
import { runReminder } from '../lib/reminder-job'

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const intent = (await request.formData()).get('intent')

  if (intent === 'on' || intent === 'off') {
    await setSetting(db, userId, 'reminderEnabled', intent === 'on' ? 'true' : 'false')
    return { ok: true as const }
  }
  if (intent === 'test') {
    const mailer = mailerFromEnv(env)
    if (!mailer) return { reminderError: 'RESEND_API_KEY/REMINDER_TO not configured' }
    try {
      await runReminder({ db, mailer, appUrl: env.APP_URL }, userId, Date.now(), { force: true })
      return { reminderSent: true as const }
    } catch (err) {
      console.error('reminder: test failed', err)
      return { reminderError: err instanceof Error ? err.message : String(err) }
    }
  }
  throw new Response('Bad Request', { status: 400 })
}
