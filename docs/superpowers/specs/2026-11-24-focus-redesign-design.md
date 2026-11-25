# "Skupienie" (Focus) Redesign — Design

**Date:** 2026-11-24
**Status:** Mockups approved in chat; builder check done; awaiting written-spec review

## Purpose

The signed-in app was laid out for one user who already knew it: a single 520px column where the home screen
stacks word entry, stats, a month calendar, navigation tiles, and settings in a `<details>` block. The app is
now open to strangers (open sign-up, landing page from November), and the inside no longer matches the
outside. The owner's specific complaint: the month calendar takes most of the home screen and is not what
matters first.

Success: a new person who signs in understands what to do next from the first screen, and a returning person
sees one clear action for today. The look stays recognisably the same product as the landing page.

Approved mockups (all screens, light and dark): https://claude.ai/artifact/Ham5Bp9Kw1xGYRbTYQFLeV
Direction comparison that led here: https://claude.ai/artifact/5ex8UjVCC43hmuHqobkSSN

## Goals

- Home answers "what do I do today" with one primary card; everything else is secondary.
- The month calendar leaves home. Home keeps a 7-day strip; the calendar lives on a streak screen.
- Persistent navigation: three destinations (Today, Cards, Settings).
- Settings, export, credits and log out move to their own screen.
- A first-run home state that explains the loop instead of showing zeros.
- A real desktop layout instead of a phone column centered on a wide screen.

## Non-goals

- Landing page (`Landing` in `home.tsx`) — untouched.
- Learning and review flows, grading, the card pipeline, auth, credits logic — behaviour unchanged, with one
  decided exception: learning a new word can complete the day (see "Streak rule change").
- Card detail/edit, admin, and `login/verify` — they pick up the shared styles, no layout redesign.
- Card search or filtering.
- New fonts or a new palette.

## Anti-goals

- Home turning back into a dashboard: no second card competing with the primary one, no stats tiles.
- Tailwind utilities, a component library, or UI test infrastructure (see CLAUDE.md).

## Approaches considered

| | Idea | Trade-off |
|---|---|---|
| **A · Skupienie** (chosen) | Keep indigo, Instrument Sans and Literata; change layout: one "today" card, tab navigation | Least work, consistent with the landing page; the least distinctive of the three |
| B · Talia | Tactile flashcard deck: thick outlines, hard shadows, yellow highlighter accent | Most memorable; needs a new accent, so landing and logo would have to follow |
| C · Mono | Black/white with one hot accent, giant numeral, floating dock with "+" | Mature, strong in dark; colder, and adding a word is one tap further away |

The owner picked A after seeing all three as mockups.

## Visual system

Tokens, fonts and the theme mechanism from `2026-09-27-visual-refresh-themes-design.md` stay as they are.
Two tokens are added, declared in all three theme blocks like the rest:

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ok-soft` | `#e3f3ec` | `#1a3229` | background of the "done for today" card |
| `--bad-soft` | `#fbecec` | `#33202a` | background of the wrong-answer verdict block |

Shared patterns (semantic classes in `app/app.css`, names are the builder's call):

- **Primary card**: accent fill, `--on-accent` text, 22px radius, one inverted button.
- **Surface card**: `--surface`, 1px `--edge`, 18px radius.
- **Section label**: 11px uppercase, letter-spaced, `--muted`.
- **Segmented control**: the existing theme/locale switch style, reused in settings and on login.
- **Icons**: inline SVG, 1.9 stroke, `currentColor`. Emoji used as icons today (🔥 ⏳ ⚙ ←) are replaced.
  Icon set needed: flame, back arrow, close, check, home, cards, gear.

## Navigation shell

A layout route wraps the three top-level screens and renders the navigation:

- **Below 900px**: bottom tab bar — Today (`/`), Cards (`/cards`), Settings (`/settings`). It respects
  `env(safe-area-inset-bottom)`.
- **900px and up**: left sidebar (about 208px) with logo, the same three links (Cards shows the count), and
  the credit balance at the bottom. Content area max-width about 880px.

Screens without the shell (focused tasks, back/close in their own header): `/learn`, `/review`,
`/cards/:id`, `/streak`, `/login`, `/login/verify`, `/admin`. On desktop these stay a centered column of
about 520px, because they are reading and typing.

The guest branch of `/` (landing) renders without the shell.

The shell needs the card count and the credit balance, so the layout route has a loader. Because it also
wraps the guest branch of `/`, it is a second public exception next to the `home` loader: no session at all
(`getUserId` is null) returns nothing and the layout renders only the outlet; any cookie goes through
`requireAuth`. CLAUDE.md's list of exceptions gets this one added.

Cards, Settings and Streak on desktop: a single column of about 640px inside the content area, no grid.

## Screens

### Today (`/`, signed in)

Top to bottom:

1. Header: date line (weekday, day, month in the UI locale, Europe/Warsaw), title "Dziś"/"Today", streak chip
   (flame + number) linking to `/streak`. The chip is hidden when the streak is 0.
2. Add-word field with its button. Out of credits: the field is replaced by the existing no-credits message.
   Action feedback ("added", errors) and failed cards with Retry render directly under it, as today.
3. **Primary card**, exactly one of these states, first match wins:

   | State | Condition | Content |
   |---|---|---|
   | First run | user has no cards at all | "Add your first word" with the add-word field inside the card (item 2 is not rendered separately), followed by a surface card with the three-step explanation (now / then / tomorrow) and a line about starter credits |
   | Preparing | the user has cards but none is ready yet (all pending or failed) | "Your first card is being prepared" with the word; a failed card shows the existing Retry instead. Polling moves it on |
   | Review | `due > 0` | big count, "cards to review · about N minutes", button → `/review` |
   | Learn | `due == 0`, today not done, new cards exist | count of new words, "start with <word>", button → `/learn` |
   | Done | `due == 0`, today is a completed day | check icon, "All done for today", what was done today (see "Streak rule change"); `--ok-soft` background |
   | Nothing due | otherwise | "Nothing to review today" plus the next due date from `nextDueAt` when there is one |

4. New-words tile (surface card, "N new words · start with <word>", button → `/learn`). Shown whenever new
   cards exist and the primary card is not already the Learn state.
5. Week strip: Monday to Sunday of the current Warsaw week; a day is filled when it is in `completedDays`,
   today is outlined until done. The whole strip links to `/streak`.
6. Status line, only when cards are generating: "Generating: <words>". Polling every 3s stays.

Estimated time: `Math.max(1, Math.round(due * 30 / 60))` minutes — a fixed 30 seconds per card. A pure helper,
unit-tested.

On desktop: header and add-word field full width; below them two columns — primary card left; new-words
tile, a "This week" card with the strip, and the status line right.

### Streak (`/streak`, new)

Back link to `/`. Current streak as a large number with "days in a row" and "longest streak: N". A card with
the current month as a Monday-first calendar: completed days filled with `--ok`, today outlined, future days
dimmed. Two small stat cards: study days this month, total cards.

Current month only; no month navigation. `longestStreak(days)` is a new pure function in
`app/lib/streak.ts`, unit-tested next to `computeStreak`.

### Cards (`/cards`)

Title with total count. One surface card containing rows: word in bold, `· wordPl` muted when present, the
English sentence on one line with ellipsis (Literata). A small tag only for unusual states: "generating…"
(pending), "failed", "new" (the same condition the repo uses for the learn queue, `newCardCondition`: ready, has decode parts, not yet
learned — reuse it, do not re-derive it). Row links to `/cards/:id` as today. Empty
state: one line pointing back to Today to add a word.

### Settings (`/settings`, new)

Surface cards, in order:

- **Appearance**: theme (Auto / Light / Dark), language (PL / EN) — the existing `/theme` and `/locale` posts.
- **Reminder**: the 19:00 mail as an on/off switch, "send a test mail" link — the existing `/reminder` post
  and its success/error messages.
- **Credits**: "left of granted" with a meter. The owner sees "Spent: $X" instead, with no meter.
- **Your data**: CSV export, JSON backup. Owner only: link to `/admin`.
- Footer line: the user's e-mail (`getUserEmail`) and Log out.

Everything in today's `<details class="settings">` block and the logout form on home moves here; home keeps
none of it.

### Learn and Review

Same steps, same content, same keyboard behaviour. Visual changes only:

- Header becomes one row: back/close icon, progress bar, count. In review the bar and count are cards
  ("4 left"), as today. In learn the bar and count are the step within the current card ("1 / 4"); the word
  and the number of new cards remaining move into the section label line below the header, so nothing shown
  today is lost. The streak leaves the review header.
- The mockup's review screen shows an inline diff next to the AI verdict for illustration. What is shown
  stays as today: AI feedback when available, the diff only as the fallback.
- Section labels above the prompt and the answer.
- The verdict (review, after checking) is one block on `--bad-soft` for wrong; minor and correct keep their
  existing colours on a surface card.
- The primary action (learn) and the grade buttons (review) sit at the bottom of the viewport on phones.
  The suggested grade keeps the accent fill, with the "suggested grade" label above the row.
- The write/flip mode toggle stays, restyled as a segmented control under the header.
- "All done" in review links back to Today, which then shows the Done state.

### Login (`/login`)

Logo (the real `logo-light.png` / `logo-dark.png`) and the PL/EN switch in one top row. Heading "Sign in or
create an account", one line explaining the passwordless link, e-mail field, full-width button, spam-folder
hint. On phones the form block sits in the upper-middle of the screen rather than at the top edge; on desktop
it is a centered 400px column. Copy stays equivalent to today's; no new behaviour.

### Unchanged layouts

`/cards/:id`, `/admin`, `/login/verify`: inherit tokens, controls and the new header pattern (back icon
instead of "←"), nothing else.

## Streak rule change (decided by the owner)

Today only reviews complete a day (`applyReview` writes `day_log` when nothing is due or after 10 reviews),
and a freshly learned card is due 24 hours later. A new user's first day therefore ends with no completed
day, an empty week strip and no streak.

New rule: when `completeFirstLearning` succeeds and the user has nothing due at that moment, today is written
to `day_log` (same insert, `onConflictDoNothing`). With cards still due, learning alone does not complete the
day — the reviews do, as before — so learning one word is not a way around a pending review. This applies to
every user, the owner included. Covered by DB tests next to the existing `applyReview` day-completion tests.

Consequences: after the first learned word Today shows Done and the streak is 1. The Done card's line reads
"N cards reviewed" when there were reviews today, otherwise "N new words learned" (cards whose
`firstLearnedAt` falls on today's Warsaw day). The reminder job keeps using `isDayDone` unchanged.

## Data and code touchpoints

- `home.tsx` loader: add the week's day keys and whether today is done; drop the month's `completed` list,
  theme and reminder data (they move to the settings loader). Deciding the primary-card state is a pure
  function (inputs: total cards, due, new count, today done, next due) so it can be unit-tested.
- New loaders for `/settings` and `/streak`, each starting with `requireAuth`, each passing `userId` to every
  repo call. No new repo functions are expected: `completedDays`, `listCards`/`countNew`, `getBalance`,
  `getSetting`, `getUserEmail`, `nextDueAt`, `countReviewsOn` already cover the data.
- `app/routes.ts`: layout route for the shell, plus `settings` and `streak`.
- `app/lib/i18n.ts`: every new string in both `pl` and `en`. Polish plural forms follow the existing
  helpers.
- `app/app.css`: rewritten section by section; classes that no longer have markup are deleted.
- No schema change, no migration. One behaviour change in the repo: `completeFirstLearning` (above).

## Constraints

- No Tailwind utilities; hand-written semantic classes. Code style as in CLAUDE.md.
- Both themes for every screen; no colour defined only inside a theme block.
- Touch targets at least 44px; visible focus on every control; the tab bar and sidebar are `<nav>` with the
  current item marked `aria-current="page"`.
- The PWA manifest and icons stay as they are.

## Verification

- Vitest: `longestStreak`, the review-time estimate, the primary-card state function, week-key helper.
- No UI tests. Each screen is checked in the browser at 375px and 1280px, in light and dark, including the
  five Today states, out-of-credits, a failed card, and the owner's variants.

## Left to the builder

- Class names, component split, where shared pieces (icons, shell) live.
- Exact spacing and type sizes within what the mockups show.
- Order of work and how to slice it into commits.

## Calls made by the designer (not discussed in detail)

- 30 seconds per card for the time estimate.
- The Preparing state of the primary card (found by the builder check: without it a new user's first minute
  shows "Nothing to review").
- `Enter` starts the review on desktop (owner's decision after the design critique: the add-word field is autofocused only on first run, so the key is free). The hint is shown from 900px on hover-capable devices.
- Single 640px column for Cards, Settings and Streak on desktop.
- The shell loader as a public exception, handled like the `home` loader.
- 900px as the sidebar breakpoint.
- The Learn and Nothing-due states of the primary card (the mockups show First run, Review and Done).
- The streak screen shows the current month only.
- The owner sees money spent instead of the credit meter, and the admin link lives in settings.
- After the design critique (owner's decisions): the Learn state of the primary card shows the word itself in Literata instead of "start with <word>"; the flip review mode is called "Fiszka" in Polish; a day with nothing due and no new words still breaks the streak.
