# Open Sign-up with a Credit Pool — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-03-open-signup-credits-design.md`

Two migrations instead of one: `drizzle-kit generate` asks interactively whether a new table is a rename
of a dropped one, so the drop of `access_requests` and the creation of the credit tables are generated
separately.

1. **Migration 0006 — open sign-up.** Remove `accessRequests` from the schema and add `users.blocked_at`,
   then generate. Hand-append the data step "rejected requests become blocked users" before the `DROP TABLE`.
2. **Migration 0007 — credits.** Add `usage_log` and `credit_grants`, then generate. Hand-append the starter
   grant (500,000 µ$) for every existing non-owner user.
3. **Repo.** Remove the access-request functions. Add block, sign-up count, usage, grants, balance and
   admin listing. `findOrCreateUser` grants the starter pool in one batch. `listUsers` (reminder cron)
   skips blocked users.
4. **Port + adapter.** `UsageEvent` in `ai.ts`; `onUsage` becomes a required option of `createOpenRouter`.
   Chat is charged from `usage.cost` (fallback 2¢), TTS by characters × `TTS_USD_PER_MILLION_CHARS`.
   `aiFromEnv(env, onUsage)`.
5. **`app/lib/credits.ts`.** `starterCredits`, `hasCredits`, `usageRecorder`, `toCredits`, message.
6. **Login + session.** No approval, a daily sign-up cap, blocked addresses ignored. `requireAuth` rejects
   blocked users and clears their cookie.
7. **Routes.** home (balance, add/retry guard), card-detail (regenerate/audio guard, save without TTS),
   review-check + review (no-credits fallback), admin (user table), login copy.
8. **Config + docs.** `wrangler.jsonc` vars, README, CLAUDE.md.
9. **Tests** for each step. Then `npm test` and `npm run typecheck`.
