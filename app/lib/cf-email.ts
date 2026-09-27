import type { Mailer } from './mailer'

// The only file that knows Cloudflare Email. Uses the binding's builder form (no raw MIME).
export function createCfMailer(binding: Pick<SendEmail, 'send'>, from: string, to: string): Mailer {
  return {
    async send({ subject, text, html }) {
      await binding.send({ from, to, subject, text, html })
    },
  }
}

export function mailerFromEnv(env: Pick<Env, 'EMAIL' | 'REMINDER_FROM' | 'REMINDER_TO'>): Mailer | null {
  const from = env.REMINDER_FROM?.trim()
  const to = env.REMINDER_TO?.trim()
  if (!from || !to) return null
  return createCfMailer(env.EMAIL, from, to)
}
