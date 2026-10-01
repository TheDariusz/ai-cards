import { Form, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login'
import { getUserId } from '../lib/session'
import { createDb } from '../db/repo'
import { mailerFromEnv } from '../lib/resend'
import { loginConfigFromEnv, requestLoginLink } from '../lib/login'

export async function loader({ request, context }: Route.LoaderArgs) {
  if ((await getUserId(request, context.cloudflare.env)) !== null) throw redirect('/')
  return null
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const origin = new URL(request.url).origin
  const send = async (to: string, msg: { subject: string; text: string; html: string }) => {
    const mailer = mailerFromEnv(env, to)
    if (mailer) return mailer.send(msg)
    // local dev without Resend: the link goes to the terminal; never in production
    if (new URL(origin).hostname === 'localhost') console.log(`login link for ${to}: ${msg.text}`)
    else throw new Error('RESEND_API_KEY/REMINDER_FROM not configured')
  }
  try {
    const result = await requestLoginLink(
      { db: createDb(env.DB), config: loginConfigFromEnv(env), send }, form.get('email'), origin, Date.now(),
    )
    if (result === 'invalid') return { error: 'Enter a valid email address' }
    if (result === 'throttled') console.log('login: link limit reached')
  } catch (err) {
    // same answer as success, so a failure can't reveal which addresses are on the list
    console.error('login: sending link failed', err)
  }
  return { sent: true as const }
}

export default function Login() {
  const data = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  return (
    <main className="page">
      <h1>AI Cards</h1>
      {data && 'sent' in data ? (
        <p className="ok">If this address can use AI Cards, a login link is on its way. It works for 15 minutes.</p>
      ) : (
        <Form method="post">
          <input type="email" name="email" placeholder="Email" autoComplete="email" required autoFocus />
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a login link'}</button>
          {data && 'error' in data && <p className="error">{data.error}</p>}
        </Form>
      )}
    </main>
  )
}
