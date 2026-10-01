import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login-verify'
import { getSessionStorage } from '../lib/session'
import { createDb } from '../db/repo'
import { loginConfigFromEnv, verifyLoginLink } from '../lib/login'

// GET only renders a button: mail scanners that prefetch links must not burn the one-time token.
export async function loader({ request }: Route.LoaderArgs) {
  return { token: new URL(request.url).searchParams.get('token') ?? '' }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const userId = await verifyLoginLink(
    { db: createDb(env.DB), config: loginConfigFromEnv(env) }, form.get('token'), Date.now(),
  )
  if (userId === null) return { error: 'This link has expired or was already used.' }
  const { getSession, commitSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession()
  session.set('userId', userId)
  return redirect('/', { headers: { 'Set-Cookie': await commitSession(session) } })
}

export default function LoginVerify({ loaderData }: Route.ComponentProps) {
  const data = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  return (
    <main className="page">
      <h1>AI Cards</h1>
      {data?.error ? (
        <>
          <p className="error">{data.error}</p>
          <Link to="/login">Send a new link</Link>
        </>
      ) : (
        <Form method="post">
          <input type="hidden" name="token" value={loaderData.token} />
          <button type="submit" disabled={busy} autoFocus>{busy ? 'Logging in…' : 'Log in'}</button>
        </Form>
      )}
    </main>
  )
}
