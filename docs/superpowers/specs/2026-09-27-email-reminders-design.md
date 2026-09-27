# Email Review Reminders — Design

**Date:** 2026-09-27
**Status:** Approved in chat; awaiting written-spec review

## Purpose

The learner forgets to open the app on some days and loses the streak. A short email at 19:00 Warsaw time,
sent only on days that are not yet done, brings them back in time to finish review before midnight.
Success: at most one email a day, only when the day is not done and there is something to do; it can be
switched off from the app; a failure to send never breaks the Worker and is visible in `wrangler tail`.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| When to send | Only if today (Europe/Warsaw) has no `day_log` row **and** there are due or new cards |
| Schedule | Once a day at 19:00 Europe/Warsaw |
| Scheduler | Two Cron Triggers, `0 17 * * *` and `0 18 * * *` (UTC), plus a Warsaw-hour guard in code — exactly one of them is 19:00 local on any day, CET or CEST |
| Provider | Cloudflare Email (`send_email` binding, Email Routing to a verified destination address) |
| Addresses | Secrets `REMINDER_FROM` and `REMINDER_TO`; only placeholder keys in the public repo |
| Off switch | On/Off toggle on home, stored in a new D1 `settings` table; default **on** |
| Content | Short Polish email, `text/plain` + simple inline-styled HTML |
| Verification | Vitest for logic, adapter, repo and orchestration; local Miniflare `.eml` output; a "Send test" button in the app |

Out of scope (YAGNI): changing the hour in the UI, pause-until-date, multiple recipients, retrying a failed
send, a sentence teaser in the email, a "sent today" dedup beyond `reminderLastSent`.

## Architecture

Ports & adapters, like `ai.ts` / `openrouter.ts`. Every unit has one job:

| File | Role | Depends on |
|---|---|---|
| `app/lib/mailer.ts` | **Port.** `interface Mailer { send(msg: MailMessage): Promise<void> }`, `MailMessage = { subject: string; text: string; html: string }`. Addresses are adapter configuration, not part of the port. | — |
| `app/lib/cf-email.ts` | **Adapter.** `createCfMailer(binding: SendEmail, from: string, to: string): Mailer` calls `binding.send({ from, to, subject, text, html })` (the runtime's builder form, no raw MIME) and lets any rejection propagate. The only file that knows Cloudflare Email. | `SendEmail` type |
| `app/lib/reminder.ts` | **Pure logic, no I/O.** `isReminderHour(nowMs, hour = 19)`, `shouldRemind(state)`, `pluralKarty(n)`, `buildReminder({ due, fresh, streak, appUrl })` → `MailMessage`. | `streak.ts` |
| `app/lib/reminder-job.ts` | **Orchestration.** `runReminder(deps, now, opts?)` with `deps = { db, mailer, appUrl }` (same `deps` pattern as `pipeline`). Reads state via repo, asks `shouldRemind`, sends, records `reminderLastSent`. | repo, reminder, Mailer |
| `app/db/schema.ts` + `drizzle/0002_*.sql` | New table `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`. Keys used: `reminderEnabled` (`'true'`/`'false'`), `reminderLastSent` (`YYYY-MM-DD`). Generated with `npx drizzle-kit generate`. | — |
| `app/db/repo.ts` | `getSetting(db, key)` → `string \| null`, `setSetting(db, key, value)` (upsert), `isDayDone(db, day)`, `countNew(db)` (same condition as `getNewCards`: `ready`, not learned, has `decodeParts`). Still the only file that touches Drizzle. | Drizzle |
| `workers/app.ts` | Gains `scheduled(controller, env, ctx)`. It only assembles deps and calls `runReminder`. **Why touch a template file:** a Worker has one export per event type and React Router cannot receive cron events; the change is a few lines and leaves `fetch` untouched. Keeps template style. | reminder-job, cf-email |
| `app/routes/reminder.ts` + `app/routes.ts` | `POST /reminder` action: `intent = on \| off \| test`. Starts with `requireAuth`. | repo, reminder-job, cf-email |
| `app/routes/home.tsx` + `app/app.css` | A reminder row under the theme switcher; loader adds `reminderEnabled`. | — |
| `wrangler.jsonc` | `"send_email": [{ "name": "EMAIL" }]` (no fixed address), `"triggers": { "crons": ["0 17 * * *", "0 18 * * *"] }` with a CET/CEST comment, `APP_URL` in `vars` (the public workers.dev URL, already in README). | — |
| `.dev.vars.example` | `REMINDER_FROM=` / `REMINDER_TO=` placeholders so `Env` types them in CI. | — |

Building the mailer from `env` (check secrets, `createCfMailer(env.EMAIL, env.REMINDER_FROM, env.REMINDER_TO)`)
is needed by both the cron handler and the route, so it lives in one helper,
`mailerFromEnv(env): Mailer | null` in `app/lib/cf-email.ts`, returning `null` when either secret is empty.

## Data flow

**Cron (17:00 and 18:00 UTC):**

1. `scheduled` takes `t = controller.scheduledTime` (not `Date.now()`), so start-up delay cannot shift the decision.
2. If `!isReminderHour(t)` — Warsaw hour is not 19 — return. On every day one of the two crons stops here.
3. `mailer = mailerFromEnv(env)`; if `null`, log `reminder: missing REMINDER_FROM/TO, skipping` and return.
4. `ctx.waitUntil(runReminder({ db: createDb(env.DB), mailer, appUrl: env.APP_URL }, t).then(log, logError))`.

**`runReminder(deps, now, { force = false } = {})`:**

1. `today = dayKey(now)`.
2. Read `enabled = getSetting('reminderEnabled') !== 'false'`, `lastSent = getSetting('reminderLastSent')`,
   `dayDone = isDayDone(today)`, `due = countDue(now)`, `fresh = countNew()`.
3. Unless `force`: `shouldRemind({ enabled, today, lastSent, dayDone, due, fresh })`, checked in this order:
   - `!enabled` → `{ send: false, reason: 'disabled' }`
   - `lastSent === today` → `'already-sent'`
   - `dayDone` → `'day-done'`
   - `due + fresh === 0` → `'nothing-to-do'`
   - otherwise `{ send: true }`
   If not sending, return that result.
4. `streak = computeStreak(completedDays(), today)`; `msg = buildReminder({ due, fresh, streak, appUrl })`;
   with `force`, prefix the subject with `[Test] `.
5. `await mailer.send(msg)`.
6. Unless `force`: `setSetting('reminderLastSent', today)`.
7. Return `{ send: true, due, fresh, streak }`; the handler logs it as one line.

Send first, then record `lastSent`: a failed send never blocks a later attempt. A duplicate is possible only if
the send succeeds and the D1 write then fails — rare and harmless for one user.

**Accepted consequence:** `day_log` is written only by review. On a day with no due cards but waiting new cards,
learning them does not mark the day done, so the email comes every day while new cards wait. The email says so
plainly ("3 nowe karty czekają na naukę") and links to `/learn`.

## Email content (`buildReminder`)

Polish, with correct plural of "karta" via `pluralKarty(n)`: 1 → `karta`; last digit 2–4 except 12–14 → `karty`;
everything else → `kart` (1 karta, 2 karty, 5 kart, 12 kart, 22 karty, 25 kart).
The adjective "nowa" follows the same pattern (`nowa` / `nowe` / `nowych`).

- **Subject, `due > 0`:** `12 kart do powtórki` + ` · streak 7 dni` when `streak ≥ 1` (`1 dzień`, otherwise `dni`).
- **Subject, only new cards:** `3 nowe karty czekają na naukę`.
- **Body:**
  - one status sentence covering due and new counts;
  - when `streak ≥ 1`: `Masz serię 7 dni — nie przerywaj jej dziś.`;
  - a button `Zacznij review` → `${appUrl}/review`, or `Zacznij naukę` → `${appUrl}/learn` when `due === 0`;
  - footer `Przypomnienia wyłączysz na stronie głównej aplikacji.` linking `${appUrl}/`. Home requires login, so no unsubscribe token is needed.
- **HTML:** a single table with inline styles (mail clients drop `<style>`), light Calm Study palette
  (`#f6f7fb` background, `#ffffff` card, `#1d2233` text, `#4b5bdc` indigo button with white text), system fonts.
  `appUrl` is HTML-escaped wherever it is interpolated; a trailing `/` on `appUrl` is stripped.
- **Text:** the same sentences with bare URLs.

## Error handling

The cron never throws out of the Worker; every failure is one log line in `wrangler tail`.

| Situation | Behavior |
|---|---|
| `REMINDER_FROM` / `REMINDER_TO` missing | Cron logs `reminder: missing REMINDER_FROM/TO, skipping`. The route returns `{ reminderError: 'REMINDER_FROM/TO not configured' }`. |
| `binding.send` rejects (unverified address, limit, outage) | Adapter propagates; `runReminder` does not write `lastSent`; the cron logs `reminder: send failed <message>`. No automatic retry — the other cron that day is cut off by the hour guard, so the next attempt is tomorrow. |
| D1 error | Same: caught in the cron, one log line. |
| "Send test" fails | The action catches and returns `{ reminderError: message }`, shown in the reminder row (e.g. "destination address not verified"). |
| Forged or odd POST | `requireAuth` first; `intent` outside `on \| off \| test` → `400`. |

## UI

The app UI is English, so the row is English (only the email is Polish). It sits under the theme switcher on
home and reuses its segment style:

```
Reminder at 19:00   [ On ][ Off ]   Send test
                    ↳ Sent ✓   |   ⚠ <error message>
```

- One `useFetcher()` form posting to `/reminder` with `name="intent"`: `On` / `Off` are submit buttons with
  `aria-pressed` (like `theme-switch`); `Send test` is a text-style submit button.
- The action returns data (no redirect): `on`/`off` → `setSetting('reminderEnabled', 'true' | 'false')` and
  `{ ok: true }`; `test` → `runReminder(..., { force: true })` and `{ reminderSent: true }` or `{ reminderError }`.
  The fetcher revalidates the home loader, so the pressed state updates without a page reload.
- Home loader adds `reminderEnabled` (`getSetting` ≠ `'false'`).
- Styles: a semantic `.reminder-switch` class in `app/app.css` sharing the `.theme-switch` rules. No Tailwind utilities.

## Testing

Vitest, no UI test infra:

| File | Covers |
|---|---|
| `tests/reminder.test.ts` | `isReminderHour`: 17:00 UTC in July → true, 18:00 UTC in July → false, 18:00 UTC in January → true, 17:00 UTC in January → false, and the 2026 switch days (29 March, 25 October). `shouldRemind`: each of the four skip reasons and the send case, including order (disabled wins over day-done). `pluralKarty`: 1, 2, 4, 5, 12, 14, 21, 22, 25. `buildReminder`: due + streak subject, new-only subject, no streak suffix at 0, `/learn` link when `due === 0`, HTML escaping of `appUrl`, trailing-slash trim. |
| `tests/cf-email.test.ts` | A stub binding receives exactly `{ from, to, subject, text, html }`; a rejection propagates; `mailerFromEnv` returns `null` when a secret is empty. |
| `tests/repo.test.ts` (extended) | `getSetting` / `setSetting` including upsert, `isDayDone`, `countNew`. The in-memory helper replays migration `0002`. |
| `tests/reminder-job.test.ts` | In-memory DB + fake Mailer: sends and writes `lastSent`; second run the same day → `already-sent`; `disabled`; `day-done`; `nothing-to-do`; failing `send` leaves `lastSent` unset; `force` sends despite `day-done`, prefixes `[Test] `, and does not write `lastSent`. |

The `scheduled` handler stays thin and has no unit test, per project convention. Manual verification:

- `npm run dev`, then hit the local scheduled endpoint (`/cdn-cgi/handler/scheduled?cron=0+17+*+*+*&time=<epoch of 19:00 Warsaw>`;
  fall back to `wrangler dev --test-scheduled` on a build if the Vite dev server does not expose it). Miniflare
  writes the `.eml` locally; render its HTML in Chromium and publish it as an Artifact for review.
- Same with a `time` at another hour: nothing is sent.
- Screenshots of the reminder row on home in both themes (Chromium, 390×844).
- `npm test` and `npm run typecheck` green.

## Rollout

The learner's steps, **before** merging to `master` (every push to `master` deploys):

1. Cloudflare dashboard: enable Email Routing on the domain and add + verify the destination address (the Gmail inbox).
2. `npx wrangler secret put REMINDER_FROM` (an address on that domain, e.g. `cards@<domain>`) and `npx wrangler secret put REMINDER_TO`.
3. Merge to `master`; CI deploys and applies migration `0002`.
4. On production, press "Send test" to confirm the setup.

Steps 1–2 come first because deploying a `send_email` binding without Email Routing on the account may be
rejected; the plan confirms this against Cloudflare docs. README gains an "Email reminders" section with these steps.
