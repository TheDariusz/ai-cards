# Open Sign-up with a Credit Pool — Design

**Date:** 2026-10-03
**Status:** Draft (awaiting owner review)

## Purpose

Today a stranger has to ask for access and wait for the owner to approve them on `/admin`. That approval
step goes away: anyone who confirms the magic link gets an account at once. To keep the owner's
OpenRouter bill bounded, every new account starts with a fixed **credit pool**. Every OpenRouter call made
on a user's behalf (card generation, retry, regeneration with a hint, TTS, answer evaluation) is metered
at its real cost and deducted from that pool. When the pool runs out, everything that costs money stops
and everything that is free (learning, reviews, existing audio, export) keeps working.

This is also the groundwork for payments: a top-up is just another row in `credit_grants`.

Success: a new visitor can sign up and add cards without the owner doing anything; the owner can see what
each user has spent and top them up or block them on `/admin`; no AI call for a non-owner runs while their
balance is ≤ 0.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Unit | Real cost in USD reported by OpenRouter, stored as integer **micro-dollars**; shown as **credits**, 1 credit = $0.001 = 1,000 µ$ |
| Starter pool | **500 credits ($0.50)** per account, `STARTER_CREDITS` in `wrangler.jsonc` vars |
| Owner | Never limited; their usage is still logged so the owner sees real costs |
| Existing accounts | Get the same starter grant in the migration |
| Daily card limit | **Kept** (`DAILY_CARD_LIMIT`) as a second line of defence against multi-account abuse |
| Out of credits | Add / retry / regenerate / "Generate audio" blocked with a message; editing a sentence saves text but skips TTS; answer check falls back to local diff with a note; learning, reviews, audio, export unaffected |
| Over-spend | Balance is checked before a call and charged after it, so the last call may take the balance slightly below zero. Accepted; no reservations |
| Admin | `/admin` becomes a user list: email, joined, spent, balance; actions **+500 credits** and **Block / Unblock** |
| Access requests | Table `access_requests` dropped; rejected addresses become blocked users |
| Abuse guard | Existing 3 links per address per 15 min, plus a global cap of new accounts per Warsaw day, `MAX_SIGNUPS_PER_DAY` (default 20) |

Out of scope (YAGNI): payments, low-balance warnings or emails, per-model price tables, credit expiry,
usage history UI for the learner, reconciling TTS cost through `/api/v1/generation`.

## Metering

### Port

`app/lib/ai.ts` gains a usage event type; the `AiProvider` interface itself is unchanged, so
`pipeline.ts` and its tests stay as they are:

```ts
export type UsageKind = 'card' | 'evaluate' | 'tts'
export interface UsageEvent {
  kind: UsageKind
  model: string
  costMicros: number
  promptTokens: number | null
  completionTokens: number | null
  characters: number | null // TTS input length
  generationId: string | null
}
```

### Adapter

`createOpenRouter(opts)` takes a new `onUsage: (event: UsageEvent) => Promise<void>`. It is called once
per **successful HTTP response**, before the body is validated. OpenRouter bills a response even when it
fails our validation (e.g. bad `decodeParts`), so we charge it too. A non-2xx response or a timeout
records nothing.

- **Chat** (`generateCard`, `evaluateAnswer`): the request adds `usage: { include: true }`; the cost is
  `usage.cost` (USD) × 1e6, rounded up. Tokens come from `usage.prompt_tokens` / `usage.completion_tokens`.
  If `usage.cost` is missing, the adapter logs an error and charges `FALLBACK_CHAT_COST_MICROS`
  (20,000 µ$ = 2¢), so a format change never makes calls free.
- **TTS** (`/audio/speech`): the response is raw audio with no usage body. TTS is priced per input
  character, so cost = `characters × TTS_USD_PER_MILLION_CHARS` (var in `wrangler.jsonc`), rounded up.
  The `X-Generation-Id` header is stored so the cost can be checked against OpenRouter's dashboard later.
  The actual MAI-Voice price must be read from OpenRouter's model page before release.

`aiFromEnv(env, onUsage)` passes it through. Call sites build it with `usageRecorder(db, userId)` from a new
`app/lib/credits.ts`. The adapter awaits the insert before returning, so it finishes inside whichever request or `waitUntil`
made the call. A failed insert is logged and never fails the user's action.

### Call sites (all must pass a recorder and check balance first)

| Route / function | OpenRouter calls |
|---|---|
| `home.tsx` intent `add` | card + TTS (pipeline) |
| `home.tsx` intent `retry` | card + TTS (pipeline) |
| `card-detail.tsx` intent `regenerate` | card + TTS (pipeline) |
| `card-detail.tsx` intent `retry-audio` | TTS |
| `card-detail.tsx` intent `save` (sentence changed) | TTS in background |
| `review-check.ts` | evaluate |

Making `onUsage` a required option means that forgetting a call site is a type error, not a silent leak.

## Data model (`drizzle/0006_*.sql`, via `npx drizzle-kit generate` + hand-written data steps)

```ts
export const usageLog = sqliteTable('usage_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  kind: text('kind', { enum: ['card', 'evaluate', 'tts'] }).notNull(),
  model: text('model').notNull(),
  costMicros: integer('cost_micros').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  characters: integer('characters'),
  generationId: text('generation_id'),
}, (t) => [index('usage_log_user_idx').on(t.userId)])

export const creditGrants = sqliteTable('credit_grants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  amountMicros: integer('amount_micros').notNull(),
  reason: text('reason', { enum: ['starter', 'admin', 'purchase'] }).notNull(),
})

// users gains:
blockedAt: integer('blocked_at'),
```

`'purchase'` is in the enum now so the payments step needs no schema change.

**Balance** = `SUM(credit_grants.amount_micros) − SUM(usage_log.cost_micros)` for the user. It is computed
on read, with no stored counter that could drift. Per-user scans are fine at this scale (same reasoning as
`countReviewsOn`).

**Migration data steps:**
1. `INSERT INTO credit_grants` a starter grant (500,000 µ$, reason `starter`) for every existing user except
   id 1. The amount is a literal in the SQL; later accounts use `STARTER_CREDITS` at runtime.
2. For each `access_requests` row with status `rejected`: set `blocked_at` on the matching user, or insert a
   blocked `users` row if none exists, so that address cannot simply sign up.
3. `DROP TABLE access_requests`.

## Repo (`app/db/repo.ts`, still the only Drizzle file)

- Remove `isApproved`, `createAccessRequest`, `countPendingRequests`, `listAccessRequests`, `decideAccessRequest`.
- `findOrCreateUser(db, email, ownerEmail, now, starterMicros)`: when it creates a user, it also inserts the
  starter grant in the same `db.batch`.
- `isBlocked(db, email)`, `isUserBlocked(db, userId)`, `setBlocked(db, userId, blockedAt | null)`.
- `countUsersCreatedSince(db, since)`.
- `recordUsage(db, userId, event, now)`, `grantCredits(db, userId, amountMicros, reason, now)`.
- `getBalance(db, userId)` → `{ grantedMicros, spentMicros, balanceMicros }`.
- `listUsersWithUsage(db)` for `/admin`: id, email, createdAt, blockedAt, granted, spent.

## Logic (`app/lib/credits.ts`, new)

- `starterCredits(env)`: parses `STARTER_CREDITS` (default 500) and returns µ$. Same pattern as
  `dailyCardLimit`.
- `hasCredits(db, userId)`: `true` for the owner, otherwise `balanceMicros > 0`.
- `usageRecorder(db, userId)` returns the `onUsage` callback.
- `toCredits(micros)` = `Math.floor(micros / 1000)`, used for display (a balance of −3 credits shows as 0).
- `NO_CREDITS_MESSAGE = 'Skończyły się kredyty — nowe karty i funkcje AI są niedostępne.'`

## Login (`app/lib/login.ts`)

- `isAllowed` becomes "not blocked". The owner is never blocked.
- `requestLoginLink`: for an address with no account yet, check
  `countUsersCreatedSince(startOfDay(now)) < MAX_SIGNUPS_PER_DAY`, otherwise return `'throttled'`. Then send
  the link as usual. `'requested'`, `'ignored'` and `'no-owner'` disappear from `LinkResult`. Every
  non-`'invalid'` result still looks identical to the visitor.
- `verifyLoginLink` re-checks the block and the sign-up cap (for a new address) before `findOrCreateUser`.
- `buildAccessRequestEmail` and `buildApprovedEmail` are removed.
- `requireAuth` additionally rejects a blocked user, clearing the cookie and redirecting to `/login`.
  Blocking therefore ends existing sessions. It costs one primary-key lookup per request.

## UI

- **Home**: shows "Kredyty: 312 / 500" (balance / total granted) to non-owners. The owner sees "Wydane: $X"
  instead. With no credits, the add form is replaced by `NO_CREDITS_MESSAGE` and "Retry" on failed cards is
  hidden. The admin link no longer shows a pending count.
- **Card detail**: "Regenerate" and "Generate audio" are disabled and replaced by the message. Saving an edited
  sentence still saves. With no credits the old (now mismatched) audio is cleared, as on a TTS failure, so
  the card becomes text-only.
- **Review**: `review-check` returns `{ ok: false, reason: 'no-credits' }` without calling OpenRouter. The
  review screen uses the existing local-diff fallback and adds a muted line "Ocena AI niedostępna — brak
  kredytów".
- **Login page**: copy changes from "ask for access" to "enter your email to sign in or create an account".
- **`/admin`** (owner only, as now): a table of users with email, joined date, spent ($, 2 dp), balance
  (credits) and status. Each row has a "+500" button (grant `STARTER_CREDITS`, reason `admin`) and
  "Block"/"Unblock". The owner's own row has no actions. Styling uses hand-written classes in `app.css`.

Every server action re-checks `hasCredits`. The UI hiding is a convenience, not the guard.

## Config (`wrangler.jsonc` vars)

`STARTER_CREDITS: "500"`, `MAX_SIGNUPS_PER_DAY: "20"`, `TTS_USD_PER_MILLION_CHARS: "<from OpenRouter model page>"`.
`DAILY_CARD_LIMIT` stays.

## Testing (Vitest, no UI tests)

- `tests/openrouter.test.ts`: chat responses with and without `usage.cost` → correct `onUsage` event and
  fallback; a validation failure still records usage; a non-2xx response records nothing; TTS charges by
  characters and captures `X-Generation-Id`.
- `tests/credits.test.ts` (DB helper): balance arithmetic, starter grant on user creation, owner exemption,
  negative balance → no credits, admin grant restores access.
- `tests/login.test.ts`: unknown address gets a link (no approval), blocked address does not, sign-up cap
  returns `'throttled'`, verify refuses blocked users.
- Migration test via `tests/helpers/db.ts`: existing users get the starter grant, rejected requests become
  blocked, `access_requests` is gone.
- Manual check: sign up with a new address, burn credits by lowering `STARTER_CREDITS`, confirm every blocked
  action and the review fallback, block from `/admin` and confirm the session ends.

## Docs

Update `README.md` (Daily card limit → Credits section), and in `CLAUDE.md` replace the auth line (no more
`access_requests`). Also add: "every OpenRouter call goes through `aiFromEnv(env, usageRecorder(db, userId))`
after a `hasCredits` check".
