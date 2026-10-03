import { createCookieSessionStorage, redirect } from 'react-router'
import { OWNER_USER_ID } from '../db/schema'
import { createDb, isUserBlocked } from '../db/repo'

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

type SessionData = { userId?: unknown; authed?: unknown }

// Cookies issued before multi-user carry only `authed: true`; they belong to the owner.
export function sessionUserId(data: SessionData): number | null {
  if (typeof data.userId === 'number' && Number.isInteger(data.userId) && data.userId > 0) return data.userId
  if (data.authed === true) return OWNER_USER_ID
  return null
}

export async function getUserId(request: Request, env: Env): Promise<number | null> {
  const { getSession } = getSessionStorage(env.SESSION_SECRET)
  const session = await getSession(request.headers.get('Cookie'))
  return sessionUserId({ userId: session.get('userId'), authed: session.get('authed') })
}

// A blocked user's cookie is cleared, so blocking ends sessions that already exist.
export async function requireAuth(request: Request, env: Env): Promise<number> {
  const userId = await getUserId(request, env)
  if (userId === null) throw redirect('/login')
  if (await isUserBlocked(createDb(env.DB), userId)) {
    const { getSession, destroySession } = getSessionStorage(env.SESSION_SECRET)
    const session = await getSession(request.headers.get('Cookie'))
    throw redirect('/login', { headers: { 'Set-Cookie': await destroySession(session) } })
  }
  return userId
}
