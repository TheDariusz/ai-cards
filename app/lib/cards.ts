// A pipeline killed mid-flight (isolate reclaimed) never reaches markFailed, so
// the row is stranded in `pending`. Past this age, treat it as failed and offer Retry.
export const STALE_PENDING_MS = 5 * 60_000

export const isStuck = (c: { status: string; createdAt: number }, now: number) =>
  c.status === 'pending' && now - c.createdAt > STALE_PENDING_MS
