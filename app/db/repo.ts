import { drizzle } from 'drizzle-orm/d1'
import { eq, lte, and, desc, asc, count } from 'drizzle-orm'
import * as schema from './schema'
import { cards, reviewLog, dayLog, type Card } from './schema'
import { newCardSrs, schedule, type Grade } from '../lib/srs'
import { dayKey } from '../lib/streak'
import type { CardContent } from '../lib/ai'

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}
export type Db = ReturnType<typeof createDb>
export type { Card }

export async function insertPendingCard(db: Db, word: string, now: number): Promise<number> {
  const srs = newCardSrs(now)
  const [row] = await db
    .insert(cards)
    .values({ word, status: 'pending', createdAt: now, ...srs })
    .returning({ id: cards.id })
  return row.id
}

export async function markReady(db: Db, id: number, content: CardContent, audioKey: string | null) {
  await db.update(cards).set({ ...content, audioKey, status: 'ready' }).where(eq(cards.id, id))
}

export async function markFailed(db: Db, id: number) {
  await db.update(cards).set({ status: 'failed' }).where(eq(cards.id, id))
}

export async function getCard(db: Db, id: number): Promise<Card | undefined> {
  return (await db.select().from(cards).where(eq(cards.id, id)))[0]
}

export async function listCards(db: Db): Promise<Card[]> {
  return db.select().from(cards).orderBy(desc(cards.createdAt))
}

export async function getDueCards(db: Db, now: number): Promise<Card[]> {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.status, 'ready'), lte(cards.dueAt, now)))
    .orderBy(asc(cards.dueAt))
}

export async function countDue(db: Db, now: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cards)
    .where(and(eq(cards.status, 'ready'), lte(cards.dueAt, now)))
  return row.n
}

export async function applyReview(
  db: Db, cardId: number, grade: Grade,
  mode: 'flip' | 'write', typed: string | null, now: number,
): Promise<void> {
  const card = await getCard(db, cardId)
  if (!card || card.status !== 'ready') return
  const next = schedule({ dueAt: card.dueAt, intervalDays: card.intervalDays, ease: card.ease }, grade, now)
  await db.update(cards).set(next).where(eq(cards.id, cardId))
  await db.insert(reviewLog).values({ cardId, reviewedAt: now, mode, grade, typed })

  const today = dayKey(now)
  const dueLeft = await countDue(db, now)
  // single-user volumes: reading the log and filtering by Warsaw day is fine
  const reviewsToday = (await db.select().from(reviewLog)).filter(
    (r) => dayKey(r.reviewedAt) === today,
  ).length
  if (dueLeft === 0 || reviewsToday >= 10) {
    await db.insert(dayLog).values({ date: today }).onConflictDoNothing()
  }
}

export async function completedDays(db: Db): Promise<string[]> {
  return (await db.select().from(dayLog)).map((r) => r.date).sort()
}

export async function updateCardContent(db: Db, id: number, content: CardContent): Promise<void> {
  await db.update(cards).set(content).where(eq(cards.id, id))
}

export async function deleteCard(db: Db, id: number): Promise<void> {
  await db.delete(reviewLog).where(eq(reviewLog.cardId, id))
  await db.delete(cards).where(eq(cards.id, id))
}

export async function setAudioKey(db: Db, id: number, audioKey: string): Promise<void> {
  await db.update(cards).set({ audioKey }).where(eq(cards.id, id))
}
