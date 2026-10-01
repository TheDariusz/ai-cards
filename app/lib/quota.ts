import { countCardsCreatedSince, type Db } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import { startOfDay } from './streak'

// Every new card costs an LLM + TTS call on the owner's OpenRouter key.
export const DEFAULT_DAILY_CARD_LIMIT = 20

export function dailyCardLimit(env: { DAILY_CARD_LIMIT?: string }): number {
  const n = Number(env.DAILY_CARD_LIMIT)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CARD_LIMIT
}

// The owner pays for the key, so the owner is never limited. The day is the Warsaw day.
export async function canAddCard(db: Db, userId: number, now: number, limit: number): Promise<boolean> {
  if (userId === OWNER_USER_ID) return true
  return (await countCardsCreatedSince(db, userId, startOfDay(now))) < limit
}
