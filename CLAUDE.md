# AI Cards

Single-user English flashcard PWA for a Polish speaker. React Router 8 (framework mode) on
Cloudflare Workers · D1 + Drizzle · R2 audio · OpenRouter for LLM + TTS. Product/setup: README.md.

## Commands

- `npm run dev` — http://localhost:5173 (local D1/R2 via Miniflare)
- `npm test` — Vitest; single file: `npx vitest run tests/<name>.test.ts`
- `npm run typecheck` — `wrangler types && react-router typegen && tsc -b`; **requires `.dev.vars` to exist** (keys only) or `Env` won't resolve
- `npx drizzle-kit generate` then `npx wrangler d1 migrations apply DB --local`
- `npx wrangler tail ai-cards` — prod logs; where LLM/TTS failures actually show up
- Never run `npm run deploy` — deploy is CI-only, gated on `production` environment approval

## Architecture

- Ports & adapters: `app/lib/ai.ts` is the port (`AiProvider`), `app/lib/openrouter.ts` the only adapter. `pipeline`/`repo` take a `deps` object — that's what makes them testable; keep it.
- `app/db/repo.ts` is the only file that touches Drizzle. Routes call repo functions, never build queries.
- Generation is fire-and-forget: `context.cloudflare.ctx.waitUntil(runCardPipeline(...))`. Cards go `pending → ready | failed`; home polls every 3s while pending.
- Every loader/action starts with `await requireAuth(request, env)`.
- `context.cloudflare.{env,ctx}` comes from `workers/context.d.ts`, which must augment **two** module paths (see comment there). Keep `react-router` and `@react-router/dev` pinned to exact `8.0.0`.

## Conventions

- `app/` code: no semicolons, single quotes, 2-space. Untouched CF-template files (`root.tsx`, `entry.server.tsx`, `workers/app.ts`, `vite.config.ts`) keep template style — leave them.
- **No Tailwind utilities.** The plugin is template leftover; styling is hand-written semantic classes in `app/app.css`.
- No linter/formatter — match surrounding code.
- Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`).
- Single-user scale is a deliberate constraint: O(n) table scans are intentional (see `applyReview`).
- Timestamps are epoch ms; day keys are `YYYY-MM-DD` in Europe/Warsaw (`app/lib/streak.ts`).

## Linear workflow (via Linear MCP)
This repo maps to the **"AI Cards"** project in my Linear workspace.
The Linear MCP server is connected; use it to read and update issue state —
don't ask me to paste issue details.
 
### Start of session
- Show my open issues for this project assigned to me (Dariusz) with status
  **In Progress** or **In Review** — this is my "Resume Work" filter.
  Summarize where I left off and the concrete next step for each.
- If nothing is in progress, take the highest-priority issue with status
  **Ready** (my "Next" filter) and propose starting it.
### While working
- When you start an issue, move it to **In Progress**.
- Each Linear issue carries a `branchName` — check out that branch before you
  start (I use git worktrees).
- Apply labels consistently: `backend`, `frontend`, `infrastructure`,
  `Bug`, `Feature`, `Improvement`, `Documentation`, `Maintenance`, `Research`.
### End of session
- Add a short comment to the issue: what's done, the next concrete step,
  anything blocked. This is my handoff for tomorrow.
- Move the issue to **In Review** when it's ready for review.

## Testing

- Node 24 (`.node-version`) — Node 26 breaks better-sqlite3's native binding and tests won't run.
- Pure logic + adapters with stubs (`vi.stubGlobal('fetch', …)` in `tests/openrouter.test.ts`, fake deps in `tests/pipeline.test.ts`).
- DB tests use `tests/helpers/db.ts`: in-memory better-sqlite3 replaying the real `drizzle/*.sql`.
- **No UI test infra** (no jsdom/testing-library) and don't add it — route/keyboard behavior is verified manually.

Specs and plans live in `docs/superpowers/`.
