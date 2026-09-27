# Visual Refresh + Light/Dark Themes — Design

**Date:** 2026-09-27
**Status:** Approved in chat; awaiting written-spec review

## Purpose

The app has one hard-coded dark look from the first build (July): ~70 lines of `app/app.css`, half the colors
as literals, Inter loaded but unused. The learner wants a more modern interface and a choice between a light
and a dark theme. Success: every screen uses direction **A · Calm Study** in both themes; the theme follows the
phone by default and can be pinned to light or dark; no wrong-theme flash on load; review gains a progress bar,
the streak in its header, and a highlighted suggested grade.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Theme behavior | Auto (follows `prefers-color-scheme`) + manual Auto / Light / Dark, remembered in a cookie, rendered on the server |
| Visual direction | **A · Calm Study** (mockups: https://claude.ai/artifact/UWz3kDnC2oZPGWEuMMNA5z) — cool neutrals, indigo accent, Literata for study sentences, Instrument Sans for UI |
| Scope | New style on all screens + small layout additions (review progress bar, streak in review header, highlighted suggested grade). Flows and routes unchanged; no new navigation. |
| Mechanism | Cookie + CSS tokens + server-rendered `data-theme` (no localStorage, no inline boot script) |
| Tests | Vitest for pure theme helpers and the new repo query; screens verified in Chromium in both themes |

## Palette (tokens)

Declared on bare `:root` (light), redefined for dark under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and again under
`:root[data-theme="dark"]`. Both dark blocks set `color-scheme: dark`; `:root` sets `color-scheme: light`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f6f7fb` | `#111421` | page background |
| `--surface` | `#ffffff` | `#1a1e2e` | cards, inputs |
| `--text` | `#1d2233` | `#e6e8f2` | body text |
| `--muted` | `#6a7187` | `#8e95ad` | secondary text |
| `--accent` | `#4b5bdc` | `#8c98ff` | primary buttons, headword, links |
| `--on-accent` | `#ffffff` | `#111421` | text on accent fill |
| `--accent-soft` | `#eceefb` | `#242a44` | secondary buttons, chips, progress track |
| `--edge` | `#e4e7f0` | `#262b3f` | borders, dividers |
| `--ok` | `#17805a` | `#43c793` | correct, done days |
| `--warn` | `#9a6412` | `#e2b25a` | typo, minor verdict |
| `--bad` | `#c53a3a` | `#f07a7a` | errors, missing, wrong verdict |
| `--focus` | `#4b5bdc` | `#aab3ff` | focus outline |

Light-theme `--ok`/`--warn`/`--bad` are darkened so text on `--surface` meets 4.5:1.

Every literal color in `app/app.css` (`#1a2027`, `#2a3540`, `#101418`, `#36516b`, `#9dceff`, `#ffc94d`,
`#04141f`, `rgba(255,255,255,0.18)`) is replaced by a token. No component color is defined only inside a
theme block.

## Typography

- `app/root.tsx` `links`: replace the unused Inter stylesheet with Google Fonts
  `Instrument+Sans:wght@400;500;600;700` and `Literata:opsz,wght@7..72,400;7..72,600` (`display=swap`).
- UI: `"Instrument Sans", system-ui, sans-serif`, base 17px, line-height 1.5.
- Study sentences: `"Literata", Georgia, serif` via a `.study` class — applied to the review/learn
  sentences rendered by `Sentence` (PL prompt, EN answer, corrected version), the decode pairs' English side,
  and the card-detail sentences.

## Theme mechanism

### Pure helpers — `app/lib/theme.ts`

```ts
export type ThemePref = 'auto' | 'light' | 'dark'
export function parseTheme(cookieHeader: string | null): ThemePref      // reads `theme=`; anything else → 'auto'
export function themeCookie(pref: ThemePref): string                    // Set-Cookie value
export function safeRedirect(to: FormDataEntryValue | null): string     // same-origin path or '/'
```

- Cookie: `theme=<pref>; Path=/; Max-Age=31536000; SameSite=Lax; Secure`. Not HttpOnly (not sensitive; no
  script reads it either).
- `safeRedirect`: accepts only strings starting with `/` and not `//` or `/\`; otherwise `'/'`.

### Root loader — `app/root.tsx`

`export async function loader({ request })` returns `{ theme: parseTheme(request.headers.get('Cookie')) }`.
No `requireAuth`: a deliberate exception to the CLAUDE.md rule, because the root loader also runs for
`/login` and returns only a non-sensitive preference. `Layout` reads it with `useRouteLoaderData('root')`
(may be undefined on error renders → treat as `'auto'`).

- `<html lang="en" data-theme={theme === 'auto' ? undefined : theme}>`
- `theme-color`: for `auto`, two metas — `<meta name="theme-color" media="(prefers-color-scheme: light)"
  content="#f6f7fb">` and the dark one with `#111421`; for a pinned theme, one meta with that theme's `--bg`.
- Root `shouldRevalidate` is left default (a theme change must re-run it).

### Theme action — `app/routes/theme.ts` (`route('theme', …)`)

Action-only resource route: `await requireAuth(request, env)` → read `theme` (validated through
`parseTheme`-equivalent: unknown → `'auto'`) and `redirectTo` → `redirect(safeRedirect(redirectTo),
{ headers: { 'Set-Cookie': themeCookie(pref) } })`.

### Switcher — home footer

A `<Form method="post" action="/theme" className="theme-switch">` with a hidden `redirectTo` = current path
and three submit buttons `name="theme"` values `auto` / `light` / `dark`, labels **Auto / Light / Dark**;
the active one has `aria-pressed="true"` and the selected style. Works without JavaScript.

## Components (all through tokens, `app/app.css`)

- `body`: `--bg` background, `--text` color, UI font. `.page` max-width 520px, side padding 16px.
- `.card-face`: `--surface`, 1px `--edge` border, radius 18px, padding 16px. No shadow.
- Buttons: primary = `--accent` fill, `--on-accent` text, radius 14px, weight 600. Secondary
  (`.secondary-button`, `.muted-toggle`, `.hint-button`, `.explanation-toggle`) = `--accent-soft` fill,
  `--text` (or `--accent` for hint/explanation) text, no border. Disabled keeps `opacity: .45`.
- Inputs/textarea: `--surface`, 1px `--edge`, radius 12px; focus = 3px `--focus` outline, offset 2px.
- `.head` (headword): `--accent`, weight 700. `.stat`: `--surface` + `--edge`, number in 1.6rem.
- Calendar: days on `--accent-soft` with `--muted` text; `.done` on `--ok` with `--on-accent` text.
- Diff/verdict/feedback classes keep their names and move to `--ok` / `--warn` / `--bad` / `--muted`.
- `kbd` in grade buttons: translucent `currentColor` background (works on any fill).
- Card detail's Delete button (today styled via `grade-again`) gets `.danger-button` (`--bad` fill) so it stays
  visibly destructive after the grade fills are removed.
- The inline `style={{ width: '100%' }}` on home's Start review becomes `className="primary-wide"`.

## Layout additions

1. **Review header** — `Review · {left} left · 🔥 {streak}` (streak omitted when 0), in the existing `<h1>`
   row with the back link. The review loader adds `streak` computed like home:
   `computeStreak(await completedDays(db), dayKey(now))`.
2. **Progress bar** — under the header: track `--accent-soft`, fill `--accent`, height 4px, radius full,
   `role="progressbar"` with `aria-valuenow`/`aria-valuemax`. Value = `doneToday / (doneToday + left)`.
   The loader adds `doneToday = await countReviewsOn(db, dayKey(now))`.
   - New repo function `countReviewsOn(db: Db, day: string): Promise<number>` — review_log rows whose
     `dayKey(reviewedAt) === day` (O(n) scan, intentional at single-user scale). `applyReview` reuses it
     instead of its inline filter.
   - "All done" screen: no bar.
3. **Suggested grade** — `GradeButtons` gains optional `suggested?: Grade`. The suggested button gets class
   `grade-suggested` (accent fill); the others use the secondary style. Without a suggestion (Flip) all three
   use the secondary style. The `grade-again` / `grade-easy` semantic fills are removed.
   Keyboard 1/2/3 unchanged. `WriteCard` passes the suggestion it already computes.

## Screens

- **Home**: `h1` "AI Cards" with a streak chip on the right; quick-add; stats tiles; New to learn card;
  Start review (primary-wide); calendar; footer with Review / Cards / Export CSV / Backup JSON links and the
  theme switcher.
- **Review, Learn**: new cards and buttons; study sentences in Literata; decode pairs as chips on
  `--accent-soft`.
- **Cards list, card detail, login**: tokens and components only; layout unchanged.
- **Not changed**: `ErrorBoundary` in `root.tsx` (CF template, per CLAUDE.md); emoji already in copy (🔥, ⏳).

## Error handling / edge cases

| Case | Behavior |
|---|---|
| Missing / garbage `theme` cookie | `auto` |
| `redirectTo` absent, absolute URL, `//evil`, `/\evil` | redirect to `/` |
| Unauthenticated POST `/theme` | `requireAuth` redirect to `/login`; cookie not set |
| Root loader data absent (error render) | treated as `auto` |
| `doneToday + left === 0` | bar not rendered (All done screen) |
| Fonts blocked / slow | fallback stacks; `display=swap` |

## Testing

- `tests/theme.test.ts` — `parseTheme`: absent header, `theme=light`, `theme=dark` among other cookies,
  `theme=blue` → auto. `themeCookie('dark')` contains `theme=dark`, `Path=/`, `Max-Age=31536000`,
  `SameSite=Lax`, `Secure`. `safeRedirect`: `/review` kept; `null`, `https://x.com`, `//x.com`, `/\x.com` → `/`.
- `tests/repo.test.ts` — `countReviewsOn`: counts only the given Warsaw day (rows just before/after Warsaw
  midnight); existing `applyReview` day-log tests stay green.
- Manual, headless Chromium at 390×844: every screen in light and dark (screenshots shared with the user);
  reload with each preference shows no wrong-theme frame; switcher round-trips and returns to the same page;
  contrast of `--muted`, `--warn`, `--ok` text on `--surface` checked in both themes.

## Out of scope

- Bottom tab navigation, new screens, animations beyond existing transitions
- Theme sync across devices (cookie is per browser)
- Restyling `ErrorBoundary` in `root.tsx`
- Removing the Tailwind Vite plugin (template leftover; separate cleanup)
