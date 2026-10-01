import { redirect } from 'react-router'
import type { Route } from './+types/logout'
import { getSessionStorage } from '../lib/session'

export async function action({ request, context }: Route.ActionArgs) {
  const { getSession, destroySession } = getSessionStorage(context.cloudflare.env.SESSION_SECRET)
  const session = await getSession(request.headers.get('Cookie'))
  return redirect('/login', { headers: { 'Set-Cookie': await destroySession(session) } })
}
