# Email Review Reminders — Design

**Date:** 2026-09-27
**Status:** Approved

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
| Provider | Resend free plan (`POST https://api.resend.com/emails`, 3,000 emails/month, 100/day). Cloudflare Email Sending was the first choice but requires the Workers Paid plan |
| Addresses | Sender `AI Cards <cards@2doai.app>` in `vars` (`REMINDER_FROM`) — an address in the learner's `2doai.app` domain, verified in Resend. Secrets `RESEND_API_KEY` and `REMINDER_TO` (any of the learner's addresses); only placeholder keys in the public repo |
| Off switch | On/Off toggle on home, stored in a new D1 `settings` table; default **on** |
| Content | Short Polish email, `text/plain` + simple inline-styled HTML |
| Verification | Vitest for logic, adapter (stubbed `fetch`), repo and orchestration; `buildReminder` HTML rendered in Chromium; a "Send test" button in the app |

Out of scope (YAGNI): changing the hour in the UI, pause-until-date, multiple recipients, retrying a failed
send, a sentence teaser in the email, a "sent today" dedup beyond `reminderLastSent`.

## Architecture

Ports & adapters, like `ai.ts` / `openrouter.ts`. Every unit has one job:

| File | Role | Depends on |
|---|---|---|
| `app/lib/mailer.ts` | **Port.** `interface Mailer { send(msg: MailMessage): Promise<void> }`, `MailMessage = { subject: string; text: string; html: string }`. Addresses are adapter configuration, not part of the port. | — |
| `app/lib/resend.ts` | **Adapter.** `createResendMailer({ apiKey, from, to }): Mailer` POSTs `{ from, to, subject, text, html }` to `https://api.resend.com/emails` with `Authorization: Bearer <apiKey>` and `AbortSignal.timeout(15_000)`; a non-2xx response throws `Error('Resend <status>: <body>')`. The only file that knows Resend. | `fetch` |
| `app/lib/reminder.ts` | **Pure logic, no I/O.** `isReminderHour(nowMs, hour = 19)`, `shouldRemind(state)`, `pluralKarty(n)`, `buildReminder({ due, fresh, streak, appUrl })` → `MailMessage`. | `streak.ts` |
| `app/lib/reminder-job.ts` | **Orchestration.** `runReminder(deps, now, opts?)` with `deps = { db, mailer, appUrl }` (same `deps` pattern as `pipeline`). Reads state via repo, asks `shouldRemind`, sends, records `reminderLastSent`. | repo, reminder, Mailer |
| `app/db/schema.ts` + `drizzle/0002_*.sql` | New table `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`. Keys used: `reminderEnabled` (`'true'`/`'false'`), `reminderLastSent` (`YYYY-MM-DD`). Generated with `npx drizzle-kit generate`. | — |
| `app/db/repo.ts` | `getSetting(db, key)` → `string \| null`, `setSetting(db, key, value)` (upsert), `isDayDone(db, day)`, `countNew(db)` (same condition as `getNewCards`: `ready`, not learned, has `decodeParts`). Still the only file that touches Drizzle. | Drizzle |
| `workers/app.ts` | Gains `scheduled(controller, env, ctx)`. It only assembles deps and calls `runReminder`. **Why touch a template file:** a Worker has one export per event type and React Router cannot receive cron events; the change is a few lines and leaves `fetch` untouched. Keeps template style. | reminder-job, resend |
| `app/routes/reminder.ts` + `app/routes.ts` | `POST /reminder` action: `intent = on \| off \| test`. Starts with `requireAuth`. | repo, reminder-job, resend |
| `app/routes/home.tsx` + `app/app.css` | A reminder row under the theme switcher; loader adds `reminderEnabled`. | — |
| `wrangler.jsonc` | `"triggers": { "crons": ["0 17 * * *", "0 18 * * *"] }` with a CET/CEST comment, `APP_URL` and `REMINDER_FROM` (`AI Cards <cards@2doai.app>`) in `vars`. | — |
| `.dev.vars.example` | `RESEND_API_KEY=` / `REMINDER_TO=` placeholders so `Env` types them in CI. | — |

Building the mailer from `env` (check config, `createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.REMINDER_FROM, to: env.REMINDER_TO })`)
is needed by both the cron handler and the route, so it lives in one helper,
`mailerFromEnv(env): Mailer | null` in `app/lib/resend.ts`, returning `null` when any of the three is empty.

## Data flow

**Cron (17:00 and 18:00 UTC):**

1. `scheduled` takes `t = controller.scheduledTime` (not `Date.now()`), so start-up delay cannot shift the decision.
2. If `!isReminderHour(t)` — Warsaw hour is not 19 — return. On every day one of the two crons stops here.
3. `mailer = mailerFromEnv(env)`; if `null`, log `reminder: RESEND_API_KEY/REMINDER_TO not configured, skipping` and return.
4. `ctx.waitUntil(runReminder({ db: createDb(env.DB), mailer, appUrl: env.APP_URL }, t).then(log, logError))`.

**`runReminder(deps, now, { force = false } = {})`:**

1. `today = dayKey(now)`.
2. Read `enabled = getSetting('reminderEnabled') !== 'false'`, `lastSent = getSetting('reminderLastSent')`,
   `dayDone = isDayDone(today)`, `due = countDue(endOfDay(now))` (cards that come due later tonight count too — the day is only lost at midnight), `fresh = countNew()`.
   `/review` and home only show cards due *now*, so the job also passes `later = { count: due − countDue(now), from: nextDueAt(now) }`
   to `buildReminder`, which tells the learner when those cards become ready.
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
  - when some due cards only become ready later tonight, a timing sentence in Warsaw time: `Będzie gotowa o 21:30.` /
    `Pierwsza będzie gotowa o 21:30.` (none ready now), `Teraz możesz powtórzyć 2, pozostałe będą gotowe od 21:30.` /
    `…, ostatnia będzie gotowa o 21:30.` (some ready now);
  - when `due > 0` and `streak ≥ 1`: `Twoja seria: 7 dni — nie przerywaj jej dziś.` Not on new-cards-only days: only
    reviews complete a day, so learning cannot save the streak;
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
| `RESEND_API_KEY` / `REMINDER_TO` missing | Cron logs `reminder: RESEND_API_KEY/REMINDER_TO not configured, skipping`. The route returns `{ reminderError: 'RESEND_API_KEY/REMINDER_TO not configured' }`. |
| Resend answers non-2xx (bad key 401, sender domain not verified 403, daily limit 429, outage 5xx) or times out after 15 s | Adapter throws `Resend <status>: <body>`; `runReminder` does not write `lastSent`; the cron logs `reminder: send failed <message>`. No automatic retry — the other cron that day is cut off by the hour guard, so the next attempt is tomorrow. |
| D1 error | Same: caught in the cron, one log line. |
| "Send test" fails | The action catches and returns `{ reminderError: message }`, shown in the reminder row (e.g. `Resend 403: …` when the sender domain is not verified). |
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
| `tests/resend.test.ts` | With `vi.stubGlobal('fetch', …)`: URL, `POST`, Bearer header, exact JSON body `{ from, to, subject, text, html }`; 403 and 500 throw with the status in the message; `mailerFromEnv` returns `null` when a value is empty or missing. |
| `tests/repo.test.ts` (extended) | `getSetting` / `setSetting` including upsert, `isDayDone`, `countNew`. The in-memory helper replays migration `0002`. |
| `tests/reminder-job.test.ts` | In-memory DB + fake Mailer: sends and writes `lastSent`; second run the same day → `already-sent`; `disabled`; `day-done`; `nothing-to-do`; failing `send` leaves `lastSent` unset; `force` sends despite `day-done`, prefixes `[Test] `, and does not write `lastSent`. |

The `scheduled` handler stays thin and has no unit test, per project convention. Manual verification:

- `npm run dev`, then hit the local scheduled endpoint (`/cdn-cgi/handler/scheduled?cron=0+17+*+*+*&time=<epoch of 19:00 Warsaw>`;
  fall back to `wrangler dev --test-scheduled` on a build if the Vite dev server does not expose it). With a
  placeholder `RESEND_API_KEY` the send fails with `Resend 401`, which proves the path; render `buildReminder`'s HTML
  in Chromium and publish it as an Artifact for review.
- Same with a `time` at another hour: nothing is sent.
- Screenshots of the reminder row on home in both themes (Chromium, 390×844).
- `npm test` and `npm run typecheck` green.

## Rollout

The learner's steps, **before** merging to `master` (every push to `master` deploys):

1. In Resend, verify the `2doai.app` domain (the sender is `cards@2doai.app`) and create an API key with
   sending access restricted to that domain.
2. `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put REMINDER_TO` (any of the learner's addresses).
3. Merge to `master`; CI deploys and applies migration `0002`.
4. On production, press "Send test" to confirm the setup.

Without steps 1–2 the deploy still succeeds; the cron logs "not configured" and "Send test" shows the error.
