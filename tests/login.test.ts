import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { users, OWNER_USER_ID } from '../app/db/schema'
import { createAccessRequest, decideAccessRequest, listAccessRequests } from '../app/db/repo'
import type { MailMessage } from '../app/lib/mailer'
import {
  LINK_TTL_MS, MAX_LINKS_PER_WINDOW, MAX_PENDING_REQUESTS, loginConfigFromEnv, normalizeEmail, requestLoginLink, verifyLoginLink,
} from '../app/lib/login'

const NOW = Date.parse('2026-10-01T10:00:00Z')
const ORIGIN = 'https://cards.example'
const config = loginConfigFromEnv({ OWNER_EMAIL: 'Owner@Example.com' })

async function setup() {
  const db = testDb()
  for (const email of ['friend@example.com', 'pal@example.com']) {
    await createAccessRequest(db, email, NOW - 1)
    await decideAccessRequest(db, email, 'approved', NOW - 1)
  }
  const sent: { to: string; msg: MailMessage }[] = []
  const deps = { db, config, send: async (to: string, msg: MailMessage) => { sent.push({ to, msg }) } }
  const tokenOf = (i = sent.length - 1) => /token=([0-9a-f]{64})/.exec(sent[i].msg.text)![1]
  return { db, sent, deps, tokenOf }
}

describe('loginConfigFromEnv', () => {
  it('normalizes the owner email and tolerates a missing one', () => {
    expect(config.ownerEmail).toBe('owner@example.com')
    expect(loginConfigFromEnv({})).toEqual({ ownerEmail: null })
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases valid addresses, rejects the rest', () => {
    expect(normalizeEmail('  A@B.co ')).toBe('a@b.co')
    expect(normalizeEmail('nope')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})

describe('magic link login', () => {
  it('mails a one-time link to an allowed address and signs a new user in with it', async () => {
    const { db, sent, deps, tokenOf } = await setup()
    expect(await requestLoginLink(deps, ' Friend@example.com', ORIGIN, NOW)).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('friend@example.com')
    expect(sent[0].msg.text).toContain(`${ORIGIN}/login/verify?token=`)

    const userId = await verifyLoginLink(deps, tokenOf(), NOW + 60_000)
    expect(userId).not.toBeNull()
    expect(userId).not.toBe(OWNER_USER_ID)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 61_000)).toBeNull() // single use

    // a second link for the same address signs into the same account
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 120_000)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 121_000)).toBe(userId)
    expect(await db.select().from(users)).toHaveLength(2) // owner + friend
  })

  it('an unknown address files an access request and only the owner is mailed', async () => {
    const { db, sent, deps } = await setup()
    expect(await requestLoginLink(deps, 'Stranger@example.com', ORIGIN, NOW)).toBe('requested')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('owner@example.com')
    expect(sent[0].msg.text).toContain('stranger@example.com')
    expect(sent[0].msg.text).toContain(`${ORIGIN}/admin`)
    expect((await listAccessRequests(db)).find((r) => r.email === 'stranger@example.com')?.status).toBe('pending')

    // asking again doesn't re-notify; no link either way
    expect(await requestLoginLink(deps, 'stranger@example.com', ORIGIN, NOW + 1)).toBe('ignored')
    expect(sent).toHaveLength(1)
    expect(await requestLoginLink(deps, 'not-an-email', ORIGIN, NOW)).toBe('invalid')
  })

  it('approving a request lets the address log in; rejecting does not', async () => {
    const { sent, deps, db, tokenOf } = await setup()
    await requestLoginLink(deps, 'new@example.com', ORIGIN, NOW)
    await requestLoginLink(deps, 'nope@example.com', ORIGIN, NOW)
    await decideAccessRequest(db, 'new@example.com', 'approved', NOW)
    await decideAccessRequest(db, 'nope@example.com', 'rejected', NOW)
    sent.length = 0

    expect(await requestLoginLink(deps, 'new@example.com', ORIGIN, NOW + 1)).toBe('sent')
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 2)).not.toBeNull()
    expect(await requestLoginLink(deps, 'nope@example.com', ORIGIN, NOW + 1)).toBe('ignored')
    expect(sent.map((m) => m.to)).toEqual(['new@example.com'])
  })

  it('reports a missing OWNER_EMAIL instead of silently dropping the request', async () => {
    const { sent, deps } = await setup()
    const noOwner = { ...deps, config: loginConfigFromEnv({ OWNER_EMAIL: '"owner@example.com" <x' }) }
    expect(await requestLoginLink(noOwner, 'someone@example.com', ORIGIN, NOW)).toBe('no-owner')
    expect(sent).toHaveLength(0)
  })

  it('drops new requests while too many are undecided', async () => {
    const { sent, deps } = await setup()
    for (let i = 0; i < MAX_PENDING_REQUESTS; i++) await requestLoginLink(deps, `s${i}@example.com`, ORIGIN, NOW)
    expect(await requestLoginLink(deps, 'late@example.com', ORIGIN, NOW)).toBe('ignored')
    expect(sent).toHaveLength(MAX_PENDING_REQUESTS)
  })

  it('the owner email claims the pre-existing owner account', async () => {
    const { deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'owner@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW)).toBe(OWNER_USER_ID)
  })

  it('rejects expired, malformed and unknown tokens', async () => {
    const { deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + LINK_TTL_MS)).toBeNull()
    expect(await verifyLoginLink(deps, 'abc', NOW)).toBeNull()
    expect(await verifyLoginLink(deps, 'f'.repeat(64), NOW)).toBeNull()
    expect(await verifyLoginLink(deps, undefined, NOW)).toBeNull()
  })

  it('rejects a link for an address revoked after it was sent', async () => {
    const { db, deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW)
    await decideAccessRequest(db, 'pal@example.com', 'rejected', NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW)).toBeNull()
  })

  it('caps links per address within the TTL window', async () => {
    const { sent, deps } = await setup()
    for (let i = 0; i < MAX_LINKS_PER_WINDOW; i++) {
      expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + i)).toBe('sent')
    }
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 10)).toBe('throttled')
    expect(await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 10)).toBe('sent')
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + LINK_TTL_MS + 1)).toBe('sent')
    expect(sent).toHaveLength(MAX_LINKS_PER_WINDOW + 2)
  })
})
