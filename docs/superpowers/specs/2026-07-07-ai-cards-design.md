# AI Cards — Design

**Date:** 2026-07-07
**Status:** Approved by user

## Purpose

A personal English-learning flashcard service for a Polish native speaker stuck at B1. The user captures unfamiliar words heard in podcasts; AI turns each word into a rich flashcard (Polish equivalent, simple English explanation, an example sentence slightly above B1 level, Polish translation of the sentence, and natural TTS audio). Cards are reviewed daily via spaced repetition, with a Duolingo-style streak for motivation. Accessible on iPhone (PWA) and computer (browser), single user.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Build vs. use existing (Anki/Mochi) | Build own app |
| Scheduling | Spaced repetition (simplified SM-2) |
| Capture flow | Type just the word; AI does the rest in the background |
| Phone | iPhone → PWA via "Add to Home Screen" |
| TTS | AI-generated audio, stored per card |
| Hosting | Cloudflare (Workers + D1 + R2) |
| AI providers | Claude API for card content, OpenAI TTS for audio |
| Offline | Online-only (revisit later if it hurts) |
| Architecture | React Router 7 (framework mode) on Cloudflare Workers |

## Data model

D1 (SQLite) via Drizzle ORM.

```
cards
  id              integer pk
  word            text        -- what the user typed, e.g. "reluctant"
  word_pl         text        -- Polish equivalent, e.g. "niechętny"
  explanation_en  text        -- simple English explanation of meaning (B1-friendly)
  sentence_en     text        -- example sentence, slightly above B1 (B2-ish)
  sentence_pl     text        -- Polish translation of the sentence
  audio_key       text        -- R2 object key for the MP3 (nullable)
  status          text        -- 'pending' | 'ready' | 'failed'
  -- SRS state
  due_at          integer     -- epoch; new cards due the next day
  interval_days   real
  ease            real
  created_at      integer

review_log
  id          integer pk
  card_id     fk → cards
  reviewed_at integer
  mode        text            -- 'flip' | 'write'
  grade       text            -- 'again' | 'good' | 'easy'
  typed       text            -- the user's typed answer (write mode only)
```

`review_log` powers the streak calendar and future stats.

## Card creation pipeline

1. User types a word, hits Add. Card is saved immediately with `status='pending'`; the UI returns to idle in ~3 seconds (user goes back to their podcast).
2. In the background (Worker `waitUntil`):
   a. **Claude** (`claude-sonnet-5`, structured output) generates `word_pl`, `explanation_en`, `sentence_en` (deliberately slightly above B1 — this is the level-stretching mechanism), `sentence_pl`.
   b. **OpenAI TTS** (`gpt-4o-mini-tts`) speaks `sentence_en`; MP3 stored in R2.
   c. Card → `status='ready'`.
3. Failures at any step → `status='failed'` with a retry button; the word is never lost. If only TTS failed, the card is still usable text-only with a "generate audio" retry.
4. Home screen shows a small "pending" indicator; cards typically become ready within seconds (light polling while pending cards exist).

One sentence per word (a single memorable sentence beats a cluttered card). A word with two distinct meanings can be added twice with different context.

## Card management

Card detail view supports:

- **Regenerate** — asks Claude for a different sentence (optional hint, e.g. "more casual", "business context"); audio regenerated automatically; old sentence replaced.
- **Manual edit** — every field editable in place. Editing `sentence_en` regenerates audio and offers to re-translate `sentence_pl`.
- **Delete** — with confirmation.

SRS state survives edits and regeneration (same memory item, refined).

## Review experience

**Scheduling — simplified SM-2:** each card has `due_at`. New cards due the next day. Grades: **Again** → back tomorrow, interval resets; **Good** → interval grows (~1d → 3d → 7d → 16d → …, interval × ease); **Easy** → larger jump, ease increases. Home screen shows cards due today.

**Two modes** (toggle at session start; both feed the same SRS state):

1. **Classic flip:** Polish sentence → recall → reveal English sentence + explanation → audio plays automatically → self-grade (Again / Good / Easy).
2. **Write it:** Polish sentence → user types the English sentence → word-by-word diff against the card's sentence (typos highlighted, missing/extra words marked) → audio plays → app suggests a grade from answer closeness; user can override.

Every card has a replay-audio button for listen-and-repeat practice.

**Streak:** A day counts if all due cards are completed, or at least 10 reviews on heavy-backlog days (so a backlog can't make the streak impossible). Computed in Europe/Warsaw timezone. Home screen shows current streak + a month calendar of completed days.

## Tech stack

- **React Router 7** (framework mode) on **Cloudflare Workers** — official template; loaders/actions server-side with direct binding access.
- **D1** + **Drizzle ORM** (typed schema, migrations).
- **R2** for MP3s, served through an authenticated app route (no public bucket).
- **Claude API** — structured output for card generation. **OpenAI TTS** for audio (~$0.002/sentence).
- **PWA**: manifest + icons; "Add to Home Screen" on iPhone gives full-screen app feel; same URL on desktop.

## Auth & security

- Single user. Login page with one password; hash stored as a Worker secret; signed long-lived session cookie (~90 days) so login is roughly once per device.
- Claude/OpenAI API keys are Worker secrets, server-side only.
- All routes (including audio) require the session.

## Error handling

- AI generation failures → card `failed` + retry (see pipeline).
- Review submissions retry on network failure; the grade is held in memory so a flaky connection doesn't lose a review.
- TTS-only failure → text-only card with audio retry.

## Testing

- **Unit (Vitest):** SRS scheduler and write-mode answer diff are pure functions — the correctness-critical core, tested thoroughly.
- **Integration:** loaders/actions against local D1 (wrangler/vitest workers pool).
- AI providers behind a small interface (port/adapter) so tests use fakes; keeps externals isolated per clean-architecture preference.

## Cost

Cloudflare free tier covers single-user scale. Claude + OpenAI TTS ≈ under $1/month at ~20 new words/day.

## Out of scope (YAGNI, revisit later)

- Offline reviews / sync
- Multiple users
- Decks/tags, import/export
- Premium voices (ElevenLabs), multiple sentences per word
- Voice capture
