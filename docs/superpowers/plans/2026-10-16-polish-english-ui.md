# Polish / English Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every interface string and both emails (magic link, daily reminder) exist in Polish (default) and English, switchable at any time.

**Architecture:** Locale is a cookie that mirrors the theme switch (`app/lib/locale.ts` next to `app/lib/theme.ts`), read by the root loader. Interface text lives in one typed dictionary (`app/lib/i18n.ts`), where `en` must have exactly `pl`'s keys. A new `users.locale` column drives emails: it is set at account creation from the language the visitor signed up in, and updated whenever a logged-in user switches.

**Tech Stack:** React Router 8 (framework mode) on Cloudflare Workers, D1 + Drizzle, Vitest + better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-10-15-polish-english-ui-design.md`

## Global Constraints

- No i18n library, no URL prefixes. Two locales only: `type Locale = 'pl' | 'en'`. Any unknown value becomes `'pl'`.
- Untouched: `app/lib/ai.ts`, `app/lib/openrouter.ts`, `app/lib/pipeline.ts`, TTS, card content, and AI review feedback (verdict and notes stay in their current language).
- Landing demo cards keep their sample `lang="en"` / `lang="pl"` content as is. Only the copy around them is translated.
- A dictionary key missing in `en` must fail `npm run typecheck`. Never fall back to the other language at runtime.
- Polish copy uses informal "Ty" and matches the tone of the existing Polish email copy in `app/lib/reminder.ts`.
- `app/` style: no semicolons, single quotes, 2-space indent. `root.tsx` keeps its template style (double quotes, semicolons). No Tailwind utilities; add styles as semantic classes in `app/app.css`.
- Work on a new branch `feat/polish-english-ui` cut from `master`, not on `fix/transparent-favicon`.

## Review Focus

1. **Magic link opened in a mail app's browser (no cookie).** Verify must still create the account in the language the user signed up in, and set the cookie. Tested in Task 3 (`verifyLoginLink` with locale `en` creates the user with `locale = 'en'`).
2. **Tampered `lang` in the link (`&lang=de`, `&lang=<script>`).** Treated as `'pl'` and never echoed raw. Tested in Task 1 (`toLocale`) and Task 5 (the verify loader passes the value through `toLocale`).
3. **Existing account logs in via a link carrying another language.** The column stays as it was. Tested in Task 2 (`findOrCreateUser` with an existing email ignores the locale).
4. **Open redirect via the `/locale` switch.** `redirectTo` goes through the existing `safeRedirect`. Checked manually in Task 4, since `safeRedirect` is already unit-tested.
5. **Polish plurals in UI counts (1 / 2–4 / 5+ / 12–14).** The UI reuses `pluralKarty` and the related helpers instead of writing new plural code. Tested in Task 3 (English reminder: "1 card" vs "2 cards"); the Polish forms are already covered in `tests/reminder.test.ts`.

---

### Task 1: Locale preference (cookie)

**Files:**
- Create: `app/lib/locale.ts`
- Test: `tests/locale.test.ts`

**Interfaces:**
- Produces: `type Locale = 'pl' | 'en'`; `toLocale(value: unknown): Locale`; `parseLocale(cookieHeader: string | null): Locale`; `localeCookie(locale: Locale): string`. Same shape as `app/lib/theme.ts`. The cookie name is `locale`.

- [ ] **Step 1: Write `tests/locale.test.ts`**, mirroring `tests/theme.test.ts`:
  - `parseLocale(null)` → `'pl'`; `parseLocale('locale=en')` → `'en'`; `parseLocale('__session=a; locale=en; x=1')` → `'en'`; `parseLocale('locale=de')` → `'pl'`; `parseLocale('mylocale=en')` → `'pl'`
  - `['pl','en'].map(toLocale)` → `['pl','en']`; `toLocale(null)`, `toLocale('EN')`, `toLocale('<b>')` → `'pl'`
  - `localeCookie('en')` contains `locale=en`, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `Secure`, and not `HttpOnly`
- [ ] **Step 2:** `npx vitest run tests/locale.test.ts` → FAIL (module not found)
- [ ] **Step 3: Implement `app/lib/locale.ts`**, copying the parsing approach from `theme.ts`.
- [ ] **Step 4:** `npx vitest run tests/locale.test.ts` → PASS
- [ ] **Step 5: Commit** `feat: add locale cookie preference`

### Task 2: `users.locale` column and repo functions

**Files:**
- Modify: `app/db/schema.ts` (`users` table)
- Create: `drizzle/0008_*.sql` via `npx drizzle-kit generate`
- Modify: `app/db/repo.ts` (`findOrCreateUser`, new `getUserLocale`, new `setUserLocale`)
- Test: `tests/repo.test.ts`, `tests/migration.test.ts`

**Interfaces:**
- Consumes: `Locale` from Task 1.
- Produces:
  - `users.locale: text('locale').notNull().default('pl')`
  - `findOrCreateUser(db, email, ownerEmail, now, starterMicros, locale: Locale = 'pl'): Promise<number>`. The locale is written **only** on insert of a new row. The existing-email path and the owner-claim path leave it alone.
  - `getUserLocale(db: Db, userId: number): Promise<Locale>`, which returns `'pl'` for a missing user.
  - `setUserLocale(db: Db, userId: number, locale: Locale): Promise<void>`

- [ ] **Step 1: Write failing tests** in `tests/repo.test.ts`:
  - `findOrCreateUser(db, 'a@x.dev', null, NOW, 0, 'en')`, then `getUserLocale` → `'en'`
  - a new user without a locale argument → `'pl'`
  - an existing user, then `findOrCreateUser(db, same email, null, NOW, 0, 'en')` again → still `'pl'`
  - `setUserLocale(db, id, 'en')`, then `getUserLocale` → `'en'`

  In `tests/migration.test.ts`: apply migrations up to 0007, insert a user, apply 0008, and that user's `locale` is `'pl'`.
- [ ] **Step 2:** `npx vitest run tests/repo.test.ts tests/migration.test.ts` → FAIL
- [ ] **Step 3:** Add the column, run `npx drizzle-kit generate` (expect a single `ALTER TABLE users ADD locale text DEFAULT 'pl' NOT NULL`), then implement the repo functions.
- [ ] **Step 4:** `npm test` → all PASS (existing `findOrCreateUser` callers are unchanged thanks to the default)
- [ ] **Step 5:** `npx wrangler d1 migrations apply DB --local`
- [ ] **Step 6: Commit** `feat: store each user's interface language`

### Task 3: Bilingual emails

**Files:**
- Modify: `app/lib/login.ts` (`buildLoginEmail`, `requestLoginLink`, `verifyLoginLink`)
- Modify: `app/lib/reminder.ts` (`buildReminder`)
- Modify: `app/lib/reminder-job.ts` (`runReminder`)
- Test: `tests/login.test.ts`, `tests/reminder.test.ts`, `tests/reminder-job.test.ts`

**Interfaces:**
- Consumes: `Locale`, `toLocale` (Task 1); `findOrCreateUser(..., locale)` and `getUserLocale` (Task 2).
- Produces:
  - `buildLoginEmail(link: string, locale: Locale): MailMessage`
  - `requestLoginLink(deps, rawEmail, origin, now, locale: Locale)`, which builds the link as `${origin}/login/verify?token=${token}&lang=${locale}`
  - `verifyLoginLink(deps, token, now, locale: Locale)`, which passes the locale to `findOrCreateUser`
  - `buildReminder({ ...existing, locale: Locale })`
  - `runReminder` reads the locale itself via `getUserLocale(db, userId)`. Its signature is unchanged, so `app/routes/reminder.ts` and `runAllReminders` need no edits.

- [ ] **Step 1: Write failing tests:**
  - login: the `en` email subject is `'Login link · AI Cards'`, and its text contains the link and `15 minutes`; the `pl` email is unchanged from today. `requestLoginLink(..., 'en')` sends a link ending in `&lang=en`. `verifyLoginLink(deps, token, now, 'en')` for a new address creates a user with `getUserLocale === 'en'`.
  - reminder: `buildReminder({ due: 1, fresh: 0, streak: 0, appUrl, locale: 'en' }).subject` is `'1 card to review'`, and with `due: 2` it is `'2 cards to review'`. The `en` html contains `<html lang="en">`. The `pl` outputs equal today's (existing tests pass `locale: 'pl'`).
  - reminder-job: after `setUserLocale(db, U, 'en')`, the mail sent by `runReminder` has an English subject.
- [ ] **Step 2:** `npx vitest run tests/login.test.ts tests/reminder.test.ts tests/reminder-job.test.ts` → FAIL
- [ ] **Step 3: Implement.** Keep the Polish copy byte-identical. Write the English copy to match each Polish line: subject variants, status, timing line, streak line, button labels ("Start review", "Start learning", "Open the app"), and footer. Use `n === 1 ? 'card' : 'cards'` for English plurals. `<html lang>` follows the locale.
- [ ] **Step 4:** `npm test` → all PASS
- [ ] **Step 5: Commit** `feat: send login and reminder emails in the user's language`

### Task 4: Dictionary, switch, root wiring, landing page

**Files:**
- Create: `app/lib/i18n.ts`
- Create: `app/routes/locale.ts`; register `route('locale', 'routes/locale.ts')` in `app/routes.ts`
- Create: `app/welcome/locale-switch.tsx`
- Modify: `app/root.tsx` (loader returns `locale`; `<html lang={locale}>`)
- Modify: `app/welcome/landing.tsx`
- Modify: `app/app.css` (`.locale-switch`, styled like `.theme-switch`)
- Modify: `CLAUDE.md` (one Architecture bullet: locale cookie plus `users.locale` for mail, the `useT()` / `dict[locale]` convention, and "every new string goes into both `pl` and `en`")

**Interfaces:**
- Consumes: Task 1 and `setUserLocale` (Task 2).
- Produces:
  - `const pl = { ... }` in `app/lib/i18n.ts`, grouped by screen (`landing`, `login`, `verify`, `home`, `cards`, `card`, `review`, `learn`, `admin`, `error`, `common`). Strings containing numbers are functions, e.g. `cardsCount: (n: number) => string`, and the Polish ones use `pluralKarty` / `pluralNowa` from `app/lib/reminder.ts`.
  - `export type Dict = typeof pl`; `const en: Dict`; `export const dict: Record<Locale, Dict>`
  - `export function useT(): Dict`, which reads `useRouteLoaderData<typeof rootLoader>('root')?.locale` (`'pl'` when undefined) and returns `dict[locale]`
  - `POST /locale` with form fields `locale` and `redirectTo`. It is public (no `requireAuth`). It sets `localeCookie(toLocale(...))`; when `getUserId(request, env)` is non-null it also calls `setUserLocale`; then it redirects to `safeRedirect(redirectTo)`.
  - `<LocaleSwitch />`: a `<Form method="post" action="/locale">` with two submit buttons labelled `PL` / `EN`, `aria-pressed` set on the current one, and a hidden `redirectTo` holding the current path plus query (`useLocation`)

- [ ] **Step 1:** Write `i18n.ts` with the `landing` and `common` sections filled. Add the other sections as each later task needs them.
- [ ] **Step 2:** Wire up root, the route, the switch, and the landing page (the switch goes in `.landing-header` next to "Log in"). Translate every string on the landing page outside the demo cards.
- [ ] **Step 3:** `npm run typecheck` → passes. Temporarily delete one key from `en` and confirm it errors, then restore it.
- [ ] **Step 4: Manual check** (`npm run dev`): a fresh visit to `/` is Polish with `<html lang="pl">`. EN switches to English and stays English after a reload. A forged `redirectTo=//evil.com` lands on `/`.
- [ ] **Step 5: Commit** `feat: Polish/English switch and translated landing page`

### Task 5: Login and verify screens

**Files:**
- Modify: `app/routes/login.tsx`, `app/routes/login-verify.tsx`, `app/lib/i18n.ts` (`login`, `verify`)

**Interfaces:**
- Consumes: `useT`, `dict`, `<LocaleSwitch />` (Task 4); `requestLoginLink(..., locale)` and `verifyLoginLink(..., locale)` (Task 3).
- Server-text pattern used from here on: an action computes `const t = dict[parseLocale(request.headers.get('Cookie'))]` and returns already-translated text. This is the single approach for every action.

- [ ] **Step 1:** In the login action, pass `parseLocale(cookie)` to `requestLoginLink`. Translate `'Enter a valid email address'`. Put `<LocaleSwitch />` on the page.
- [ ] **Step 2:** The verify loader returns `lang: toLocale(searchParams.get('lang'))`. The form posts it as a hidden field. The action passes it to `verifyLoginLink` and adds `localeCookie(lang)` as a second `Set-Cookie` next to the session cookie (use `Headers.append`). Translate the error and the buttons using the link's `lang`, so a user reading the link in a fresh browser sees their own language.
- [ ] **Step 3:** `npm run typecheck && npm test` → pass
- [ ] **Step 4: Manual check:** pick EN, request a link (on localhost without Resend configured, `mailSenderFromEnv` prints the mail, link included, to the dev-server console), open it in a private window. The verify page is English, and after login the home screen is English. In D1 (`npx wrangler d1 execute DB --local --command "select email, locale from users"`) the new user has `en`.
- [ ] **Step 5: Commit** `feat: translate login and keep the sign-up language on new accounts`

### Task 6: Home, cards list, card detail

**Files:**
- Modify: `app/routes/home.tsx`, `app/routes/cards.tsx`, `app/routes/card-detail.tsx`, `app/lib/i18n.ts` (`home`, `cards`, `card`)

**Interfaces:**
- Consumes: `useT`, `dict`, `<LocaleSwitch />`, and the server-text pattern (Task 5).

- [ ] **Step 1:** Translate every visible string, including `aria-label`, `placeholder`, `title` and `alt` attributes, and action errors (`'Type a word first'`, the two card-detail errors). `err.message` coming from `diff.ts` stays as it is. Put `<LocaleSwitch />` in home's settings block next to the theme switch.
- [ ] **Step 2:** `npm run typecheck && npm test` → pass
- [ ] **Step 3: Manual check:** in both languages, walk through add word → pending → ready, retry, the cards list, card detail edit and save, and the reminder on/off and test-send buttons. Check the plurals with 1, 2, 5 and 12 cards.
- [ ] **Step 4: Commit** `feat: translate home and card screens`

### Task 7: Review, learn, admin, error page

**Files:**
- Modify: `app/routes/review.tsx`, `app/routes/learn.tsx`, `app/routes/admin.tsx`, `app/routes/reminder.ts` (the `reminderError` text), `app/root.tsx` (`ErrorBoundary`), `app/lib/i18n.ts` (`review`, `learn`, `admin`, `error`)

**Interfaces:**
- Consumes: `useT`, `dict`, and the server-text pattern (Task 5). `ErrorBoundary` uses `useT()`; when root loader data is missing it falls back to `pl`.

- [ ] **Step 1:** Translate every visible string, including the keyboard-hint text in review and learn. Do **not** translate the AI verdict or notes, card sentences, or `feedback-notes` content.
- [ ] **Step 2:** `npm run typecheck && npm test` → pass
- [ ] **Step 3: Manual check:** in both languages, a flip review, a write-it review with a wrong answer (the AI feedback stays in its current language while the labels around it switch), learn for a new card, `/admin`, and `/nope` showing a 404.
- [ ] **Step 4:** `grep -rnE ">[A-Z][a-z]+[^<{]*<" app/routes app/welcome app/root.tsx` lists nothing left but demo content and the brand name.
- [ ] **Step 5: Commit** `feat: translate review, learn, admin and error screens`
