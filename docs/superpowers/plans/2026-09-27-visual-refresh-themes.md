# Visual Refresh + Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen in direction A · Calm Study with a light and a dark theme (Auto / Light / Dark, cookie-backed, server-rendered), and add a review progress bar, streak in the review header, and a highlighted suggested grade.

**Architecture:** Pure helpers in `app/lib/theme.ts` parse and write the `theme` cookie; the root loader stamps `data-theme` on `<html>` and emits matching `theme-color` metas; an action-only `/theme` route sets the cookie. All colors move to tokens in `app/app.css`. One new repo query (`countReviewsOn`) feeds the progress bar.

**Tech Stack:** React 19 + React Router 8 (framework mode, SSR) on Cloudflare Workers, TypeScript, Vitest 4, hand-written CSS, Google Fonts (Instrument Sans, Literata).

**Spec:** `docs/superpowers/specs/2026-09-27-visual-refresh-themes-design.md`

## Global Constraints

- Token names and hex values exactly as in the spec's Palette table (light on bare `:root`; dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` **and** `:root[data-theme="dark"]`; `color-scheme` set in all three).
- No color literal outside the token blocks in `app/app.css`; no component color defined only inside a theme block.
- No Tailwind utilities, no new dependencies, no schema change. `app/` style: no semicolons, single quotes, 2-space.
- `ErrorBoundary` in `app/root.tsx` stays untouched. Keep `react-router` / `@react-router/dev` at 8.0.0.
- Every loader/action starts with `requireAuth` **except the root loader** (spec: runs on `/login`, returns only the theme).
- Cookie: `theme=<pref>; Path=/; Max-Age=31536000; SameSite=Lax; Secure`.
- UI copy in English: switcher labels **Auto / Light / Dark**; review header `Review · {left} left · 🔥 {streak}`.
- Commands: `npm test`, `npx vitest run tests/<file>.test.ts`, `npm run typecheck` (needs `.dev.vars`). Conventional commits.
- No UI test infra; screens verified in Chromium (Task 6).

## Review Focus

1. **Pinned theme vs OS theme disagree** (Light pinned on a dark phone, and the reverse) → the pinned one wins everywhere, including native inputs/scrollbars (`color-scheme`) and the iOS status bar (`theme-color`). Verified in Task 6 with `colorScheme` emulation.
2. **Switcher used from a page other than home** is not possible today, but `redirectTo` must survive query strings (`/review?mode=flip`) → `safeRedirect` test in Task 1 keeps path+query.
3. **Card-detail Delete button** used `grade-again` for its red fill, which the spec removes → Task 4 gives it a `danger-button` class so it stays visibly destructive.
4. **Progress after "Again"**: an again-graded card stays due, so `left` does not drop while `doneToday` rises → bar still moves forward and never exceeds 100%; value clamped in Task 5.
5. **Learn flow, card detail and login in dark and light** have no automated coverage and many one-off classes (`decode-pair`, `understanding-item`, `hint-button`) → each screen screenshotted in both themes in Task 6.

---

### Task 1: Theme helpers (`app/lib/theme.ts`)

**Files:**
- Create: `app/lib/theme.ts`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Produces: `type ThemePref = 'auto' | 'light' | 'dark'`; `parseTheme(cookieHeader: string | null): ThemePref`; `toThemePref(value: unknown): ThemePref` (form value → pref, unknown → `'auto'`); `themeCookie(pref: ThemePref): string`; `safeRedirect(to: FormDataEntryValue | null): string`; `THEME_BG: Record<'light' | 'dark', string>` = `{ light: '#f6f7fb', dark: '#111421' }`.

- [ ] **Step 1: Write the failing tests** in `tests/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseTheme, safeRedirect, themeCookie, toThemePref } from '../app/lib/theme'

describe('parseTheme', () => {
  it('defaults to auto without a cookie', () => expect(parseTheme(null)).toBe('auto'))
  it('reads light', () => expect(parseTheme('theme=light')).toBe('light'))
  it('reads dark among other cookies', () => expect(parseTheme('__session=abc; theme=dark; x=1')).toBe('dark'))
  it('treats an unknown value as auto', () => expect(parseTheme('theme=blue')).toBe('auto'))
  it('does not match a cookie merely ending in theme', () => expect(parseTheme('mytheme=dark')).toBe('auto'))
})

describe('toThemePref', () => {
  it('accepts the three prefs', () => expect(['auto', 'light', 'dark'].map(toThemePref)).toEqual(['auto', 'light', 'dark']))
  it('maps anything else to auto', () => expect(toThemePref(null)).toBe('auto'))
})

describe('themeCookie', () => {
  it('builds a year-long lax secure cookie', () => {
    const c = themeCookie('dark')
    for (const part of ['theme=dark', 'Path=/', 'Max-Age=31536000', 'SameSite=Lax', 'Secure']) expect(c).toContain(part)
    expect(c).not.toContain('HttpOnly')
  })
})

describe('safeRedirect', () => {
  it('keeps an in-app path with its query', () => expect(safeRedirect('/review?mode=flip')).toBe('/review?mode=flip'))
  it.each([null, '', 'https://x.com', '//x.com', '/\\x.com', 'review'])('rejects %s', (to) => {
    expect(safeRedirect(to)).toBe('/')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/theme.test.ts` — expected FAIL: module not found.
- [ ] **Step 3: Implement** `app/lib/theme.ts` with the signatures above. `parseTheme` splits the header on `;`, trims, and looks for a part whose name is exactly `theme`.
- [ ] **Step 4: Run** `npx vitest run tests/theme.test.ts` — expected PASS.
- [ ] **Step 5: Commit** — `feat: add theme cookie helpers`

---

### Task 2: `countReviewsOn` repo query

**Files:**
- Modify: `app/db/repo.ts` (add function; `applyReview` uses it)
- Test: `tests/repo.test.ts`

**Interfaces:**
- Produces: `countReviewsOn(db: Db, day: string): Promise<number>` — review_log rows with `dayKey(reviewedAt) === day`.

- [ ] **Step 1: Write the failing test** — add to `tests/repo.test.ts` (import `countReviewsOn`):

```ts
describe('countReviewsOn', () => {
  it('counts only reviews on the given Warsaw day', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    const day = dayKey(NOW)
    // Warsaw midnight at the start of `day`, found by stepping back from NOW
    let midnight = NOW
    while (dayKey(midnight - 60_000) === day) midnight -= 60_000
    await db.insert(reviewLog).values([
      { cardId: id, reviewedAt: midnight - 60_000, mode: 'flip', grade: 'good', typed: null }, // previous day
      { cardId: id, reviewedAt: midnight, mode: 'flip', grade: 'good', typed: null },
      { cardId: id, reviewedAt: NOW, mode: 'write', grade: 'again', typed: 'x' },
    ])
    expect(await countReviewsOn(db, day)).toBe(2)
    expect(await countReviewsOn(db, dayKey(midnight - 60_000))).toBe(1)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/repo.test.ts` — expected FAIL: `countReviewsOn` is not a function.
- [ ] **Step 3: Implement** `countReviewsOn` (O(n) scan + `dayKey` filter, same comment style as `applyReview`) and replace `applyReview`'s inline `reviewsToday` computation with `await countReviewsOn(db, today)`.
- [ ] **Step 4: Run** `npx vitest run tests/repo.test.ts` — expected PASS, existing `applyReview` tests unchanged and green.
- [ ] **Step 5: Commit** — `feat: add countReviewsOn and reuse it in applyReview`

---

### Task 3: Server-rendered theme, fonts, `/theme` route, switcher

**Files:**
- Modify: `app/root.tsx` (loader, `Layout`, `links`)
- Create: `app/routes/theme.ts`
- Modify: `app/routes.ts` (`route('theme', 'routes/theme.ts')`)
- Modify: `app/routes/home.tsx` (switcher in footer; `theme` from root data)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: root loader data `{ theme: ThemePref }` (read with `useRouteLoaderData<typeof loader>('root')`); `.theme-switch` form markup for Task 4's CSS.

- [ ] **Step 1: Implement.**
  - `root.tsx`: `export async function loader({ request }: Route.LoaderArgs) { return { theme: parseTheme(request.headers.get('Cookie')) } }` with a one-line comment on why it skips `requireAuth`. In `Layout`: `const theme = useRouteLoaderData<typeof loader>('root')?.theme ?? 'auto'`; `<html lang="en" data-theme={theme === 'auto' ? undefined : theme}>`; replace the single `theme-color` meta with the spec's two media metas for `auto` or one meta with `THEME_BG[theme]`. In `links`, swap the Inter stylesheet URL for `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap`. Keep the file's template style (double quotes, semicolons) in the lines you touch.
  - `app/routes/theme.ts`: action per spec — `requireAuth` → `toThemePref(form.get('theme'))` → `redirect(safeRedirect(form.get('redirectTo')), { headers: { 'Set-Cookie': themeCookie(pref) } })`.
  - `home.tsx` footer: `<Form method="post" action="/theme" className="theme-switch">` with hidden `redirectTo` = `location.pathname + location.search` (`useLocation`), and three `<button name="theme" value=… aria-pressed={theme === value}>` labelled Auto / Light / Dark.
- [ ] **Step 2: Verify** `npm run typecheck` → exit 0; `npm test` → all PASS.
- [ ] **Step 3: Commit** — `feat: server-rendered light/dark theme with Auto/Light/Dark switcher`

---

### Task 4: Tokens and component styles

**Files:**
- Modify: `app/app.css` (rewrite)
- Modify: `app/routes/review.tsx` (`Sentence` → `.study`), `app/routes/learn.tsx` (study sentences, decode chips), `app/routes/card-detail.tsx` (Delete → `danger-button`; sentence textareas → `study`), `app/routes/home.tsx` (Start review → `primary-wide`; streak chip in `h1` row)

**Interfaces:**
- Consumes: `.theme-switch` markup (Task 3).
- Produces: classes Task 5 uses — `.review-head`, `.progress` (+ inner `span`), `.grade-suggested`.

- [ ] **Step 1: Implement** `app/app.css` from the spec: token blocks exactly as the Palette table; then components per the spec's Components section, keeping every existing class name that markup uses (grep `className` in `app/routes` — none may lose its style). New: `.study`, `.danger-button` (`--bad` fill, `--on-accent` text), `.theme-switch` (segmented: `--accent-soft` track, pressed button `--surface` + `--accent` text), `.streak-chip`, `.review-head`, `.progress`, `.grade-suggested`. Drop `.grade-again`/`.grade-easy` fills. Focus ring 3px `--focus`, offset 2px. Keep the existing `@media (hover: none)` and `max-width: 420px` rules.
- [ ] **Step 2: Apply classes** in the route files listed above; the inline `style={{ width: '100%' }}` in home becomes `className="primary-wide"`.
- [ ] **Step 3: Verify** no literal colors remain outside the token blocks: `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app/app.css` lists only lines inside the three token blocks. `npm run typecheck` → 0; `npm test` → PASS.
- [ ] **Step 4: Commit** — `feat: calm study visual refresh with light and dark tokens`

---

### Task 5: Review header, progress bar, suggested grade

**Files:**
- Modify: `app/routes/review.tsx`

**Interfaces:**
- Consumes: `countReviewsOn` (Task 2); `completedDays`, `computeStreak`, `dayKey`; classes from Task 4.

- [ ] **Step 1: Implement.**
  - Loader returns `{ due, streak, doneToday }` with `streak = computeStreak(await completedDays(db), dayKey(now))`, `doneToday = await countReviewsOn(db, dayKey(now))`.
  - Header (non-empty state): `<h1 className="review-head"><Link to="/">←</Link> Review <span className="muted">· {left} left{streak > 0 ? ` · 🔥 ${streak}` : ''}</span></h1>`, then `<div className="progress" role="progressbar" aria-label="Today's reviews" aria-valuemin={0} aria-valuemax={doneToday + left} aria-valuenow={doneToday}><span style={{ width: `${pct}%` }} /></div>` where `pct = Math.min(100, Math.round((doneToday / (doneToday + left)) * 100))`. The width is the one allowed inline style (data-driven). All-done state: no bar.
  - `GradeButtons` gains `suggested?: Grade`; the matching button gets `className="grade-suggested"`; `WriteCard` passes its computed `suggested` (only in the done state). Flip passes nothing.
- [ ] **Step 2: Verify** `npm run typecheck` → 0; `npm test` → PASS.
- [ ] **Step 3: Commit** — `feat: review progress bar, streak header, highlighted suggested grade`

---

### Task 6: Verification in Chromium and docs

**Files:**
- Modify: `README.md` (Features: themes line)

- [ ] **Step 1: Run** the app locally (`npx wrangler d1 migrations apply DB --local`, seed a few ready + due cards and one un-learned card, `npm run dev`). For the AI check, temporarily point `BASE` in `app/lib/openrouter.ts` at a local mock and **revert before committing**.
- [ ] **Step 2: Screenshot at 390×844**, light and dark (`colorScheme` emulation, theme `auto`): login, home, review (write input, AI result), review flip revealed, learn, cards list, card detail. Check each against Review Focus 3–5; send the screenshots to the user.
- [ ] **Step 3: Check the switcher**: pin Light with `colorScheme: 'dark'` emulated and Dark with `'light'` → pinned theme renders on first paint after reload (screenshot taken before any script runs, via `page.goto(..., { waitUntil: 'commit' })` + screenshot), `data-theme` present, one `theme-color` meta with the pinned `--bg`; Auto → no `data-theme`, two metas. After switching, the page returns to where it was.
- [ ] **Step 4: Update README** Features (Auto / Light / Dark theme), then `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** — `docs: describe themes and refreshed look`
