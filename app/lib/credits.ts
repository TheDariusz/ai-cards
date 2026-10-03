import { getBalance, recordUsage, type Db } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import type { UsageEvent } from './ai'

export const MICROS_PER_CREDIT = 1_000 // 1 credit = $0.001
export const DEFAULT_STARTER_CREDITS = 500
export const NO_CREDITS_MESSAGE = 'Out of credits — new cards and AI features are unavailable.'

export function starterMicros(env: { STARTER_CREDITS?: string }): number {
  const n = Number(env.STARTER_CREDITS)
  return (Number.isInteger(n) && n >= 0 ? n : DEFAULT_STARTER_CREDITS) * MICROS_PER_CREDIT
}

// A balance slightly below zero (the last call is charged after it ran) shows as 0.
export function toCredits(micros: number): number {
  return Math.max(0, Math.floor(micros / MICROS_PER_CREDIT))
}

// The owner pays for the key, so the owner is never limited.
export async function hasCredits(db: Db, userId: number): Promise<boolean> {
  if (userId === OWNER_USER_ID) return true
  return (await getBalance(db, userId)).balanceMicros > 0
}

// The onUsage callback for aiFromEnv: charges `userId`. A failed write is logged, never surfaced —
// the user's action already happened and shouldn't fail on bookkeeping.
export function usageRecorder(db: Db, userId: number) {
  return async (event: UsageEvent) => {
    try {
      await recordUsage(db, userId, event, Date.now())
    } catch (err) {
      console.error(`usage: recording failed for user ${userId}`, event, err)
    }
  }
}
