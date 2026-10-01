import { Form, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login'
import { getUserId } from '../lib/session'
import { createDb } from '../db/repo'
import { mailSenderFromEnv } from '../lib/resend'
import { loginConfigFromEnv, requestLoginLink } from '../lib/login'

export async function loader({ request, context }: Route.LoaderArgs) {
  if ((await getUserId(request, context.cloudflare.env)) !== null) throw redirect('/')
  return null
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const origin = new URL(request.url).origin
  try {
    const deps = { db: createDb(env.DB), config: loginConfigFromEnv(env), send: mailSenderFromEnv(env, origin) }
    const result = await requestLoginLink(deps, form.get('email'), origin, Date.now())
    if (result === 'invalid') return { error: 'Enter a valid email address' }
    if (result === 'throttled' || result === 'requested') console.log(`login: ${result}`)
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
        <p className="ok">If this address has access, a login link is on its way (valid for 15 minutes). If not, your request has been sent to the owner — you’ll get an email once it’s approved.</p>
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
