import { drizzle } from 'drizzle-orm/d1'
import { eq, lte, and, desc, asc, count } from 'drizzle-orm'
import * as schema from './schema'
import { cards, type Card } from './schema'
import { newCardSrs } from '../lib/srs'
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
