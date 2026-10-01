import {
  consumeLoginToken, countLoginTokensSince, countPendingRequests, createAccessRequest, createLoginToken,
  findOrCreateUser, isApproved, type Db,
} from '../db/repo'
import type { MailMessage } from './mailer'
import { sha256Hex } from './session'

export const LINK_TTL_MS = 15 * 60_000
// per address, within one TTL window: enough for "didn't arrive, send again", not for mail-bombing
export const MAX_LINKS_PER_WINDOW = 3
// beyond this many undecided requests new ones are dropped, so a flood can't bury the owner's inbox
export const MAX_PENDING_REQUESTS = 20

export type LoginConfig = { ownerEmail: string | null }

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export function loginConfigFromEnv(env: { OWNER_EMAIL?: string }): LoginConfig {
  return { ownerEmail: normalizeEmail(env.OWNER_EMAIL) }
}

// The owner always; anyone else once the owner approved their request.
export async function isAllowed(db: Db, config: LoginConfig, email: string): Promise<boolean> {
  return email === config.ownerEmail || isApproved(db, email)
}

export function buildLoginEmail(link: string): MailMessage {
  return {
    subject: 'Link do logowania · AI Cards',
    text: `Zaloguj się do AI Cards:\n${link}\n\nLink działa 15 minut i tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.`,
    html: `<p><a href="${link}">Zaloguj się do AI Cards</a></p>`
      + '<p>Link działa 15 minut i tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.</p>',
  }
}

export function buildAccessRequestEmail(email: string, adminUrl: string): MailMessage {
  return {
    subject: `Prośba o dostęp · ${email}`,
    text: `${email} prosi o dostęp do AI Cards.\nZatwierdź lub odrzuć: ${adminUrl}`,
    html: `<p>${escapeHtml(email)} prosi o dostęp do AI Cards.</p><p><a href="${adminUrl}">Zatwierdź lub odrzuć</a></p>`,
  }
}

export function buildApprovedEmail(loginUrl: string): MailMessage {
  return {
    subject: 'Masz dostęp do AI Cards',
    text: `Twoja prośba o dostęp została zaakceptowana. Zaloguj się: ${loginUrl}`,
    html: `<p>Twoja prośba o dostęp została zaakceptowana.</p><p><a href="${loginUrl}">Zaloguj się</a></p>`,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
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
// everything but 'invalid' must look the same to the visitor, so nobody can probe who has access
export type LinkResult = 'sent' | 'requested' | 'ignored' | 'throttled' | 'invalid'

export async function requestLoginLink(
  deps: LinkDeps, rawEmail: unknown, origin: string, now: number,
): Promise<LinkResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return 'invalid'
  if (!(await isAllowed(deps.db, deps.config, email))) return requestAccess(deps, email, origin, now)
  if ((await countLoginTokensSince(deps.db, email, now - LINK_TTL_MS)) >= MAX_LINKS_PER_WINDOW) return 'throttled'
  const token = newToken()
  await createLoginToken(deps.db, await sha256Hex(token), email, now, now + LINK_TTL_MS)
  await deps.send(email, buildLoginEmail(`${origin}/login/verify?token=${token}`))
  return 'sent'
}

async function requestAccess(deps: LinkDeps, email: string, origin: string, now: number): Promise<LinkResult> {
  const owner = deps.config.ownerEmail
  if (!owner || (await countPendingRequests(deps.db)) >= MAX_PENDING_REQUESTS) return 'ignored'
  if (!(await createAccessRequest(deps.db, email, now))) return 'ignored' // already pending or decided
  await deps.send(owner, buildAccessRequestEmail(email, `${origin}/admin`))
  return 'requested'
}

// Returns the user id to sign in, or null for an unknown/expired/used token or a
// no-longer-allowed address.
export async function verifyLoginLink(
  deps: Pick<LinkDeps, 'db' | 'config'>, token: unknown, now: number,
): Promise<number | null> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const email = await consumeLoginToken(deps.db, await sha256Hex(token), now)
  if (!email || !(await isAllowed(deps.db, deps.config, email))) return null
  return findOrCreateUser(deps.db, email, deps.config.ownerEmail, now)
}
