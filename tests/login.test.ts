import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { users, OWNER_USER_ID } from '../app/db/schema'
import type { MailMessage } from '../app/lib/mailer'
import {
  LINK_TTL_MS, MAX_LINKS_PER_WINDOW, loginConfigFromEnv, normalizeEmail, requestLoginLink, verifyLoginLink,
} from '../app/lib/login'

const NOW = Date.parse('2026-10-01T10:00:00Z')
const ORIGIN = 'https://cards.example'
const config = loginConfigFromEnv({ OWNER_EMAIL: 'Owner@Example.com', ALLOWED_EMAILS: 'friend@example.com,  pal@example.com' })

function setup() {
  const db = testDb()
  const sent: { to: string; msg: MailMessage }[] = []
  const deps = { db, config, send: async (to: string, msg: MailMessage) => { sent.push({ to, msg }) } }
  const tokenOf = (i = sent.length - 1) => /token=([0-9a-f]{64})/.exec(sent[i].msg.text)![1]
  return { db, sent, deps, tokenOf }
}

describe('loginConfigFromEnv', () => {
  it('normalizes the list and always allows the owner', () => {
    expect(config.ownerEmail).toBe('owner@example.com')
    expect([...config.allowed].sort()).toEqual(['friend@example.com', 'owner@example.com', 'pal@example.com'])
  })

  it('tolerates missing vars', () => {
    expect(loginConfigFromEnv({})).toEqual({ allowed: new Set(), ownerEmail: null })
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
    const { db, sent, deps, tokenOf } = setup()
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

  it('sends nothing to an address that is not on the list', async () => {
    const { sent, deps } = setup()
    expect(await requestLoginLink(deps, 'stranger@example.com', ORIGIN, NOW)).toBe('ignored')
    expect(await requestLoginLink(deps, 'not-an-email', ORIGIN, NOW)).toBe('invalid')
    expect(sent).toHaveLength(0)
  })

  it('the owner email claims the pre-existing owner account', async () => {
    const { deps, tokenOf } = setup()
    await requestLoginLink(deps, 'owner@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW)).toBe(OWNER_USER_ID)
  })

  it('rejects expired, malformed and unknown tokens', async () => {
    const { deps, tokenOf } = setup()
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + LINK_TTL_MS)).toBeNull()
    expect(await verifyLoginLink(deps, 'abc', NOW)).toBeNull()
    expect(await verifyLoginLink(deps, 'f'.repeat(64), NOW)).toBeNull()
    expect(await verifyLoginLink(deps, undefined, NOW)).toBeNull()
  })

  it('rejects a link for an address removed from the list after it was sent', async () => {
    const { deps, tokenOf } = setup()
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW)
    const narrowed = { ...deps, config: loginConfigFromEnv({ OWNER_EMAIL: 'owner@example.com' }) }
    expect(await verifyLoginLink(narrowed, tokenOf(), NOW)).toBeNull()
  })

  it('caps links per address within the TTL window', async () => {
    const { sent, deps } = setup()
    for (let i = 0; i < MAX_LINKS_PER_WINDOW; i++) {
      expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + i)).toBe('sent')
    }
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 10)).toBe('throttled')
    expect(await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 10)).toBe('sent')
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + LINK_TTL_MS + 1)).toBe('sent')
    expect(sent).toHaveLength(MAX_LINKS_PER_WINDOW + 2)
  })
})
