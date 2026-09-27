import { redirect } from 'react-router'
import type { Route } from './+types/theme'
import { requireAuth } from '../lib/session'
import { safeRedirect, themeCookie, toThemePref } from '../lib/theme'

export async function action({ request, context }: Route.ActionArgs) {
  await requireAuth(request, context.cloudflare.env)
  const form = await request.formData()
  const pref = toThemePref(form.get('theme'))
  return redirect(safeRedirect(form.get('redirectTo')), { headers: { 'Set-Cookie': themeCookie(pref) } })
}
