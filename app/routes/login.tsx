import { Form, redirect, useActionData, useNavigation } from 'react-router'
import type { Route } from './+types/login'
import { getUserId } from '../lib/session'
import { createDb } from '../db/repo'
import { parseLocale } from '../lib/locale'
import { dict, useT } from '../lib/i18n'
import { LocaleSwitch } from '../welcome/locale-switch'
import { mailSenderFromEnv } from '../lib/resend'
import { loginConfigFromEnv, normalizeEmail, requestLoginLink } from '../lib/login'

export async function loader({ request, context }: Route.LoaderArgs) {
  if ((await getUserId(request, context.cloudflare.env)) !== null) throw redirect('/')
  return null
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const locale = parseLocale(request.headers.get('Cookie'))
  const origin = new URL(request.url).origin
  const config = loginConfigFromEnv(env)
  const email = normalizeEmail(form.get('email')) ?? String(form.get('email'))
  // the visitor sees the same answer either way, so this log is the only place outcomes show up
  const owner = config.ownerEmail === null ? 'OWNER_EMAIL missing/invalid' : email === config.ownerEmail ? 'is owner' : 'not owner'
  try {
    const deps = { db: createDb(env.DB), config, send: mailSenderFromEnv(env, origin) }
    const result = await requestLoginLink(deps, form.get('email'), origin, Date.now(), locale)
    console.log(`login: ${result} for ${email} (${owner})`)
    if (result === 'invalid') return { error: dict[locale].login.invalidEmail }
  } catch (err) {
    // same answer as success, so a failure can't reveal which addresses are on the list
    console.error(`login: sending mail failed for ${email} (${owner})`, err)
  }
  return { sent: true as const }
}

export default function Login() {
  const data = useActionData<typeof action>()
  const busy = useNavigation().state !== 'idle'
  const t = useT().login
  return (
    <main className="page">
      <LocaleSwitch />
      <h1>AI Cards</h1>
      <p className="muted">{t.intro}</p>
      {data && 'sent' in data ? (
        <p className="ok">{t.sent}</p>
      ) : (
        <Form method="post">
          <input type="email" name="email" placeholder={t.emailPlaceholder} autoComplete="email" required autoFocus />
          <button type="submit" disabled={busy}>{busy ? t.sending : t.send}</button>
          {data && 'error' in data && <p className="error">{data.error}</p>}
        </Form>
      )}
    </main>
  )
}
