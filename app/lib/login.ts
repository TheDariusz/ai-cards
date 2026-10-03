import {
  consumeLoginToken, countLoginTokensSince, countUsersCreatedSince, createLoginToken, findOrCreateUser, hasAccount,
  isEmailBlocked, type Db,
} from '../db/repo'
import { starterMicros } from './credits'
import type { MailMessage } from './mailer'
import { sha256Hex } from './session'
import { startOfDay } from './streak'

export const LINK_TTL_MS = 15 * 60_000
// per address, within one TTL window: enough for "didn't arrive, send again", not for mail-bombing
export const MAX_LINKS_PER_WINDOW = 3
// new accounts per Warsaw day, so a bot can't burn the mail quota and a pile of starter pools
export const DEFAULT_MAX_SIGNUPS_PER_DAY = 20

export type LoginConfig = { ownerEmail: string | null; maxSignupsPerDay: number; starterMicros: number }

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export function loginConfigFromEnv(
  env: { OWNER_EMAIL?: string; MAX_SIGNUPS_PER_DAY?: string; STARTER_CREDITS?: string },
): LoginConfig {
  const n = Number(env.MAX_SIGNUPS_PER_DAY)
  return {
    ownerEmail: normalizeEmail(env.OWNER_EMAIL),
    maxSignupsPerDay: Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_SIGNUPS_PER_DAY,
    starterMicros: starterMicros(env),
  }
}

// Anyone may sign up; the owner can block an address on /admin. The owner is never blocked.
export async function isAllowed(db: Db, config: LoginConfig, email: string): Promise<boolean> {
  return email === config.ownerEmail || !(await isEmailBlocked(db, email))
}

// A new address may create an account only while today's sign-up cap isn't reached.
async function canSignIn(db: Db, config: LoginConfig, email: string, now: number): Promise<boolean> {
  if (!(await isAllowed(db, config, email))) return false
  if (email === config.ownerEmail || (await hasAccount(db, email))) return true
  return (await countUsersCreatedSince(db, startOfDay(now))) < config.maxSignupsPerDay
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
// everything but 'invalid' must look the same to the visitor, so nobody can probe who is blocked;
// the route logs the result so the owner can tell them apart in Workers Logs
export type LinkResult = 'sent' | 'blocked' | 'throttled' | 'signups-full' | 'invalid'

export async function requestLoginLink(
  deps: LinkDeps, rawEmail: unknown, origin: string, now: number,
): Promise<LinkResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return 'invalid'
  if (!(await isAllowed(deps.db, deps.config, email))) return 'blocked'
  if (!(await canSignIn(deps.db, deps.config, email, now))) return 'signups-full'
  if ((await countLoginTokensSince(deps.db, email, now - LINK_TTL_MS)) >= MAX_LINKS_PER_WINDOW) return 'throttled'
  const token = newToken()
  await createLoginToken(deps.db, await sha256Hex(token), email, now, now + LINK_TTL_MS)
  await deps.send(email, buildLoginEmail(`${origin}/login/verify?token=${token}`))
  return 'sent'
}

// Returns the user id to sign in, or null for an unknown/expired/used token, a blocked
// address, or a new address once today's sign-up cap is reached.
export async function verifyLoginLink(
  deps: Pick<LinkDeps, 'db' | 'config'>, token: unknown, now: number,
): Promise<number | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const email = await consumeLoginToken(deps.db, await sha256Hex(token), now)
  if (!email || !(await canSignIn(deps.db, deps.config, email, now))) return null
  return findOrCreateUser(deps.db, email, deps.config.ownerEmail, now, deps.config.starterMicros)
}
