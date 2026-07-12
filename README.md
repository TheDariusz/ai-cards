# AI Cards

A personal English-learning flashcard app for a Polish native speaker. Hear an unfamiliar word in a podcast, type just the word — AI builds a complete flashcard in the background: the Polish equivalent, a simple English explanation, an example sentence deliberately pitched slightly above B1 (the level-stretching mechanism), its Polish translation, and natural TTS audio. Review daily with spaced repetition and keep the streak alive.

**Live:** https://ai-cards.thedariusz.workers.dev (single user, password-protected)

## Features

- **Instant capture** — add a word in ~3 seconds; card generation runs in the background (`ctx.waitUntil`)
- **AI-generated cards** — Claude (via OpenRouter) writes the content; TTS audio stored in R2
- **Spaced repetition** — simplified SM-2 scheduler; new cards become due the next day
- **Two review modes** — classic flip (Polish → reveal English + audio → self-grade) and *write it* (type the English sentence, get a word-by-word diff with a suggested grade)
- **Streak** — a day counts when all due cards are reviewed (or ≥10 reviews on backlog days), Europe/Warsaw timezone, month calendar on the home screen
- **Card management** — edit any field, regenerate with a hint ("make it shorter", "business context"), delete; SRS progress survives edits
- **Export** — CSV (Anki/spreadsheet-compatible) and JSON full backup, no import by design
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
| `APP_PASSWORD_HASH` | SHA-256 hex of the login password (`echo -n "pass" \| shasum -a 256`) |

### Tests

```bash
npm test            # Vitest: SRS scheduler, answer diff, streak, CSV, repo, adapter, pipeline
npm run typecheck
```

Pure logic (scheduling, diffing, streaks, CSV) is fully unit-tested; DB tests run against in-memory SQLite with the real migrations.

## CI/CD

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

- **On every push/PR to `master`** — runs `npm run typecheck` and `npm test`. No deploy.
- **Deploy is manually gated** — the deploy job runs only via **Run workflow** (workflow_dispatch) from the repo's Actions tab. It re-runs the tests, applies remote D1 migrations, then deploys. Nothing reaches production without that explicit click.

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
npx wrangler secret put APP_PASSWORD_HASH
```

Every deploy after that:

```bash
npm run deploy      # builds + deploys to https://ai-cards.thedariusz.workers.dev
```

New migrations must be applied remotely by hand (`npx wrangler d1 migrations apply ai-cards --remote`) before deploying code that depends on them.

### AI model configuration

Model ids live in `wrangler.jsonc` `vars` — swap models with a config change + redeploy, no code edits:

| Var | Current value |
|---|---|
| `CARD_MODEL` | `anthropic/claude-sonnet-5` |
| `TTS_MODEL` | `microsoft/mai-voice-2` |
| `TTS_VOICE` | `en-US-Harper:MAI-Voice-2` |

(Heads-up: OpenRouter's TTS catalog shifts — the originally planned OpenAI TTS model was delisted. `npx wrangler tail ai-cards` shows the exact error if TTS ever starts failing again; available models: `curl "https://openrouter.ai/api/v1/models?output_modalities=speech"`.)

## Project docs

- Design spec: [docs/superpowers/specs/2026-07-07-ai-cards-design.md](docs/superpowers/specs/2026-07-07-ai-cards-design.md)
- Implementation plan: [docs/superpowers/plans/2026-07-07-ai-cards.md](docs/superpowers/plans/2026-07-07-ai-cards.md)

## Known quirks

- `workers/context.d.ts` augments a React Router internal module path to expose `context.cloudflare.env/ctx`; both `react-router` packages are exact-pinned to `8.0.0` to keep it stable. Follow-up: migrate to the official `context.get/set` API and unpin.
- Wrangler auto-enables preview URLs for the worker; they share the same secrets and login gate. Set `"preview_urls": false` in `wrangler.jsonc` to disable.
