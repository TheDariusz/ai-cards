import type { Card } from '../db/schema'
import { dayKey } from './streak'

// A pipeline killed mid-flight (isolate reclaimed) never reaches markFailed, so
// the row is stranded in `pending`. Past this age, treat it as failed and offer Retry.
export const STALE_PENDING_MS = 5 * 60_000

export const isStuck = (c: { status: string; createdAt: number }, now: number) =>
  c.status === 'pending' && now - c.createdAt > STALE_PENDING_MS

// In-memory twin of newCardCondition in app/db/repo.ts: keep the two in sync
export const isNewCard = (card: Pick<Card, 'status' | 'firstLearnedAt' | 'decodeParts'>): boolean =>
  card.status === 'ready' && card.firstLearnedAt === null && card.decodeParts !== null

export type CardStatus = 'pending' | 'failed' | 'new' | 'ready'

// What the user sees: a stuck card counts as failed, a ready card not yet learned is new.
export function cardStatus(card: Pick<Card, 'status' | 'createdAt' | 'firstLearnedAt' | 'decodeParts'>, now: number): CardStatus {
  if (isNewCard(card)) return 'new'
  if (isStuck(card, now)) return 'failed'
  return card.status as CardStatus
}

// How many of `cards` were first learned on the Warsaw day `day` (Learn's and Today's "learned today").
export const countLearnedOn = (cards: Pick<Card, 'firstLearnedAt'>[], day: string): number =>
  cards.filter((c) => c.firstLearnedAt !== null && dayKey(c.firstLearnedAt) === day).length
