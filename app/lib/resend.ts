import type { Mailer } from './mailer'

// The only file that knows Resend. The cron and the "Send test" button both wait on it.
const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 15_000

export function createResendMailer(opts: { apiKey: string; from: string; to: string }): Mailer {
  return {
    async send({ subject, text, html }) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: opts.to, subject, text, html }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
    },
  }
}

export function mailerFromEnv(env: Pick<Env, 'RESEND_API_KEY' | 'REMINDER_FROM' | 'REMINDER_TO'>): Mailer | null {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.REMINDER_FROM?.trim()
  const to = env.REMINDER_TO?.trim()
  if (!apiKey || !from || !to) return null
  return createResendMailer({ apiKey, from, to })
}
