import { Form, Link, data, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login-verify'
import { getSessionStorage } from '../lib/session'
import { createDb, getUserLocale } from '../db/repo'
import { dict } from '../lib/i18n'
import { localeCookie, toLocale, type Locale } from '../lib/locale'
import type { Logger } from '../lib/logger'
import { clearBrowserKeyCookie, isRequestingBrowser, loginConfigFromEnv, verifyLoginLink } from '../lib/login'

// GET signs in only in the browser that asked for the link; anywhere else (mail scanners that
// prefetch links, another device) it renders a button, so a prefetch can't burn the one-time token.
export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams
  const token = params.get('token') ?? ''
  const lang = toLocale(params.get('lang'))
  if (await isRequestingBrowser(request.headers.get('Cookie'), token)) {
    const signedIn = await signIn(context.cloudflare.env, context.log, token, lang)
    if (signedIn) throw signedIn
    // the link is spent: drop the cookie so a reload doesn't try it again
    const headers = { 'Set-Cookie': clearBrowserKeyCookie() }
    return data({ token, lang, error: dict[lang].verify.expired }, { headers })
  }
  return { token, lang, error: null }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData()
  const lang = toLocale(form.get('lang'))
  return (await signIn(context.cloudflare.env, context.log, form.get('token'), lang)) ?? { error: dict[lang].verify.expired }
}

// A redirect home with the session set, or null for an unusable link.
async function signIn(env: Env, log: Logger, token: unknown, lang: Locale): Promise<Response | null> {
  const db = createDb(env.DB)
  const verified = await verifyLoginLink({ db, config: loginConfigFromEnv(env) }, token, Date.now(), lang)
  if (verified === null) return null
  const { userId, created } = verified
  // never the email: the id is enough to find the account on /admin
  if (created) log.info('user registered', { event: 'user_registered', user_id: userId })
  const { getSession, commitSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession()
  session.set('userId', userId)
  const headers = new Headers()
  headers.append('Set-Cookie', await commitSession(session))
  headers.append('Set-Cookie', localeCookie(await getUserLocale(db, userId)))
  headers.append('Set-Cookie', clearBrowserKeyCookie())
  return redirect('/', { headers })
}

export default function LoginVerify({ loaderData }: Route.ComponentProps) {
  const answer = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  const t = dict[loaderData.lang].verify
  const error = answer?.error ?? loaderData.error
  return (
    <main className="page" lang={loaderData.lang}>
      <h1>AI Cards</h1>
      {error ? (
        <>
          <p className="error">{error}</p>
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
