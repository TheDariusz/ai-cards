import { Form, redirect, useActionData } from 'react-router'
import type { Route } from './+types/login'
import { getSessionStorage, sha256Hex } from '../lib/session'

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const password = String(form.get('password') ?? '')
  if ((await sha256Hex(password)) !== env.APP_PASSWORD_HASH) {
    return { error: 'Wrong password' }
  }
  const { getSession, commitSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession()
  session.set('authed', true)
  return redirect('/', { headers: { 'Set-Cookie': await commitSession(session) } })
}

export default function Login() {
  const data = useActionData<typeof action>()
  return (
    <main className="page">
      <h1>AI Cards</h1>
      <Form method="post">
        <input type="password" name="password" placeholder="Password" autoFocus />
        <button type="submit">Log in</button>
        {data?.error && <p className="error">{data.error}</p>}
      </Form>
    </main>
  )
}
