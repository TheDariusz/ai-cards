import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login-verify'
import { getSessionStorage } from '../lib/session'
import { createDb } from '../db/repo'
import { dict } from '../lib/i18n'
import { localeCookie, toLocale } from '../lib/locale'
import { loginConfigFromEnv, verifyLoginLink } from '../lib/login'

// GET only renders a button: mail scanners that prefetch links must not burn the one-time token.
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams
  return { token: params.get('token') ?? '', lang: toLocale(params.get('lang')) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const lang = toLocale(form.get('lang'))
  const userId = await verifyLoginLink(
    { db: createDb(env.DB), config: loginConfigFromEnv(env) }, form.get('token'), Date.now(), lang,
  )
  if (userId === null) return { error: dict[lang].verify.expired }
  const { getSession, commitSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession()
  session.set('userId', userId)
  const headers = new Headers()
  headers.append('Set-Cookie', await commitSession(session))
  headers.append('Set-Cookie', localeCookie(lang))
  return redirect('/', { headers })
}

export default function LoginVerify({ loaderData }: Route.ComponentProps) {
  const data = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  const t = dict[loaderData.lang].verify
  return (
    <main className="page">
      <h1>AI Cards</h1>
      {data?.error ? (
        <>
          <p className="error">{data.error}</p>
          <Link to="/login">{t.sendNew}</Link>
        </>
      ) : (
        <Form method="post">
          <input type="hidden" name="token" value={loaderData.token} />
          <input type="hidden" name="lang" value={loaderData.lang} />
          <button type="submit" disabled={busy} autoFocus>{busy ? t.loggingIn : t.logIn}</button>
        </Form>
      )}
    </main>
  )
}
