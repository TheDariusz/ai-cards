import { drizzle } from 'drizzle-orm/d1'
import { eq, lte, and, desc, asc, count, isNull, isNotNull, gt, min } from 'drizzle-orm'
import * as schema from './schema'
import { cards, reviewLog, dayLog, settings, type Card } from './schema'
import { newCardSrs, schedule, type Grade } from '../lib/srs'
import { dayKey } from '../lib/streak'
import type { CardContent, DecodePart } from '../lib/ai'

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
