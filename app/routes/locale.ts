import { redirect } from 'react-router'
import type { Route } from './+types/locale'
import { getUserId } from '../lib/session'
import { createDb, setUserLocale } from '../db/repo'
import { localeCookie, toLocale } from '../lib/locale'
import { safeRedirect } from '../lib/theme'

// Public: the landing and login pages need the switch too
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const locale = toLocale(form.get('locale'))
  const userId = await getUserId(request, env)
  if (userId !== null) await setUserLocale(createDb(env.DB), userId, locale)
  return redirect(safeRedirect(form.get('redirectTo')), { headers: { 'Set-Cookie': localeCookie(locale) } })
}
