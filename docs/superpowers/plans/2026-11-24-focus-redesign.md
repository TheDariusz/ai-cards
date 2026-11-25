# "Skupienie" (Focus) Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The signed-in app gets the approved "Skupienie" layout: a Today screen with one primary card, tab/sidebar navigation, separate Settings and Streak screens, and restyled Cards, Learn, Review and Login.

**Architecture:** Screen decisions that can be wrong live in pure, unit-tested helpers (`app/lib/today.ts`, additions to `app/lib/streak.ts`); routes only read data and render. A layout route (`app/routes/shell.tsx`) wraps Today, Cards and Settings and renders the navigation. One behaviour change sits in the repo: finishing first learning can complete the day.

**Tech Stack:** React Router 8 (framework mode) on Cloudflare Workers, D1 + Drizzle, Vitest + better-sqlite3, hand-written CSS in `app/app.css`.

**Spec:** `docs/superpowers/specs/2026-11-24-focus-redesign-design.md`
**Mockup source:** `docs/superpowers/specs/2026-11-24-focus-redesign-mockups.html` — open it in a browser. Its `<style>` block holds the reference values (radii, paddings, font sizes, the two new tokens) for every pattern named below. Markup in it is illustrative; class names in the app are yours unless a task fixes one.

## Global Constraints

- No Tailwind utilities, no component library, no UI test infrastructure. Styles are semantic classes in `app/app.css`.
- `app/` style: no semicolons, single quotes, 2-space indent. `root.tsx`, `entry.server.tsx`, `workers/app.ts`, `vite.config.ts` keep template style and are not touched.
- Tokens, fonts and the theme mechanism stay. Add exactly two tokens, in all three theme blocks: `--ok-soft` (`#e3f3ec` light, `#1a3229` dark) and `--bad-soft` (`#fbecec` light, `#33202a` dark). No colour is defined only inside a theme block.
- Every new string goes into both `pl` and `en` in `app/lib/i18n.ts`. Polish copy is given in the tasks; write the English equivalent in the tone of the existing `en` block.
- Every loader/action starts with `requireAuth` and passes `userId` to every repo call. The only new exception is the shell loader (Task 3).
- `app/db/repo.ts` stays the only file that touches Drizzle.
- No emoji as icons: 🔥 ⏳ ⚙ ← 🎉 are replaced by inline SVG icons or removed.
- Touch targets at least 44px high; every control has a visible focus state.
- Untouched: the landing page (`app/welcome/landing.tsx` and its styles), the card pipeline, grading, auth, credits logic, the PWA manifest.
- Sidebar breakpoint: `min-width: 900px`.
- Work on a new branch `feat/focus-redesign` cut from `master`. Conventional commits. Never run `npm run deploy`.
- Node 24 for tests.

## Review Focus

1. **A user whose only card is stuck or failed.** Today must show the Preparing card with Retry, never "Nothing to review". Pinned in Task 1 (`todayState` with `ready: 0`).
2. **Learning a word while reviews are due.** It must not complete the day. Pinned in Task 2.
3. **Week strip on a Sunday and across a year boundary.** Monday-first weeks must not drift. Pinned in Task 1 (`weekDays`).
4. **Guest and stale-cookie requests to `/` through the shell loader.** A guest gets the landing page with no navigation; a blocked or invalid session behaves exactly as before. Pinned in Task 3 (curl check).
5. **Long words and narrow screens.** A 40-character word in "start with <word>", in a Cards row and in "Generating:" must not cause horizontal scroll at 375px. Pinned in Tasks 5 and 7 (browser check).

## Verifying in the browser

Tasks 3–9 end with a browser check. Start the dev server with the `ai-cards-dev` entry in `.claude/launch.json` (port 5173). Sign in through `/login` with a test address; without a Resend key the link is printed in the dev-server log. If the log shows no link, stop and ask the human for a session — do not read `.dev.vars`.

Put the local database into the needed state with `npx wrangler d1 execute DB --local --command "<sql>"` (tables: `cards`, `day_log`, `review_log`, `credit_grants`, `usage_log`; see `app/db/schema.ts`). Check each screen at 375×812 and 1280×800, in light and dark (`POST /theme`), and confirm `document.documentElement.scrollWidth <= window.innerWidth` and an empty error console.

---

### Task 1: Pure helpers for Today and Streak

**Files:**
- Modify: `app/lib/streak.ts`
- Create: `app/lib/today.ts`
- Test: `tests/streak.test.ts`, `tests/today.test.ts` (new)

**Interfaces:**
- Produces, in `app/lib/streak.ts`:
  - `longestStreak(completedDays: string[]): number` — longest run of consecutive day keys; input may be unsorted and contain duplicates.
  - `weekDays(today: string): string[]` — the 7 day keys, Monday to Sunday, of the week containing `today`.
  - `monthGrid(today: string): (string | null)[]` — leading `null`s so the 1st lands on its Monday-first column, then every day key of `today`'s month.
- Produces, in `app/lib/today.ts`:
  - `reviewMinutes(due: number): number`
  - `type TodayState = 'first-run' | 'preparing' | 'review' | 'learn' | 'done' | 'nothing-due'`
  - `todayState(i: { total: number; ready: number; due: number; newCount: number; todayDone: boolean }): TodayState`
  - `formatDayLine(today: string, locale: Locale): string` — weekday, day and month for a day key, `pl-PL` or `en-GB`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/streak.test.ts — add
describe('longestStreak', () => {
  it('finds the longest run, ignoring order and duplicates', () => {
    expect(longestStreak(['2026-11-03', '2026-11-01', '2026-11-02', '2026-11-02', '2026-11-05'])).toBe(3)
  })
  it('crosses month ends', () => expect(longestStreak(['2026-10-31', '2026-11-01'])).toBe(2))
  it('is 0 for no days', () => expect(longestStreak([])).toBe(0))
})
describe('weekDays', () => {
  it('starts on Monday', () => {
    expect(weekDays('2026-11-24')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
  })
  it('puts a Sunday at the end of its week', () => expect(weekDays('2026-11-01')[0]).toBe('2026-10-26'))
  it('crosses a year boundary', () => expect(weekDays('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']))
})
describe('monthGrid', () => {
  it('pads to the Monday-first column and lists the whole month', () => {
    const g = monthGrid('2026-11-24') // 1 Nov 2026 is a Sunday
    expect(g.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(g.length).toBe(6 + 30)
    expect(g.at(-1)).toBe('2026-11-30')
  })
  it('needs no padding when the month starts on Monday', () => expect(monthGrid('2027-02-10')[0]).toBe('2027-02-01'))
})
```

```ts
// tests/today.test.ts
const base = { total: 5, ready: 5, due: 0, newCount: 0, todayDone: false }
describe('todayState', () => {
  it('first run when there are no cards', () => expect(todayState({ ...base, total: 0, ready: 0 })).toBe('first-run'))
  it('preparing when cards exist but none is ready', () => expect(todayState({ ...base, total: 1, ready: 0 })).toBe('preparing'))
  it('review wins whenever something is due', () => expect(todayState({ ...base, due: 3, newCount: 2, todayDone: true })).toBe('review'))
  it('learn when nothing is due, the day is open and new cards wait', () => expect(todayState({ ...base, newCount: 2 })).toBe('learn'))
  it('done when nothing is due and the day is complete, even with new cards', () => expect(todayState({ ...base, newCount: 2, todayDone: true })).toBe('done'))
  it('nothing due otherwise', () => expect(todayState(base)).toBe('nothing-due'))
})
describe('reviewMinutes', () => {
  it('is 30 seconds per card, rounded, at least 1', () => {
    expect([1, 2, 3, 12, 25].map(reviewMinutes)).toEqual([1, 1, 2, 6, 13])
  })
})
describe('formatDayLine', () => {
  it('formats in Polish', () => expect(formatDayLine('2026-11-24', 'pl')).toBe('wtorek, 24 listopada'))
  it('formats in English', () => expect(formatDayLine('2026-11-24', 'en')).toMatch(/Tuesday.*24.*November/))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/streak.test.ts tests/today.test.ts`
Expected: FAIL — the functions are not exported.

- [ ] **Step 3: Implement the helpers**

Day-key arithmetic follows `prevDay` in `streak.ts` (noon UTC, so DST cannot shift the date). `formatDayLine` formats noon UTC of the day key with `timeZone: 'UTC'`, options `{ weekday: 'long', day: 'numeric', month: 'long' }`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/streak.test.ts tests/today.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add pure helpers for the today and streak screens"`

---

### Task 2: Learning can complete the day; shared "new card" predicate

**Files:**
- Modify: `app/db/repo.ts` (`completeFirstLearning`, new export)
- Test: `tests/repo.test.ts`

**Interfaces:**
- Changes: `completeFirstLearning(db, userId, cardId, now): Promise<boolean>` — same signature. After a successful update, when `countDue(db, userId, now) === 0`, insert `{ userId, date: dayKey(now) }` into `day_log` with `onConflictDoNothing`, exactly as `applyReview` does.
- Produces: `isNewCard(card: Pick<Card, 'status' | 'firstLearnedAt' | 'decodeParts'>): boolean` — the in-memory twin of `newCardCondition` (ready, not learned, has decode parts).

- [ ] **Step 1: Write the failing tests** (in `tests/repo.test.ts`, using the file's existing `NOW`, `CONTENT`, `U` and card-creation pattern)

```ts
describe('completeFirstLearning and the day', () => {
  it('completes the day when nothing is due', async () => {
    // one ready, unlearned card; no other cards
    expect(await completeFirstLearning(db, U, id, NOW)).toBe(true)
    expect(await isDayDone(db, U, dayKey(NOW))).toBe(true)
  })
  it('does not complete the day while a review is due', async () => {
    // a second card, already learned, with dueAt <= NOW
    expect(await completeFirstLearning(db, U, id, NOW)).toBe(true)
    expect(await isDayDone(db, U, dayKey(NOW))).toBe(false)
  })
  it('does not complete the day when the card was not learnable', async () => {
    // pending card
    expect(await completeFirstLearning(db, U, id, NOW)).toBe(false)
    expect(await isDayDone(db, U, dayKey(NOW))).toBe(false)
  })
})
describe('isNewCard', () => {
  it('agrees with getNewCards for every card state', async () => {
    // pending, failed, ready without decode parts, ready with decode parts, ready and learned
    const all = await listCards(db, U)
    expect(all.filter(isNewCard).map((c) => c.id).sort()).toEqual((await getNewCards(db, U)).map((c) => c.id).sort())
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/repo.test.ts`; expected: the first test fails on `isDayDone`, the last on the missing export.
- [ ] **Step 3: Implement** both changes in `app/db/repo.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/repo.test.ts tests/reminder-job.test.ts` — expected: PASS (the reminder job reads `isDayDone` and must be unaffected).
- [ ] **Step 5: Commit** — `git commit -m "feat: finishing first learning completes the day when nothing is due"`

---

### Task 3: Style foundation, icons and the navigation shell

**Files:**
- Modify: `app/app.css` (tokens, shared patterns, shell), `app/routes.ts`, `app/lib/i18n.ts`, `CLAUDE.md`
- Create: `app/ui/icons.tsx`, `app/routes/shell.tsx`

**Interfaces:**
- Produces `app/ui/icons.tsx`: `Icon({ name }: { name: 'flame' | 'back' | 'close' | 'check' | 'home' | 'cards' | 'gear' })` — inline SVG, `aria-hidden`, stroke `currentColor`, stroke width 1.9, sized `1.15em`. Paths are in the mockup file's `<symbol>` block.
- Produces `app/routes/shell.tsx`: layout route. Loader returns `null` for a guest, otherwise `{ total: number; isOwner: boolean; credits: { left: number; granted: number; spentMicros: number } }`.
- Produces CSS classes later tasks rely on: `.shell`, `.shell-nav` (the `<nav>`), `.primary-card`, `.surface-card`, `.section-label`, `.segmented`, `.task-head` (back/close + progress + count row), `.bottom-actions`.
- Produces i18n: `nav: { today: 'Dziś', cards: 'Karty', settings: 'Ustawienia' }`.

- [ ] **Step 1: Add the two tokens and the shared patterns to `app/app.css`**

Primary card: accent fill, `--on-accent` text, radius 22px, padding 18px. Surface card: `--surface`, `1px solid var(--edge)`, radius 18px, padding 14px. Section label: 11px, uppercase, `letter-spacing: 0.07em`, `--muted`, weight 600. `.segmented` takes over the rules now shared by `.theme-switch, .reminder-segment, .locale-switch`; keep those three selectors pointing at it until Task 4 and Task 9 remove their markup. `.page` stays the 520px column for task screens.

- [ ] **Step 2: Create `app/ui/icons.tsx`** per the interface above.

- [ ] **Step 3: Create the shell route and register it**

`app/routes.ts`: wrap `index('routes/home.tsx')` and `route('cards', …)` in `layout('routes/shell.tsx', [...])`. Task 4 adds `settings` to the same layout. `cards/:id` stays outside it.

Loader: `getUserId(request, env) === null` → return `null`; otherwise `requireAuth`, then `listCards` length and `getBalance`, with `isOwner = userId === OWNER_USER_ID`.

Component: with `null` loader data render only `<Outlet />`. Otherwise render `<div className="shell">` containing `<nav className="shell-nav" aria-label={t.nav…}>` and the outlet. Links are `NavLink` (it sets `aria-current="page"`), each an icon plus label; `/` uses `end`.
- Below 900px: `.shell-nav` is a bottom bar fixed to the viewport bottom, three equal items, `padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px))`; the content gets bottom padding so nothing hides behind it.
- From 900px: `.shell` is a two-column grid, `.shell-nav` a 208px sidebar with the logo (`/logo-light.png` / `/logo-dark.png`, as the landing header does), the links (Cards shows `total`), and at the bottom `t.home.credits(left, granted)` or, for the owner, `t.home.spent(…)`. Content column max-width 880px.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: both pass.

- [ ] **Step 5: Verify guest and signed-in rendering**

Run: `curl -s http://localhost:5173/ | grep -c 'shell-nav'` → `0` (guest sees the landing page without navigation).
Run: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Cookie: <session cookie name from app/lib/session.ts>=garbage' http://localhost:5173/` → the same output as on `master` for that request (run it on `master` first and compare).
Browser, signed in: `/` and `/cards` show the bottom bar at 375px and the sidebar at 1280px; the current item has `aria-current="page"`; `/learn`, `/review` and `/cards/1` show no navigation.

- [ ] **Step 6: Record the new public exception in `CLAUDE.md`**

In the Architecture bullet that lists public exceptions, add the `shell` layout loader next to the `home` loader's guest branch, with the same wording ("no session at all … any cookie still goes through `requireAuth`").

- [ ] **Step 7: Commit** — `git commit -m "feat: add navigation shell, icons and shared card styles"`

---

### Task 4: Settings screen

**Files:**
- Create: `app/routes/settings.tsx`
- Modify: `app/routes.ts`, `app/routes/home.tsx` (remove the settings block and logout form), `app/lib/i18n.ts`, `app/app.css`

**Interfaces:**
- Consumes: shell layout (Task 3), `.surface-card`, `.section-label`, `.segmented`; existing actions `POST /theme`, `POST /locale`, `POST /reminder`, `POST /logout`; `LocaleSwitch` from `app/welcome/locale-switch.tsx`.
- Produces: route `/settings` inside the shell layout. Loader returns `{ email: string | null; reminderEnabled: boolean; isOwner: boolean; credits: { left: number; granted: number; spentMicros: number } }`.

- [ ] **Step 1: Add the strings.** New `settings` block (move, do not duplicate, the keys the home block no longer needs: `exportCsv`, `backupJson`, `users`, `theme`, `on`, `off`, `sendTest`, `sending`, `sent`, `logOut`; `reminderNotConfigured` and `reminderFailed` stay where `app/routes/reminder.ts` reads them or move with an update there). Polish copy:

| Key | Polish |
|---|---|
| `title` | Ustawienia |
| `appearance` / `themeLabel` / `languageLabel` | Wygląd / Motyw / Język |
| `reminder` / `reminderLabel` | Przypomnienie / Mail o 19:00, gdy coś czeka |
| `sendTest` | Wyślij testowy mail |
| `credits` / `creditsLeft(left, granted)` / `creditsNote` | Kredyty / `${left} z ${granted}` / zużywa je AI |
| `data` / `exportCsv` / `backupJson` | Twoje dane / Eksport do CSV (Anki) / Kopia zapasowa (JSON) |

- [ ] **Step 2: Build the route.** Cards in the spec's order: Appearance, Reminder, Credits, Your data, then the footer line with e-mail and Log out. The reminder on/off is one switch-styled submit button (`aria-pressed`, posts `intent=on|off` with the opposite of the current value); the test-mail link and its success/error messages behave as on home today (fetcher, `/reminder`). The theme form posts `redirectTo=/settings`. Credits: a `<meter>`-like bar at `left / granted` for users; the owner sees `t.home.spent(…)` and no bar. `/admin` link only for the owner.

- [ ] **Step 3: Remove the settings `<details>` and the logout form from `UserHome`,** and `reminderEnabled` plus the theme read from its loader/component. Delete CSS rules whose markup is gone (`.settings*`, `.logout`, `.reminder-switch`).

- [ ] **Step 4: Typecheck and test** — `npm run typecheck && npm test`; expected: pass. `tests/i18n.test.ts` must still pass (it compares the two dictionaries).

- [ ] **Step 5: Browser check.** On `/settings`: switching theme and language keeps you on `/settings`; toggling the reminder flips `aria-pressed` and survives a reload; "send test" shows the sent or the error message; CSV and JSON links download; Log out lands on the landing page. As the owner (user id 1): "Spent" replaces the meter and the admin link is present. Both widths, both themes.

- [ ] **Step 6: Commit** — `git commit -m "feat: move settings to their own screen"`

---

### Task 5: Today screen

**Files:**
- Modify: `app/routes/home.tsx` (loader and `UserHome`; `Landing` and the `action` are untouched), `app/lib/i18n.ts`, `app/app.css`

**Interfaces:**
- Consumes: `todayState`, `reviewMinutes`, `formatDayLine` (Task 1), `weekDays` (Task 1); `Icon`; `.primary-card`, `.surface-card`.
- Loader (signed-in branch) returns: `state: TodayState`, `today: string`, `week: { day: string; done: boolean }[]`, `streak: number`, `due: number`, `minutes: number`, `newCards: { id: number; word: string }[]`, `pending`, `failed` (as today), `reviewedToday: number` (`countReviewsOn`), `learnedToday: number` (cards whose `firstLearnedAt` has today's day key), `nextDue: string | null` (day key of `nextDueAt(db, userId, now)`), `isOwner`, `credits`, `outOfCredits`.
  `ready` for `todayState` = cards with `status === 'ready'`; `todayDone` = today's key is in `completedDays`.

- [ ] **Step 1: Add the strings.**

| Key | Polish |
|---|---|
| `today` | Dziś |
| `firstTitle` / `firstBody` / `firstPlaceholder` | Dodaj pierwsze słowo / Takie, które ostatnio usłyszałeś i chcesz zapamiętać. / np. reluctant |
| `stepNow` / `stepThen` / `stepTomorrow` | Teraz: AI przygotuje fiszkę ze zdaniem i nagraniem. / Potem: uczysz się zdania krok po kroku. / Jutro: słowo wraca w powtórce, coraz rzadziej. |
| `starterNote(n)` | Na start masz ${n} kredytów. Jedna fiszka to kilka kredytów. |
| `preparingTitle` / `preparingBody(word)` | Przygotowuję Twoją pierwszą kartę / „${word}” będzie gotowe za chwilę. |
| `reviewLine(n, min)` | `${pluralKarty(n)} do powtórki · ok. ${min} min` |
| `newWords(n)` | `${n}` + nowe słowo / nowe słowa / nowych słów |
| `doneTitle` / `doneReviewed(n)` / `doneLearned(n)` | Na dziś wszystko / `${n}` + powtórzona karta… Kolejne wrócą jutro. / `${n}` + nowe słowo poznane… Pierwsza powtórka jutro. |
| `nothingTitle` / `nothingNext(date)` | Nic do powtórki na dziś / Następna powtórka: ${date} |
| `weekLabel` | Ten tydzień |

The step keys keep the label ("Teraz", "Potem", "Jutro") and the sentence as separate values so the label can be styled. Plural forms use `plForm` like the existing keys. Existing keys reused: `newWord`, `add`, `startReview`, `learnNow`, `startWith`, `generating`, `failed`, `retry`, `added`.

- [ ] **Step 2: Rewrite `UserHome`** in the spec's order (header, add-word, primary card, new-words tile, week strip, status line).

Decisions the spec leaves to this task:
- The primary card is one component switching on `state`. `first-run` renders the add-word form inside the card and the separate add-word row is not rendered; out of credits, the no-credits message replaces the field in both places.
- `preparing`: when a failed (or stuck) card exists, the card shows `t.home.failed(word)` with the Retry form instead of the "preparing" copy.
- Streak chip: `<Link to="/streak">` with the flame icon and the number; not rendered when `streak === 0`. The week strip is also one link to `/streak`, with `aria-label` built from `weekLabel` and the streak.
- Week strip days are labelled with the two-letter weekday in the UI locale (`Intl.DateTimeFormat(…, { weekday: 'short' })` on the day key); a done day gets class `done`, today (when not done) class `today`.
- The new-words tile is hidden when `state === 'learn'` or when there are no new cards.
- `nothingNext` formats `nextDue` with `formatDayLine`.
- Desktop (from 900px): header and add-word row span the content; below them a two-column grid (`1.15fr 1fr`) — primary card left; tile, a surface card titled `weekLabel` holding the strip, and the status line right.
- The 3-second polling effect and `autoFocus` on the add-word input stay.

- [ ] **Step 3: Delete dead CSS** (`.stats`, `.stat`, `.new-queue`, `.calendar`, `.nav`, `.nav-tile`, `.home-head`, `.streak-chip` if renamed).

- [ ] **Step 4: Typecheck and test** — `npm run typecheck && npm test`; expected: pass.

- [ ] **Step 5: Browser check of all six states.** Seed each with SQL (see "Verifying in the browser") and confirm the primary card:

| State | Seed | Expect |
|---|---|---|
| first-run | no cards | title "Dodaj pierwsze słowo", field inside the card, three steps below, no streak chip |
| preparing | one `pending` card created now | "Przygotowuję…" with the word; after setting it `failed`, the Retry button |
| review | ready, learned cards with `due_at` in the past | count, "ok. N min", button opens `/review` |
| learn | no due cards, one ready unlearned card with decode parts, no `day_log` row for today | new-words card with "Ucz się", no separate tile |
| done | as learn, plus a `day_log` row for today | "Na dziś wszystko" on the soft green card; the new-words tile is visible below |
| nothing-due | learned cards all due in the future, no `day_log` row | "Nic do powtórki na dziś" with a date |

Also: a 40-character word in `newCards[0]` and in `pending` does not cause horizontal scroll at 375px; out of credits replaces the field with the message; both themes; at 1280px the two-column layout holds.

- [ ] **Step 6: Commit** — `git commit -m "feat: rebuild the home screen around one card for today"`

---

### Task 6: Streak screen

**Files:**
- Create: `app/routes/streak.tsx`
- Modify: `app/routes.ts` (outside the shell layout), `app/lib/i18n.ts`, `app/app.css`

**Interfaces:**
- Consumes: `computeStreak`, `longestStreak`, `monthGrid`, `dayKey`; `completedDays`, `listCards`; `.task-head`, `.surface-card`.
- Loader returns `{ today: string; streak: number; longest: number; grid: (string | null)[]; done: string[] (this month); total: number }`.

- [ ] **Step 1: Add the strings.** `streak: { title: 'Seria', inARow(n): dzień / dni z rzędu, longest(n): 'najdłuższa seria: ${n}', studyDays: 'dni nauki w tym miesiącu', totalCards: 'kart łącznie' }`. The month name comes from `Intl.DateTimeFormat(locale, { month: 'long' })`, capitalised in CSS.
- [ ] **Step 2: Build the route.** `.page` column; header row with a back link to `/` and the title; the streak as a large number beside `inARow` and `longest`; a surface card with the month name, a 7-column weekday header and the grid — `null` cells are empty, days in `done` get class `done`, today (when not done) `today`, days after today `future`; two small surface cards for `done.length` and `total`. The calendar is a `<table>` or a list with each day's state in its accessible name — not colour alone.
- [ ] **Step 3: Typecheck and test** — `npm run typecheck && npm test`; expected: pass.
- [ ] **Step 4: Browser check.** With `day_log` rows for 1–3 and 5 of the current month plus yesterday and today: streak and longest match hand-counted values, the 1st sits under the correct weekday, future days are dimmed, no navigation bar is shown, back returns to `/`. Both widths, both themes.
- [ ] **Step 5: Commit** — `git commit -m "feat: add the streak screen with the month calendar"`

---

### Task 7: Cards list

**Files:**
- Modify: `app/routes/cards.tsx`, `app/lib/i18n.ts`, `app/app.css`

**Interfaces:**
- Consumes: `isNewCard` (Task 2), shell layout, `.surface-card`.
- Loader maps each card to `{ id, word, wordPl, sentenceEn, tag: 'pending' | 'failed' | 'new' | null }` — `new` from `isNewCard`, otherwise the non-ready status, otherwise `null`. It no longer sends whole card rows to the client.

- [ ] **Step 1: Add the strings.** `cards.tag: { pending: 'generuję…', failed: 'błąd', new: 'nowa' }`, `cards.empty: 'Nie masz jeszcze kart. Dodaj pierwsze słowo na ekranie Dziś.'`. Remove `cards.status` if nothing else reads it.
- [ ] **Step 2: Rebuild the list.** Title with the total count on the right (no back arrow — the shell navigates). One surface card with a row per card: word in bold, ` · wordPl` muted when present, tag chip on the right when `tag` is set, the English sentence below in Literata on one line with ellipsis (omitted when missing). Each row is one link to `/cards/:id`. Empty list shows `cards.empty` with a link to `/`. Desktop: a single column of about 640px.
- [ ] **Step 3: Typecheck and test** — `npm run typecheck && npm test`; expected: pass.
- [ ] **Step 4: Browser check.** Cards in every state show the right tag (a ready card without decode parts shows none); a 40-character word and a 200-character sentence do not cause horizontal scroll at 375px; the empty state appears for a user without cards. Both widths, both themes.
- [ ] **Step 5: Commit** — `git commit -m "feat: restyle the cards list"`

---

### Task 8: Learn and Review

**Files:**
- Modify: `app/routes/learn.tsx`, `app/routes/review.tsx`, `app/lib/i18n.ts`, `app/app.css`

**Interfaces:**
- Consumes: `Icon`, `.task-head`, `.section-label`, `.surface-card`, `.segmented`, `.bottom-actions`, `--bad-soft`.
- No loader, action or keyboard-handler changes. `Sentence`, `Decode`, `FlipCard`, `WriteCard` keep their props.

- [ ] **Step 1: Shared header.** `.task-head` is one row: icon link to `/` (`back` in learn, `close` in review, with an `aria-label`), the progress bar, a count.
  - Review: bar and `aria-*` values exactly as today; count is `t.left(left)`. The streak is removed from this header.
  - Learn: bar is `(step + 1) / 4`; count reads `${step + 1} / 4`. Directly below, a section label shows the existing `t.step(...)` name of the step, and the line with the word and `remaining` new cards (today's `<h1>` content) follows as muted text.
- [ ] **Step 2: Learn body.** Decode pairs become bordered surface chips; the pair containing the headword gets the accent border and `--accent-soft` fill. The natural Polish sentence sits in a surface card under a section label. The step's primary button(s) sit in `.bottom-actions`: on phones pinned to the bottom of the viewport with safe-area padding, on desktop in normal flow at the end of the column.
- [ ] **Step 3: Review body.** Section label above the Polish prompt. The typed answer and the AI feedback keep their content and order; the verdict block gets a background by verdict — `--bad-soft` for wrong, a plain surface card for minor and correct, text colours as today. The grade row sits in `.bottom-actions` with the "suggested grade" label above it; the suggested button keeps the accent fill; `kbd` hints stay. The write/flip toggle becomes a two-option `.segmented` control under the header (same `setParams` behaviour). `review.allDone` loses its emoji, shows the check icon, and links back to `/`.
- [ ] **Step 4: Typecheck and test** — `npm run typecheck && npm test`; expected: pass.
- [ ] **Step 5: Browser check.** Learn: walk all four steps for one card; the bar advances 25% per step; finishing the last card returns to `/` showing Done (Task 2) when nothing was due. Review: grade one card with each of `1`, `2`, `3` keys in write mode and by clicking in flip mode; the suggested grade is highlighted; with the on-screen keyboard height simulated (viewport 375×500) the grade row is still reachable. Both widths, both themes.
- [ ] **Step 6: Commit** — `git commit -m "feat: restyle learn and review around a shared task header"`

---

### Task 9: Login, remaining screens, cleanup and docs

**Files:**
- Modify: `app/routes/login.tsx`, `app/routes/login-verify.tsx`, `app/routes/card-detail.tsx`, `app/routes/admin.tsx`, `app/lib/i18n.ts`, `app/app.css`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Login.** Top row: logo image (theme-aware, as in the landing header) and `LocaleSwitch`. Below, vertically in the upper-middle on phones (`min-height: 100dvh` column with flexible space above and below at a 1:2 ratio): the existing title (`signUpTitle` / `logInTitle`), a new one-line `login.lead` ("Wyślemy Ci link. Bez hasła, ten sam link zakłada konto."), the e-mail field, a full-width button, the existing hint. The "sent" state keeps its two messages in the same block. Desktop: a centered 400px column. Form fields, action and `?new=1` behaviour are unchanged.
- [ ] **Step 2: Card detail, admin, verify.** Replace "←" headers with the `back` icon link (`aria-label`), put form groups in surface cards, use `.section-label` for field labels where a visible label exists today. No field, action or copy changes.
- [ ] **Step 3: CSS cleanup.** Remove every rule in `app/app.css` with no matching class in `app/` (check each with `grep -rn "<class>" app/`), and the transitional `.theme-switch, .reminder-segment` selectors once nothing uses them. Landing rules stay.
- [ ] **Step 4: Docs.** `CLAUDE.md`: mention that a completed first learning can complete the day (next to the generation/cards bullets) and that `/settings` and `/streak` exist. `README.md`: update any description or screenshot reference of the home screen that names the calendar or the settings block.
- [ ] **Step 5: Full check** — `npm run typecheck && npm test`; expected: pass. `grep -rnE "🔥|⏳|⚙|🎉" app/routes app/ui` → no matches (the landing demo under `app/welcome/` is out of scope).
- [ ] **Step 6: Final browser pass.** Every route at 375×812 and 1280×800, light and dark: `/login`, `/login?new=1`, `/` (six states), `/learn`, `/review` (both modes), `/cards`, `/cards/:id`, `/streak`, `/settings`, `/admin` as owner. No horizontal scroll, empty error console, visible focus ring when tabbing through each screen.
- [ ] **Step 7: Commit** — `git commit -m "feat: restyle login and remaining screens, update docs"`

**Manual, after merge-ready:** the owner judges whether the result matches the approved mockups closely enough and reads the Polish copy on a real phone (human: subjective visual and wording judgement on a real device).
