import { drizzle } from 'drizzle-orm/d1'
import { eq, lte, and, desc, asc, count, isNull, isNotNull, gt, gte, min, sum, ne } from 'drizzle-orm'
import * as schema from './schema'
import { cards, reviewLog, dayLog, settings, users, loginTokens, usageLog, creditGrants, OWNER_USER_ID, type Card } from './schema'
import { newCardSrs, schedule, type Grade } from '../lib/srs'
import { dayKey } from '../lib/streak'
import type { CardContent, DecodePart, UsageEvent } from '../lib/ai'

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}
export type Db = ReturnType<typeof createDb>
export type { Card }

// Every function taking `userId` only sees and touches that user's rows; a card id
// belonging to someone else behaves exactly like a missing one.
const ownCard = (userId: number, id: number) => and(eq(cards.userId, userId), eq(cards.id, id))

export async function insertPendingCard(db: Db, userId: number, word: string, now: number): Promise<number> {
  const srs = newCardSrs(now)
  const [row] = await db
    .insert(cards)
    .values({ userId, word, status: 'pending', createdAt: now, ...srs })
    .returning({ id: cards.id })
  return row.id
}

// markReady/markFailed are pipeline-internal: the card id was already resolved for its owner
export async function markReady(db: Db, id: number, content: CardContent, audioKey: string | null) {
  await db.update(cards).set({ ...content, audioKey, status: 'ready' }).where(eq(cards.id, id))
}

export async function markFailed(db: Db, id: number) {
  await db.update(cards).set({ status: 'failed' }).where(eq(cards.id, id))
}

export async function getCard(db: Db, userId: number, id: number): Promise<Card | undefined> {
  return (await db.select().from(cards).where(ownCard(userId, id)))[0]
}

export async function listCards(db: Db, userId: number): Promise<Card[]> {
  return db.select().from(cards).where(eq(cards.userId, userId)).orderBy(desc(cards.createdAt))
}

const dueCondition = (userId: number, now: number) =>
  and(eq(cards.userId, userId), eq(cards.status, 'ready'), isNotNull(cards.firstLearnedAt), lte(cards.dueAt, now))

export async function countCardsCreatedSince(db: Db, userId: number, since: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.createdAt, since)))
  return row.n
}

export async function getDueCards(db: Db, userId: number, now: number): Promise<Card[]> {
  return db
    .select()
    .from(cards)
    .where(dueCondition(userId, now))
    .orderBy(asc(cards.dueAt))
}

export async function countDue(db: Db, userId: number, now: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cards)
    .where(dueCondition(userId, now))
  return row.n
}

export async function nextDueAt(db: Db, userId: number, after: number): Promise<number | null> {
  const [row] = await db
    .select({ at: min(cards.dueAt) })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.status, 'ready'), isNotNull(cards.firstLearnedAt), gt(cards.dueAt, after)))
  return row.at ?? null
}

const newCardCondition = (userId: number) =>
  and(eq(cards.userId, userId), eq(cards.status, 'ready'), isNull(cards.firstLearnedAt), isNotNull(cards.decodeParts))

export async function getNewCards(db: Db, userId: number): Promise<Card[]> {
  return db.select().from(cards).where(newCardCondition(userId)).orderBy(asc(cards.createdAt))
}

export async function countNew(db: Db, userId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(cards).where(newCardCondition(userId))
  return row.n
}

export async function completeFirstLearning(db: Db, userId: number, cardId: number, now: number): Promise<boolean> {
  const updated = await db
    .update(cards)
    .set({ firstLearnedAt: now, ...newCardSrs(now) })
    .where(and(ownCard(userId, cardId), eq(cards.status, 'ready'), isNull(cards.firstLearnedAt), isNotNull(cards.decodeParts)))
    .returning({ id: cards.id })
  return updated.length === 1
}

export async function applyReview(
  db: Db, userId: number, cardId: number, grade: Grade,
  mode: 'flip' | 'write', typed: string | null, now: number,
): Promise<void> {
  const card = await getCard(db, userId, cardId)
  if (!card || card.status !== 'ready' || card.firstLearnedAt === null) return
  const next = schedule({ dueAt: card.dueAt, intervalDays: card.intervalDays, ease: card.ease }, grade, now)
  await db.update(cards).set(next).where(eq(cards.id, cardId))
  await db.insert(reviewLog).values({ cardId, reviewedAt: now, mode, grade, typed })

  const today = dayKey(now)
  const dueLeft = await countDue(db, userId, now)
  const reviewsToday = await countReviewsOn(db, userId, today)
  if (dueLeft === 0 || reviewsToday >= 10) {
    await db.insert(dayLog).values({ userId, date: today }).onConflictDoNothing()
  }
}

export async function countReviewsOn(db: Db, userId: number, day: string): Promise<number> {
  // small per-user volumes: reading the user's log and filtering by Warsaw day is fine
  const rows = await db
    .select({ reviewedAt: reviewLog.reviewedAt })
    .from(reviewLog)
    .innerJoin(cards, eq(reviewLog.cardId, cards.id))
    .where(eq(cards.userId, userId))
  return rows.filter((r) => dayKey(r.reviewedAt) === day).length
}

export async function completedDays(db: Db, userId: number): Promise<string[]> {
  return (await db.select().from(dayLog).where(eq(dayLog.userId, userId))).map((r) => r.date).sort()
}

export async function isDayDone(db: Db, userId: number, day: string): Promise<boolean> {
  return (await db.select().from(dayLog).where(and(eq(dayLog.userId, userId), eq(dayLog.date, day)))).length > 0
}

export async function getSetting(db: Db, userId: number, key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, key)))
  return row?.value ?? null
}

export async function setSetting(db: Db, userId: number, key: string, value: string): Promise<void> {
  await db.insert(settings).values({ userId, key, value }).onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } })
}

export async function updateCardContent(
  db: Db,
  userId: number,
  id: number,
  content: Omit<CardContent, 'decodeParts'> & { decodeParts: DecodePart[] | null },
): Promise<void> {
  await db.update(cards).set(content).where(ownCard(userId, id))
}

export async function deleteCard(db: Db, userId: number, id: number): Promise<void> {
  if (!(await getCard(db, userId, id))) return
  await db.delete(reviewLog).where(eq(reviewLog.cardId, id))
  await db.delete(cards).where(ownCard(userId, id))
}

export async function setAudioKey(db: Db, userId: number, id: number, audioKey: string | null): Promise<void> {
  await db.update(cards).set({ audioKey }).where(ownCard(userId, id))
}

export async function listReviewLog(db: Db, userId: number) {
  return (
    await db.select({ log: reviewLog }).from(reviewLog)
      .innerJoin(cards, eq(reviewLog.cardId, cards.id))
      .where(eq(cards.userId, userId))
      .orderBy(asc(reviewLog.id))
  ).map((r) => r.log)
}

export async function createLoginToken(
  db: Db, tokenHash: string, email: string, now: number, expiresAt: number,
): Promise<void> {
  await db.insert(loginTokens).values({ tokenHash, email, createdAt: now, expiresAt })
}

export async function countLoginTokensSince(db: Db, email: string, since: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, since)))
  return row.n
}

// Marks the token used and returns its email, or null if unknown, expired or already used.
// The guarded UPDATE makes a double submit (or a replay) lose the race instead of logging in twice.
export async function consumeLoginToken(db: Db, tokenHash: string, now: number): Promise<string | null> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, tokenHash), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning({ email: loginTokens.email })
  return row?.email ?? null
}

// The owner's row predates emails; the first login with ownerEmail claims it.
// A brand-new account starts with `starterMicros` of credit.
export async function findOrCreateUser(
  db: Db, email: string, ownerEmail: string | null, now: number, starterMicros: number,
): Promise<number> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (existing) return existing.id
  if (ownerEmail && email === ownerEmail) {
    const [claimed] = await db
      .update(users)
      .set({ email })
      .where(and(eq(users.id, OWNER_USER_ID), isNull(users.email)))
      .returning({ id: users.id })
    if (claimed) return claimed.id
  }
  const inserted = await db.insert(users).values({ email, createdAt: now }).onConflictDoNothing().returning({ id: users.id })
  if (inserted.length === 0) { // lost a race with a parallel first login; that one granted the pool
    const [created] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    return created.id
  }
  const id = inserted[0].id
  if (id !== OWNER_USER_ID) await grantCredits(db, id, starterMicros, 'starter', now)
  return id
}

export async function isEmailBlocked(db: Db, email: string): Promise<boolean> {
  const [row] = await db.select({ blockedAt: users.blockedAt }).from(users).where(eq(users.email, email))
  return row?.blockedAt != null
}

export async function isUserBlocked(db: Db, userId: number): Promise<boolean> {
  const [row] = await db.select({ blockedAt: users.blockedAt }).from(users).where(eq(users.id, userId))
  return row?.blockedAt != null
}

export async function hasAccount(db: Db, email: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  return row !== undefined
}

// The owner can't be blocked; returns false for the owner or an unknown id.
export async function setBlocked(db: Db, userId: number, blockedAt: number | null): Promise<boolean> {
  if (userId === OWNER_USER_ID) return false
  const updated = await db.update(users).set({ blockedAt }).where(eq(users.id, userId)).returning({ id: users.id })
  return updated.length === 1
}

// Sign-ups only: the owner's row isn't one.
export async function countUsersCreatedSince(db: Db, since: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(and(gte(users.createdAt, since), ne(users.id, OWNER_USER_ID)))
  return row.n
}

export async function recordUsage(db: Db, userId: number, event: UsageEvent, now: number): Promise<void> {
  await db.insert(usageLog).values({ userId, createdAt: now, ...event })
}

export async function grantCredits(
  db: Db, userId: number, amountMicros: number, reason: 'starter' | 'admin' | 'purchase', now: number,
): Promise<void> {
  await db.insert(creditGrants).values({ userId, createdAt: now, amountMicros, reason })
}

export type Balance = { grantedMicros: number; spentMicros: number; balanceMicros: number }

// Computed on read so there is no counter to drift; per-user scans are fine at this scale.
export async function getBalance(db: Db, userId: number): Promise<Balance> {
  const [granted] = await db.select({ n: sum(creditGrants.amountMicros) }).from(creditGrants).where(eq(creditGrants.userId, userId))
  const [spent] = await db.select({ n: sum(usageLog.costMicros) }).from(usageLog).where(eq(usageLog.userId, userId))
  const grantedMicros = Number(granted?.n ?? 0)
  const spentMicros = Number(spent?.n ?? 0)
  return { grantedMicros, spentMicros, balanceMicros: grantedMicros - spentMicros }
}

export type UserWithUsage = { id: number; email: string | null; createdAt: number; blockedAt: number | null } & Balance

export async function listUsersWithUsage(db: Db): Promise<UserWithUsage[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, createdAt: users.createdAt, blockedAt: users.blockedAt })
    .from(users)
    .orderBy(desc(users.createdAt))
  return Promise.all(rows.map(async (u) => ({ ...u, ...(await getBalance(db, u.id)) })))
}

// Reminder recipients: blocked users get no mail.
export async function listUsers(db: Db): Promise<{ id: number; email: string | null }[]> {
  return db.select({ id: users.id, email: users.email }).from(users).where(isNull(users.blockedAt)).orderBy(asc(users.id))
}

export async function getUserEmail(db: Db, userId: number): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId))
  return row?.email ?? null
}
