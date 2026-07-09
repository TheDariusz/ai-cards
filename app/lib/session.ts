import { createCookieSessionStorage, redirect } from 'react-router'

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getSessionStorage(secret: string) {
  return createCookieSessionStorage({
    cookie: {
      name: '__session',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
      secrets: [secret],
    },
  })
}

export async function requireAuth(request: Request, env: Env): Promise<void> {
  const { getSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession(request.headers.get('Cookie'))
  if (session.get('authed') !== true) throw redirect('/login')
}
