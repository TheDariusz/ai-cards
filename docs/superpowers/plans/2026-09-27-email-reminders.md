# Email Review Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one Polish reminder email at 19:00 Europe/Warsaw on days that are not yet done and have due/new cards, with an On/Off switch and a "Send test" button on home.

**Architecture:** Port `Mailer` (`app/lib/mailer.ts`) with one adapter over the Cloudflare `send_email` binding (`app/lib/cf-email.ts`). Pure copy/decision logic in `app/lib/reminder.ts`, orchestration in `app/lib/reminder-job.ts` with a `deps` object like `pipeline`. Two UTC crons call a thin `scheduled` handler in `workers/app.ts`; a `/reminder` action serves the home switch. Settings live in a new D1 `settings` key/value table.

**Tech Stack:** Cloudflare Workers (Cron Triggers, `send_email` binding), D1 + Drizzle, React Router 8 framework mode, TypeScript, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-27-email-reminders-design.md`

## Global Constraints

- `app/` style: no semicolons, single quotes, 2-space. `workers/app.ts` keeps template style (double quotes, semicolons).
- `app/db/repo.ts` is the only file that touches Drizzle. Every loader/action starts with `await requireAuth(request, env)`.
- No Tailwind utilities, no new dependencies, no UI test infra. Keep `react-router` / `@react-router/dev` at exactly `8.0.0`.
- Settings keys: `reminderEnabled` (`'true'` / `'false'`, missing = on) and `reminderLastSent` (`YYYY-MM-DD`, Warsaw).
- Crons exactly `"0 17 * * *"` and `"0 18 * * *"`; send only when the Warsaw hour of `controller.scheduledTime` is 19.
- Secrets `REMINDER_FROM`, `REMINDER_TO` (placeholders only in `.dev.vars.example`); var `APP_URL` = `https://ai-cards.thedariusz.workers.dev`; binding `EMAIL`.
- Log lines start with `reminder:`; nothing thrown out of `scheduled`.
- Email copy Polish, UI copy English (`Reminder at 19:00`, `On`, `Off`, `Send test`, `Sent ✓`).
- HTML palette: bg `#f6f7fb`, card `#ffffff`, text `#1d2233`, button `#4b5bdc` with white text; inline styles only, system fonts.
- Commands: `npm test`, `npx vitest run tests/<file>.test.ts`, `npm run typecheck` (needs `cp .dev.vars.example .dev.vars`, uncommitted). Conventional commits. Never `npm run deploy`, never push to `master`.

## Review Focus

1. **"Send test" while reminders are Off** → the test still sends (force bypasses every skip reason, not only `day-done`). Test in Task 4.
2. **"Send test" with nothing due and nothing new** → a sensible email, not "0 kart do powtórki": subject `Brak kart na dziś`, link to home. Test in Task 1.
3. **Verb/adjective agreement for new cards** (1 nowa karta czeka / 3 nowe karty czekają / 5 nowych kart czeka) — the spec gives only the "3" example. Tests in Task 1.
4. **Streak of exactly 1** → `streak 1 dzień` in the subject and a grammatical body line (spec's `Masz serię 7 dni` does not decline for 1, so the body uses `Twoja seria: N dni/dzień — nie przerywaj jej dziś.`). Test in Task 1.
5. **A test email must not suppress tonight's real reminder** → `force` never writes `reminderLastSent`. Test in Task 4.

---

### Task 1: Pure reminder logic (`app/lib/reminder.ts`) and mailer port

**Files:**
- Create: `app/lib/mailer.ts`, `app/lib/reminder.ts`
- Test: `tests/reminder.test.ts`

**Interfaces:**
- Produces (`mailer.ts`): `type MailMessage = { subject: string; text: string; html: string }`; `interface Mailer { send(msg: MailMessage): Promise<void> }`.
- Produces (`reminder.ts`):
  - `isReminderHour(nowMs: number, hour = 19): boolean` — Warsaw hour via `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' })`.
  - `type SkipReason = 'disabled' | 'already-sent' | 'day-done' | 'nothing-to-do'`
  - `type ReminderState = { enabled: boolean; today: string; lastSent: string | null; dayDone: boolean; due: number; fresh: number }`
  - `shouldRemind(s: ReminderState): { send: true } | { send: false; reason: SkipReason }` — order: disabled, already-sent, day-done, nothing-to-do.
  - `pluralKarty(n: number): 'karta' | 'karty' | 'kart'`; `pluralNowa(n: number): 'nowa' | 'nowe' | 'nowych'` (same one/few/many rule: 1 → one; last digit 2–4 and not 12–14 → few; else many).
  - `buildReminder(input: { due: number; fresh: number; streak: number; appUrl: string }): MailMessage`

Copy (exact; `N kart` = `${n} ${pluralKarty(n)}`, `M nowe karty` = `${m} ${pluralNowa(m)} ${pluralKarty(m)}`, `S dni` = `${s} ${s === 1 ? 'dzień' : 'dni'}`; `czeka` for one/many, `czekają` for few):

| Case | Subject | Status sentence | Button → path |
|---|---|---|---|
| `due > 0` | `N kart do powtórki` + (`streak ≥ 1` ? ` · streak S dni` : '') | `Masz dziś N kart do powtórki.` or, if `fresh > 0`, `Masz dziś N kart do powtórki i M nowe karty do nauki.` | `Zacznij review` → `/review` |
| `due === 0, fresh > 0` | `M nowe karty czeka/czekają na naukę` | `Masz dziś M nowe karty do nauki.` | `Zacznij naukę` → `/learn` |
| both 0 (force only) | `Brak kart na dziś` | `Nie masz dziś kart do powtórki ani nowych kart.` | `Otwórz aplikację` → `/` |

Then, if `streak ≥ 1`: `Twoja seria: S dni — nie przerywaj jej dziś.`; footer `Przypomnienia wyłączysz na stronie głównej aplikacji.` linking `${base}/`. `base` = `appUrl` with trailing `/` stripped. Text part: same sentences, each link as `Label: URL`. HTML part: one centered `<table>` with inline styles per Global Constraints, every interpolated URL passed through a local `escapeHtml` (`& < > " '`).

- [ ] **Step 1: Write failing tests** in `tests/reminder.test.ts`:

```ts
const at = (iso: string) => Date.parse(iso)
describe('isReminderHour', () => {
  it('17:00 UTC in July is 19:00 CEST', () => expect(isReminderHour(at('2026-07-15T17:00:00Z'))).toBe(true))
  it('18:00 UTC in July is not', () => expect(isReminderHour(at('2026-07-15T18:00:00Z'))).toBe(false))
  it('18:00 UTC in January is 19:00 CET', () => expect(isReminderHour(at('2026-01-15T18:00:00Z'))).toBe(true))
  it('17:00 UTC in January is not', () => expect(isReminderHour(at('2026-01-15T17:00:00Z'))).toBe(false))
  it('switch to CEST on 2026-03-29', () => {
    expect(isReminderHour(at('2026-03-29T17:00:00Z'))).toBe(true)
    expect(isReminderHour(at('2026-03-29T18:00:00Z'))).toBe(false)
  })
  it('switch to CET on 2026-10-25', () => {
    expect(isReminderHour(at('2026-10-25T18:00:00Z'))).toBe(true)
    expect(isReminderHour(at('2026-10-25T17:00:00Z'))).toBe(false)
  })
})
```

`shouldRemind` with `base = { enabled: true, today: '2026-09-27', lastSent: null, dayDone: false, due: 3, fresh: 0 }`: send case `{ send: true }`; `enabled: false` → `disabled`; `lastSent: '2026-09-27'` → `already-sent` (and `'2026-09-26'` still sends); `dayDone: true` → `day-done`; `due: 0, fresh: 0` → `nothing-to-do`; `due: 0, fresh: 2` sends; `{ enabled: false, dayDone: true }` → `disabled`.

`pluralKarty` over `[1, 2, 4, 5, 12, 14, 21, 22, 25]` → `['karta', 'karty', 'karty', 'kart', 'kart', 'kart', 'kart', 'karty', 'kart']`; `pluralNowa([1, 3, 5, 22])` → `['nowa', 'nowe', 'nowych', 'nowe']`.

`buildReminder` (`url = 'https://x.dev'`):
- `{ due: 12, fresh: 0, streak: 7 }` → subject `12 kart do powtórki · streak 7 dni`; `text` contains `Twoja seria: 7 dni — nie przerywaj jej dziś.` and `https://x.dev/review`.
- `{ due: 2, fresh: 3, streak: 1 }` → subject `2 karty do powtórki · streak 1 dzień`; text contains `Masz dziś 2 karty do powtórki i 3 nowe karty do nauki.`
- `{ due: 5, fresh: 0, streak: 0 }` → subject `5 kart do powtórki`; text does not contain `seria`.
- new-only: `fresh: 3` → `3 nowe karty czekają na naukę`; `fresh: 1` → `1 nowa karta czeka na naukę`; `fresh: 5` → `5 nowych kart czeka na naukę`; html contains `href="https://x.dev/learn"` and not `/review`.
- `{ due: 0, fresh: 0, streak: 0 }` → subject `Brak kart na dziś`; html contains `href="https://x.dev/"`.
- `appUrl: 'https://x.dev/'` → text contains `https://x.dev/review` and not `//review`.
- `appUrl: 'https://x.dev/?a=1&b="2"'` → html contains `&amp;b=&quot;2&quot;` and not `b="2"`.

- [ ] **Step 2:** `npx vitest run tests/reminder.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Create `app/lib/mailer.ts` and implement `app/lib/reminder.ts` per the Interfaces and copy table.
- [ ] **Step 4:** `npx vitest run tests/reminder.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: add reminder decision and email copy logic`.

### Task 2: `settings` table and repo functions

**Files:**
- Modify: `app/db/schema.ts`, `app/db/repo.ts`
- Create: `drizzle/0002_*.sql` (+ `drizzle/meta/*`) via `npx drizzle-kit generate`
- Test: `tests/repo.test.ts`

**Interfaces:**
- Produces: `settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() })`; `getSetting(db: Db, key: string): Promise<string | null>`; `setSetting(db: Db, key: string, value: string): Promise<void>` (insert … `onConflictDoUpdate` on `key`); `isDayDone(db: Db, day: string): Promise<boolean>`; `countNew(db: Db): Promise<number>` (same `where` as `getNewCards` — extract a shared `newCardCondition` const so they cannot drift).

- [ ] **Step 1: Write failing tests** in `tests/repo.test.ts`:
  - `getSetting(db, 'reminderEnabled')` → `null`; after `setSetting(…, 'false')` → `'false'`; after `setSetting(…, 'true')` → `'true'` (upsert, no throw).
  - `isDayDone(db, dayKey(NOW))` → `false`; after `db.insert(dayLog).values({ date: dayKey(NOW) })` → `true`; another day stays `false`.
  - `countNew`: pending card → 0; `markReady` with `CONTENT` → 1; `completeFirstLearning` → 0; a ready card with `decodeParts: null` via `updateCardContent` → not counted. Assert `countNew(db) === (await getNewCards(db)).length` at each step.
- [ ] **Step 2:** `npx vitest run tests/repo.test.ts` → FAIL (exports missing).
- [ ] **Step 3:** Add the table to `schema.ts`, run `npx drizzle-kit generate` (check the new SQL is only `CREATE TABLE settings …`), then `npx wrangler d1 migrations apply DB --local`. Implement the repo functions.
- [ ] **Step 4:** `npm test` → all PASS (migration replay in `tests/helpers/db.ts` picks up `0002`).
- [ ] **Step 5:** Commit `feat: add settings table and reminder repo queries`.

### Task 3: Cloudflare Email adapter and Worker config

**Files:**
- Create: `app/lib/cf-email.ts`
- Modify: `wrangler.jsonc`, `.dev.vars.example` (`worker-configuration.d.ts` is untracked; `wrangler types` regenerates it)
- Test: `tests/cf-email.test.ts`

**Interfaces:**
- Consumes: `Mailer`, `MailMessage` from Task 1.
- Produces: `createCfMailer(binding: Pick<SendEmail, 'send'>, from: string, to: string): Mailer` — `await binding.send({ from, to, subject, text, html })`, no catch. `mailerFromEnv(env: Pick<Env, 'EMAIL' | 'REMINDER_FROM' | 'REMINDER_TO'>): Mailer | null` — `null` when either secret is empty/whitespace/undefined.

- [ ] **Step 1: Write failing tests** in `tests/cf-email.test.ts` with `const binding = { send: vi.fn(async () => ({ messageId: 'm1' })) }`:
  - `createCfMailer(binding, 'a@x.com', 'b@y.com').send({ subject: 's', text: 't', html: 'h' })` → `binding.send` called once with exactly `{ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't', html: 'h' }`.
  - `binding.send` rejecting `new Error('destination address not verified')` → `send(...)` rejects with that message.
  - `mailerFromEnv({ EMAIL: binding, REMINDER_FROM: '', REMINDER_TO: 'b@y.com' } as any)` → `null`; same with `REMINDER_TO: ' '` → `null`; both set → an object whose `send` reaches `binding.send`.
- [ ] **Step 2:** `npx vitest run tests/cf-email.test.ts` → FAIL.
- [ ] **Step 3:** Implement `cf-email.ts`. In `wrangler.jsonc` add `"APP_URL": "https://ai-cards.thedariusz.workers.dev"` to `vars`, `"send_email": [{ "name": "EMAIL" }]`, and `"triggers": { "crons": ["0 17 * * *", "0 18 * * *"] }` with a comment: `// 19:00 Europe/Warsaw is 17:00 UTC in CEST and 18:00 UTC in CET; isReminderHour() drops the other one`. Append `REMINDER_FROM=cards@example.com` and `REMINDER_TO=you@example.com` to `.dev.vars.example`; mirror them into your local `.dev.vars`.
- [ ] **Step 4:** `npx vitest run tests/cf-email.test.ts` → PASS; `npm run typecheck` → clean (`Env` now has `EMAIL: SendEmail`, `APP_URL`, `REMINDER_FROM`, `REMINDER_TO`).
- [ ] **Step 5:** Commit `feat: add Cloudflare Email mailer adapter and cron config`.

### Task 4: Orchestration (`app/lib/reminder-job.ts`)

**Files:**
- Create: `app/lib/reminder-job.ts`
- Test: `tests/reminder-job.test.ts`

**Interfaces:**
- Consumes: Task 1 (`shouldRemind`, `buildReminder`, `SkipReason`, `Mailer`), Task 2 (`getSetting`, `setSetting`, `isDayDone`, `countNew`), existing `countDue`, `completedDays`, `computeStreak`, `dayKey`.
- Produces: `type ReminderDeps = { db: Db; mailer: Mailer; appUrl: string }`; `type ReminderResult = { send: false; reason: SkipReason } | { send: true; due: number; fresh: number; streak: number }`; `runReminder(deps: ReminderDeps, now: number, opts?: { force?: boolean }): Promise<ReminderResult>` — steps exactly as spec "Data flow → runReminder"; `force` skips `shouldRemind` entirely, prefixes subject with `[Test] `, and never writes `reminderLastSent`.

- [ ] **Step 1: Write failing tests** in `tests/reminder-job.test.ts`. Setup: `testDb()`, a fake `mailer = { sent: [] as MailMessage[], send: async (m) => { mailer.sent.push(m) } }`, `NOW = Date.parse('2026-09-27T17:00:00Z')`, a helper that inserts a ready, learned card due before `NOW` (`insertPendingCard` → `markReady` → `completeFirstLearning(db, id, NOW - 2 * DAY)`; then set `dueAt` via `db.update(cards)` to `NOW - 1`).
  - one due card → result `{ send: true, due: 1, fresh: 0, streak: 0 }`, one mail with subject `1 karta do powtórki`, `getSetting(db, 'reminderLastSent')` → `'2026-09-27'`.
  - second run same `NOW` → `{ send: false, reason: 'already-sent' }`, still one mail.
  - `setSetting('reminderEnabled', 'false')` → `disabled`, no mail.
  - `dayLog` row for `'2026-09-27'` → `day-done`, no mail.
  - empty DB → `nothing-to-do`.
  - yesterday in `dayLog` → subject ends ` · streak 1 dzień`.
  - mailer whose `send` rejects → `runReminder` rejects, `reminderLastSent` stays `null`.
  - `force` with `dayLog` today **and** `reminderEnabled = 'false'` → sends, subject starts `[Test] `, `reminderLastSent` stays `null`.
- [ ] **Step 2:** `npx vitest run tests/reminder-job.test.ts` → FAIL.
- [ ] **Step 3:** Implement `runReminder`.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat: add reminder job orchestration`.

### Task 5: Cron handler, `/reminder` route and home switch

**Files:**
- Modify: `workers/app.ts`, `app/routes.ts`, `app/routes/home.tsx`, `app/app.css`
- Create: `app/routes/reminder.ts`

**Interfaces:**
- Consumes: `runReminder` (Task 4), `mailerFromEnv` (Task 3), `isReminderHour` (Task 1), `getSetting`/`setSetting`/`createDb`.
- Produces: `POST /reminder` returning `{ ok: true } | { reminderSent: true } | { reminderError: string }`; home loader field `reminderEnabled: boolean`.

- [ ] **Step 1:** `workers/app.ts`: add `async scheduled(controller, env, ctx)` next to `fetch`, following spec "Data flow → Cron" steps 1–4 exactly. Log `reminder: <JSON of result>` on success, `reminder: send failed <err.message>` on rejection, `reminder: missing REMINDER_FROM/TO, skipping` when `mailerFromEnv` returns `null`. Template style.
- [ ] **Step 2:** `app/routes/reminder.ts` action (`requireAuth` first): `intent` `on`/`off` → `setSetting(db, 'reminderEnabled', 'true' | 'false')`, return `{ ok: true }`; `test` → `mailerFromEnv(env)` null → `{ reminderError: 'REMINDER_FROM/TO not configured' }`; else `await runReminder(..., Date.now(), { force: true })` in `try`, returning `{ reminderSent: true }` or `{ reminderError: err.message }` (log it with `console.error('reminder: test failed', err)`); anything else → `throw new Response('Bad Request', { status: 400 })`. Register `route('reminder', 'routes/reminder.ts')`.
- [ ] **Step 3:** Home: loader adds `reminderEnabled: (await getSetting(db, 'reminderEnabled')) !== 'false'`. Under the theme `Form`, render a `useFetcher<typeof reminderAction>()` form `method="post" action="/reminder"` with class `reminder-switch`: label `Reminder at 19:00`, buttons `On` / `Off` (`name="intent"`, `value="on" | "off"`, `aria-pressed`), then `Send test` (`value="test"`, class `link-button`, text `Sending…` while `fetcher.state !== 'idle'` and `fetcher.formData?.get('intent') === 'test'`). Below it: `Sent ✓` (`.ok`) or `⚠ {reminderError}` (`.error`) from `fetcher.data`.
- [ ] **Step 4:** `app/app.css`: extend the three `.theme-switch` selectors to `.theme-switch, .reminder-segment` (put `On`/`Off` in a `<span className="reminder-segment">`), and add `.reminder-switch { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-top: 0.75rem }` and `.link-button` (transparent background, `var(--accent)` text, underline) if no equivalent class exists. No color literals.
- [ ] **Step 5:** `npm test` and `npm run typecheck` → clean.
- [ ] **Step 6: Manual check (Chromium, 390×844, light + dark):** `npm run dev`, log in, toggle Off → On (pressed state flips without reload), press Send test → `Sent ✓` and Miniflare prints the `.eml` path. Clear `REMINDER_TO` in `.dev.vars`, restart, Send test → `⚠ REMINDER_FROM/TO not configured`. Scheduled: `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+17+*+*+*&time=$(date -d 2026-09-27T17:00:00Z +%s)000"` → `.eml` written (if the Vite dev server lacks the endpoint: `npm run build && npx wrangler dev --test-scheduled` on the build). Same with `T18:00:00Z` → no mail, no log beyond the guard. Screenshots of the row in both themes.
- [ ] **Step 7:** Commit `feat: send daily review reminder from cron with home toggle`.

### Task 6: Docs, email preview, final checks

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1:** README: new "Email reminders" section — what it does (19:00 Warsaw, only when the day is not done), the Rollout steps 1–4 verbatim from the spec, and how to fire the cron locally (Task 5 Step 6 command). Add `REMINDER_FROM`/`REMINDER_TO` wherever README lists secrets.
- [ ] **Step 2:** CLAUDE.md Architecture: one line — `app/lib/mailer.ts` is the mail port, `app/lib/cf-email.ts` its only adapter; the cron entry is `scheduled` in `workers/app.ts` (the one intentional edit to that template file).
- [ ] **Step 3:** Render the HTML of the `.eml` from Task 5 (and one new-only variant from `buildReminder`) in Chromium, publish as an Artifact for the learner's review.
- [ ] **Step 4:** `npm test` and `npm run typecheck` → clean; `git status` shows no `.dev.vars`.
- [ ] **Step 5:** Commit `docs: describe email reminders setup`.

## Provider change: Resend

After implementation, Cloudflare refused Email Sending on the free plan ("Email Sending is currently only
available with the Workers Paid plan"). The adapter was swapped for Resend without touching the `Mailer` port:
`app/lib/cf-email.ts` → `app/lib/resend.ts` (`createResendMailer({ apiKey, from, to })`, `fetch` with a 15 s
timeout, non-2xx throws with status and body), `tests/cf-email.test.ts` → `tests/resend.test.ts` (stubbed
`fetch`). `wrangler.jsonc` drops the `send_email` binding and sets `REMINDER_FROM` to
`AI Cards <onboarding@resend.dev>` in `vars`; the secrets are now `RESEND_API_KEY` and `REMINDER_TO`. The
missing-config message is `RESEND_API_KEY/REMINDER_TO not configured`. The spec's Rollout section is updated.
