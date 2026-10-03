import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { users, OWNER_USER_ID } from '../app/db/schema'
import { getBalance, setBlocked } from '../app/db/repo'
import type { MailMessage } from '../app/lib/mailer'
import {
  DEFAULT_MAX_SIGNUPS_PER_DAY, LINK_TTL_MS, MAX_LINKS_PER_WINDOW, loginConfigFromEnv, normalizeEmail, requestLoginLink, verifyLoginLink,
} from '../app/lib/login'

const NOW = Date.parse('2026-10-01T10:00:00Z')
const ORIGIN = 'https://cards.example'
const config = loginConfigFromEnv({ OWNER_EMAIL: 'Owner@Example.com' })

async function setup(cfg = config) {
  const db = testDb()
  const sent: { to: string; msg: MailMessage }[] = []
  const deps = { db, config: cfg, send: async (to: string, msg: MailMessage) => { sent.push({ to, msg }) } }
  const tokenOf = (i = sent.length - 1) => /token=([0-9a-f]{64})/.exec(sent[i].msg.text)![1]
  return { db, sent, deps, tokenOf }
}

describe('loginConfigFromEnv', () => {
  it('normalizes the owner email and tolerates a missing one', () => {
    expect(config.ownerEmail).toBe('owner@example.com')
    expect(loginConfigFromEnv({})).toEqual({ ownerEmail: null, maxSignupsPerDay: DEFAULT_MAX_SIGNUPS_PER_DAY, starterMicros: 500_000 })
  })

  it('reads the sign-up cap and starter credits', () => {
    expect(loginConfigFromEnv({ MAX_SIGNUPS_PER_DAY: '3', STARTER_CREDITS: '100' })).toMatchObject({ maxSignupsPerDay: 3, starterMicros: 100_000 })
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
  it('mails a one-time link to a new address and signs it up with the starter pool', async () => {
    const { db, sent, deps, tokenOf } = await setup()
    expect(await requestLoginLink(deps, ' Friend@example.com', ORIGIN, NOW)).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('friend@example.com')
    expect(sent[0].msg.text).toContain(`${ORIGIN}/login/verify?token=`)

    const userId = await verifyLoginLink(deps, tokenOf(), NOW + 60_000)
    expect(userId).not.toBeNull()
    expect(userId).not.toBe(OWNER_USER_ID)
    expect((await getBalance(db, userId!)).grantedMicros).toBe(500_000)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 61_000)).toBeNull() // single use

    // a second link for the same address signs into the same account
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 120_000)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 121_000)).toBe(userId)
    expect(await db.select().from(users)).toHaveLength(2) // owner + friend
  })

  it('a blocked address gets no link and its old link stops working', async () => {
    const { sent, deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW)
    const palId = await verifyLoginLink(deps, tokenOf(), NOW)
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 1)
    const stale = tokenOf()
    await setBlocked(deps.db, palId!, NOW + 2)
    expect(await verifyLoginLink(deps, stale, NOW + 3)).toBeNull()
    expect(await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 4)).toBe('blocked')
    expect(sent).toHaveLength(2)
    expect(await requestLoginLink(deps, 'not-an-email', ORIGIN, NOW)).toBe('invalid')
  })

  it('caps new accounts per Warsaw day, but existing users and the owner still get in', async () => {
    const { sent, deps, tokenOf } = await setup(loginConfigFromEnv({ OWNER_EMAIL: 'owner@example.com', MAX_SIGNUPS_PER_DAY: '1' }))
    await requestLoginLink(deps, 'first@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW)).not.toBeNull()
    expect(await requestLoginLink(deps, 'second@example.com', ORIGIN, NOW + 1)).toBe('signups-full')
    expect(await requestLoginLink(deps, 'first@example.com', ORIGIN, NOW + 2)).toBe('sent')
    expect(await requestLoginLink(deps, 'owner@example.com', ORIGIN, NOW + 3)).toBe('sent')
    expect(sent.map((m) => m.to)).toEqual(['first@example.com', 'first@example.com', 'owner@example.com'])
    // the next Warsaw day opens up again
    expect(await requestLoginLink(deps, 'second@example.com', ORIGIN, NOW + 86_400_000)).toBe('sent')
  })

  it('a link requested while the cap was open fails once the cap filled up', async () => {
    const { deps, tokenOf } = await setup(loginConfigFromEnv({ MAX_SIGNUPS_PER_DAY: '1' }))
    await requestLoginLink(deps, 'a@example.com', ORIGIN, NOW)
    const a = tokenOf()
    await requestLoginLink(deps, 'b@example.com', ORIGIN, NOW)
    expect(await verifyLoginLink(deps, tokenOf(), NOW)).not.toBeNull()
    expect(await verifyLoginLink(deps, a, NOW)).toBeNull()
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
