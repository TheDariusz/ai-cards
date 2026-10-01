import { consumeLoginToken, countLoginTokensSince, createLoginToken, findOrCreateUser, type Db } from '../db/repo'
import type { MailMessage } from './mailer'
import { sha256Hex } from './session'

export const LINK_TTL_MS = 15 * 60_000
// per address, within one TTL window: enough for "didn't arrive, send again", not for mail-bombing
export const MAX_LINKS_PER_WINDOW = 3

export type LoginConfig = { allowed: Set<string>; ownerEmail: string | null }

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

// ALLOWED_EMAILS is comma/whitespace separated; the owner is always allowed.
export function loginConfigFromEnv(env: { ALLOWED_EMAILS?: string; OWNER_EMAIL?: string }): LoginConfig {
  const ownerEmail = normalizeEmail(env.OWNER_EMAIL)
  const allowed = new Set(
    (env.ALLOWED_EMAILS ?? '').split(/[\s,]+/).map(normalizeEmail).filter((e): e is string => e !== null),
  )
  if (ownerEmail) allowed.add(ownerEmail)
  return { allowed, ownerEmail }
}

export function buildLoginEmail(link: string): MailMessage {
  return {
    subject: 'Link do logowania · AI Cards',
    text: `Zaloguj się do AI Cards:\n${link}\n\nLink działa 15 minut i tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.`,
    html: `<p><a href="${link}">Zaloguj się do AI Cards</a></p>`
      + '<p>Link działa 15 minut i tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.</p>',
  }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type LinkDeps = {
  db: Db
  config: LoginConfig
  send: (to: string, msg: MailMessage) => Promise<void>
}
// 'ignored' (not on the list) must look the same as 'sent' to the visitor
export type LinkResult = 'sent' | 'ignored' | 'throttled' | 'invalid'

export async function requestLoginLink(
  deps: LinkDeps, rawEmail: unknown, origin: string, now: number,
): Promise<LinkResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return 'invalid'
  if (!deps.config.allowed.has(email)) return 'ignored'
  if ((await countLoginTokensSince(deps.db, email, now - LINK_TTL_MS)) >= MAX_LINKS_PER_WINDOW) return 'throttled'
  const token = newToken()
  await createLoginToken(deps.db, await sha256Hex(token), email, now, now + LINK_TTL_MS)
  await deps.send(email, buildLoginEmail(`${origin}/login/verify?token=${token}`))
  return 'sent'
}

// Returns the user id to sign in, or null for an unknown/expired/used token or a
// no-longer-allowed address.
export async function verifyLoginLink(
  deps: Pick<LinkDeps, 'db' | 'config'>, token: unknown, now: number,
): Promise<number | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const email = await consumeLoginToken(deps.db, await sha256Hex(token), now)
  if (!email || !deps.config.allowed.has(email)) return null
  return findOrCreateUser(deps.db, email, deps.config.ownerEmail, now)
}
