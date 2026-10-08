# AI Cards

A personal English-learning flashcard app for a Polish native speaker. Hear an unfamiliar word in a podcast, type just the word — AI builds a complete flashcard in the background: the Polish equivalent, a simple English explanation, a short example sentence in simple B1 English where the new word is the only hard part, its Polish translation, and natural TTS audio. Review daily with spaced repetition and keep the streak alive.

**Live:** https://ai-cards.app (open sign-up with a starter credit pool, email login link)

## Features

- **Instant capture** — add a word in ~3 seconds; card generation runs in the background (`ctx.waitUntil`)
- **AI-generated cards** — Claude (via OpenRouter) writes the content; TTS audio stored in R2
- **Birkenbihl first learning** — each new card gets an ordered literal EN–PL decode and a one-time guided introduction before it enters SRS
- **Spaced repetition** — simplified SM-2 scheduler; newly introduced cards become due the day after first learning
- **Two review modes** — *write it* (default: translate the Polish sentence in your own words) and classic flip (Polish → reveal English + audio → self-grade)
- **AI answer check** — in *write it*, AI judges meaning, grammar and naturalness, shows a corrected version with up to three short Polish notes and suggests a grade (correct → *easy*, minor errors → *good*, wrong → *again*); you still pick the grade. The tested word must appear or the suggestion is *again* (a typo in it lowers *easy* to *good*; only regular inflections are recognized). Falls back to a word-by-word diff when AI is unavailable or credits run out
- **Streak** — a day counts when all due cards are reviewed (or ≥10 reviews on backlog days), Europe/Warsaw timezone, month calendar on the home screen
- **Card management** — edit any field, regenerate with a hint ("make it shorter", "business context"), delete; SRS progress survives edits
- **Export** — CSV (Anki/spreadsheet-compatible) and JSON full backup, no import by design
- **Light and dark themes** — calm, study-focused look (Instrument Sans UI, Literata for study sentences); *Auto* follows the phone, or pin *Light* / *Dark* from the home footer — remembered in a cookie and rendered on the server, so there is no wrong-theme flash; review shows a progress bar for today, the streak, and highlights the suggested grade
- **Email reminder** — at 19:00 Europe/Warsaw, a short Polish email to each user whose day is not done yet and cards are due or new; On/Off and *Send test* on the home screen
- **Accounts** — log in or sign up with a one-time link mailed via Resend (15 min, single use); every user's cards, streak and settings are separate
- **Credits** — every new account gets `STARTER_CREDITS` (default 500; 1 credit = $0.001). Every OpenRouter call made for a user (new card, retry, regenerate, audio, answer check) is charged at its real cost and logged in `usage_log`; at zero, adding cards and AI features stop while learning and reviews keep working. The owner is never limited and tops users up or blocks them on `/admin`
- **Daily card limit** — non-owners can add `DAILY_CARD_LIMIT` new cards per Warsaw day (default 20, in `wrangler.jsonc`), a backstop next to credits
- **PWA** — "Add to Home Screen" on iPhone gives a full-screen app; online-only, no service worker

## Tech stack

React Router 8 (framework mode) on Cloudflare Workers · D1 (SQLite) + Drizzle ORM · R2 for audio · OpenRouter as the single AI gateway (model ids are config, not code) · Vitest

## Development

Prereqs: Node 24 (see `.node-version` — Node 26 breaks better-sqlite3's native binding) and npm.

```bash
npm install
cp .dev.vars.example .dev.vars        # then fill in real values
npx wrangler d1 migrations apply DB --local
npm run dev                            # http://localhost:5173
```

`.dev.vars` values:

| Name | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Server-side key for card generation + TTS |
| `SESSION_SECRET` | Signs the session cookie (`openssl rand -hex 32`) |
| `OWNER_EMAIL` | Your address; its first login takes over the original single-user account and data |
| `RESEND_API_KEY` | Resend API key for login links and the daily reminder email; without it nobody can log in on production |
| `REMINDER_TO` | Optional: the owner's reminder address until their first email login (everyone else gets reminders at their login email) |

Locally, leave `RESEND_API_KEY` empty to get login links printed to the dev-server terminal instead of mailed.

### Tests

```bash
npm test            # Vitest: scheduling, answer check, login, credits, reminders, repo, adapters
npm run typecheck
```

Pure logic (scheduling, diffing, answer grading, streaks, CSV, login, credits, quota, reminders, themes) is unit-tested, adapters (OpenRouter, Resend) against a stubbed `fetch`; DB tests run against in-memory SQLite with the real migrations.

### First-learning flow

Ready cards that have not been introduced appear on the home screen under **New to learn**. The short flow shows the literal decode, asks the learner to listen with help, confirm understanding without the decode, and speak once with the audio. Finishing marks the card as learned and schedules its first Flip/Write it review for the next day. Existing cards are backfilled as already learned, so this queue only contains cards created after the migration.

The natural `sentencePl` remains the review translation. The literal decode is stored separately as ordered `{ en, pl }` fragments: one English word per fragment by default, with short groups only for inseparable expressions such as `the most`. It is included in the full JSON backup; CSV intentionally keeps its existing five simple columns.

## CI/CD

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

- **On every push/PR to `master`** — runs `npm run typecheck` and `npm test`.
- **Push to `master` deploys** — once the tests pass, the deploy job applies remote D1 migrations and deploys, with no approval step. PRs never deploy. A red test suite is the only thing standing between a push and production, so keep it green.

To enable the deploy job, add two repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with **Workers Scripts: Edit**, **D1: Edit**, and **Workers R2 Storage: Edit** on the account |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id |

## Deployment (manual, from a workstation)

You can also deploy directly with Wrangler. One-time setup:

```bash
npx wrangler d1 create ai-cards        # put database_id into wrangler.jsonc
npx wrangler r2 bucket create ai-cards-audio
npx wrangler d1 migrations apply ai-cards --remote
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put REMINDER_TO
```

Every deploy after that:

```bash
npm run deploy      # builds + deploys to https://ai-cards.app
```

New migrations must be applied remotely by hand (`npx wrangler d1 migrations apply ai-cards --remote`) before deploying code that depends on them.

### Login

`/login` asks for an email and mails a one-time link to `/login/verify` (valid 15 minutes, at most 3 per address
per 15 minutes). Following the link for a new address creates the account with the starter credit pool. At most
`MAX_SIGNUPS_PER_DAY` (default 20) accounts are created per Warsaw day; beyond that, and for blocked addresses, no
link is sent, but the visitor sees the same message either way. The owner sees every user's spend and balance on
`/admin` (*Users* in the home footer), and can add credits or block and unblock a user. Blocking also ends the
user's existing session.

Chat calls are charged from OpenRouter's `usage.cost`; if it is missing, a 2¢ fallback is charged and logged. TTS
returns no cost, so it is charged per character at `TTS_USD_PER_MILLION_CHARS` (22 for `microsoft/mai-voice-2`);
the `X-Generation-Id` is stored to reconcile with OpenRouter.

The link opens a page with a **Log in** button rather than logging in on GET, so mail scanners that prefetch
links can't use up the token. Only a hash of the token is stored (`login_tokens`). All login mail is sent from
`REMINDER_FROM` through the same Resend key as the reminder. Rotate `SESSION_SECRET` to log everyone out.

Moving off the old shared password: set `OWNER_EMAIL` **before** merging; sessions from the password era keep
working as the owner. Afterwards `npx wrangler secret delete APP_PASSWORD_HASH`.

### Email reminders

Two Cron Triggers (`0 17 * * *` and `0 18 * * *` UTC) run `scheduled` in `workers/app.ts`; only the one that is
19:00 in Warsaw (CEST or CET) goes on. It emails every user, at their login email (the owner falls back to `REMINDER_TO` until their first email login), once a day when their today has no completed review day and there are
due or new cards, unless switched off on the home screen. Mail goes through [Resend](https://resend.com)'s
free plan (3,000/month, 100/day) from `AI Cards <cards@ai-cards.app>` (`REMINDER_FROM` in `wrangler.jsonc`), an
address in the `ai-cards.app` domain verified in Resend, so `REMINDER_TO` can be any address of yours.

One-time setup for a new deployment:

1. In Resend, verify the `ai-cards.app` domain and create an API key with sending access restricted to it.
2. `npx wrangler secret put RESEND_API_KEY`. `REMINDER_TO` is optional: it is only the owner's reminder address
   until their first email login.
3. Deploy; CI applies all pending migrations.
4. On production, press **Send test** on the home screen to confirm the setup.

Failures show up in `npx wrangler tail ai-cards` as `reminder: …` lines (`Resend <status>: <body>`). Locally the
mail is really sent via Resend, so put a real `RESEND_API_KEY` in `.dev.vars` to try it; fire the cron by hand with:

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+17+*+*+*&time=1790614800000"   # 2026-09-28 17:00 UTC = 19:00 Warsaw
```

### AI model configuration

Model ids live in `wrangler.jsonc` `vars` — swap models with a config change + redeploy, no code edits:

| Var | Current value |
|---|---|
| `CARD_MODEL` | `anthropic/claude-sonnet-5` |
| `TTS_MODEL` | `microsoft/mai-voice-2` |
| `TTS_VOICE` | `en-US-Harper:MAI-Voice-2` |

(Heads-up: OpenRouter's TTS catalog shifts — the originally planned OpenAI TTS model was delisted. `npx wrangler tail ai-cards` shows the exact error if TTS ever starts failing again; available models: `curl "https://openrouter.ai/api/v1/models?output_modalities=speech"`.)

## Project docs

Specs live in [docs/superpowers/specs/](docs/superpowers/specs/), matching plans in [docs/superpowers/plans/](docs/superpowers/plans/):

- [Original design](docs/superpowers/specs/2026-07-07-ai-cards-design.md) — the single-user app; login and scale have since changed
- [AI answer check](docs/superpowers/specs/2026-09-26-ai-answer-evaluation-design.md)
- [Email reminders](docs/superpowers/specs/2026-09-27-email-reminders-design.md)
- [Visual refresh and themes](docs/superpowers/specs/2026-09-27-visual-refresh-themes-design.md)
- [Open sign-up with credits](docs/superpowers/specs/2026-10-03-open-signup-credits-design.md)

## Known quirks

- `workers/context.d.ts` augments a React Router internal module path to expose `context.cloudflare.env/ctx`; both `react-router` packages are exact-pinned to `8.0.0` to keep it stable. Follow-up: migrate to the official `context.get/set` API and unpin.
- Wrangler auto-enables preview URLs for the worker; they share the same secrets and login gate. Set `"preview_urls": false` in `wrangler.jsonc` to disable.
