import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { users, OWNER_USER_ID } from '../app/db/schema'
import { getBalance, getUserLocale, setBlocked } from '../app/db/repo'
import type { MailMessage } from '../app/lib/mailer'
import {
  DEFAULT_MAX_SIGNUPS_PER_DAY, LINK_TTL_MS, MAX_LINKS_PER_WINDOW, buildLoginEmail, loginConfigFromEnv, normalizeEmail, requestLoginLink, verifyLoginLink,
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

describe('buildLoginEmail', () => {
  it('speaks English for en', () => {
    const m = buildLoginEmail('https://x/l', 'en')
    expect(m.subject).toBe('Login link · AI Cards')
    expect(m.text).toContain('https://x/l')
    expect(m.text).toContain('15 minutes')
  })
  it('keeps the Polish copy for pl', () => {
    const m = buildLoginEmail('https://x/l', 'pl')
    expect(m.subject).toBe('Link do logowania · AI Cards')
    expect(m.text).toBe('Zaloguj się do AI Cards:\nhttps://x/l\n\nLink działa 15 minut i tylko raz. Jeśli to nie Ty, zignoruj tę wiadomość.')
  })
})

describe('magic link login', () => {
  it('carries the language in the link and stores it on the new account', async () => {
    const { db, sent, deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'en@example.com', ORIGIN, NOW, 'en')
    expect(sent[0].msg.text).toMatch(/&lang=en\b/)
    const userId = await verifyLoginLink(deps, tokenOf(), NOW, 'en')
    expect(await getUserLocale(db, userId!)).toBe('en')
  })

  it('mails a one-time link to a new address and signs it up with the starter pool', async () => {
    const { db, sent, deps, tokenOf } = await setup()
    expect(await requestLoginLink(deps, ' Friend@example.com', ORIGIN, NOW, 'pl')).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('friend@example.com')
    expect(sent[0].msg.text).toContain(`${ORIGIN}/login/verify?token=`)

    const userId = await verifyLoginLink(deps, tokenOf(), NOW + 60_000, 'pl')
    expect(userId).not.toBeNull()
    expect(userId).not.toBe(OWNER_USER_ID)
    expect((await getBalance(db, userId!)).grantedMicros).toBe(500_000)
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 61_000, 'pl')).toBeNull() // single use

    // a second link for the same address signs into the same account
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 120_000, 'pl')
    expect(await verifyLoginLink(deps, tokenOf(), NOW + 121_000, 'pl')).toBe(userId)
    expect(await db.select().from(users)).toHaveLength(2) // owner + friend
  })

  it('a blocked address gets no link and its old link stops working', async () => {
    const { sent, deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW, 'pl')
    const palId = await verifyLoginLink(deps, tokenOf(), NOW, 'pl')
    await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 1, 'pl')
    const stale = tokenOf()
    await setBlocked(deps.db, palId!, NOW + 2)
    expect(await verifyLoginLink(deps, stale, NOW + 3, 'pl')).toBeNull()
    expect(await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 4, 'pl')).toBe('blocked')
    expect(sent).toHaveLength(2)
    expect(await requestLoginLink(deps, 'not-an-email', ORIGIN, NOW, 'pl')).toBe('invalid')
  })

  it('caps new accounts per Warsaw day, but existing users and the owner still get in', async () => {
    const { sent, deps, tokenOf } = await setup(loginConfigFromEnv({ OWNER_EMAIL: 'owner@example.com', MAX_SIGNUPS_PER_DAY: '1' }))
    await requestLoginLink(deps, 'first@example.com', ORIGIN, NOW, 'pl')
    expect(await verifyLoginLink(deps, tokenOf(), NOW, 'pl')).not.toBeNull()
    expect(await requestLoginLink(deps, 'second@example.com', ORIGIN, NOW + 1, 'pl')).toBe('signups-full')
    expect(await requestLoginLink(deps, 'first@example.com', ORIGIN, NOW + 2, 'pl')).toBe('sent')
    expect(await requestLoginLink(deps, 'owner@example.com', ORIGIN, NOW + 3, 'pl')).toBe('sent')
    expect(sent.map((m) => m.to)).toEqual(['first@example.com', 'first@example.com', 'owner@example.com'])
    // the next Warsaw day opens up again
    expect(await requestLoginLink(deps, 'second@example.com', ORIGIN, NOW + 86_400_000, 'pl')).toBe('sent')
  })

  it('a link requested while the cap was open fails once the cap filled up', async () => {
    const { deps, tokenOf } = await setup(loginConfigFromEnv({ MAX_SIGNUPS_PER_DAY: '1' }))
    await requestLoginLink(deps, 'a@example.com', ORIGIN, NOW, 'pl')
    const a = tokenOf()
    await requestLoginLink(deps, 'b@example.com', ORIGIN, NOW, 'pl')
    expect(await verifyLoginLink(deps, tokenOf(), NOW, 'pl')).not.toBeNull()
    expect(await verifyLoginLink(deps, a, NOW, 'pl')).toBeNull()
  })

  it('the owner email claims the pre-existing owner account', async () => {
    const { deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'owner@example.com', ORIGIN, NOW, 'pl')
    expect(await verifyLoginLink(deps, tokenOf(), NOW, 'pl')).toBe(OWNER_USER_ID)
  })

  it('rejects expired, malformed and unknown tokens', async () => {
    const { deps, tokenOf } = await setup()
    await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW, 'pl')
    expect(await verifyLoginLink(deps, tokenOf(), NOW + LINK_TTL_MS, 'pl')).toBeNull()
    expect(await verifyLoginLink(deps, 'abc', NOW, 'pl')).toBeNull()
    expect(await verifyLoginLink(deps, 'f'.repeat(64), NOW, 'pl')).toBeNull()
    expect(await verifyLoginLink(deps, undefined, NOW, 'pl')).toBeNull()
  })

  it('caps links per address within the TTL window', async () => {
    const { sent, deps } = await setup()
    for (let i = 0; i < MAX_LINKS_PER_WINDOW; i++) {
      expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + i, 'pl')).toBe('sent')
    }
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + 10, 'pl')).toBe('throttled')
    expect(await requestLoginLink(deps, 'pal@example.com', ORIGIN, NOW + 10, 'pl')).toBe('sent')
    expect(await requestLoginLink(deps, 'friend@example.com', ORIGIN, NOW + LINK_TTL_MS + 1, 'pl')).toBe('sent')
    expect(sent).toHaveLength(MAX_LINKS_PER_WINDOW + 2)
  })
})
