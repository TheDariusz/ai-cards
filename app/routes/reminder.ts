import type { Route } from './+types/reminder'
import { requireAuth } from '../lib/session'
import { createDb, setSetting } from '../db/repo'
import { mailerFromEnv } from '../lib/cf-email'
import { runReminder } from '../lib/reminder-job'

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const db = createDb(env.DB)
  const intent = (await request.formData()).get('intent')

  if (intent === 'on' || intent === 'off') {
    await setSetting(db, 'reminderEnabled', intent === 'on' ? 'true' : 'false')
    return { ok: true as const }
  }
  if (intent === 'test') {
    const mailer = mailerFromEnv(env)
    if (!mailer) return { reminderError: 'REMINDER_FROM/TO not configured' }
    try {
      await runReminder({ db, mailer, appUrl: env.APP_URL }, Date.now(), { force: true })
      return { reminderSent: true as const }
    } catch (err) {
      console.error('reminder: test failed', err)
      return { reminderError: err instanceof Error ? err.message : String(err) }
    }
  }
  throw new Response('Bad Request', { status: 400 })
}
