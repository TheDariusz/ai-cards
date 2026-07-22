# Review-Flow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five review-flow improvements: main-word-weighted scoring (missed "deliberately" no longer yields 81%/good), simpler generated sentences, bolded tested word in both languages, Enter-to-check, and 1/2/3 grade shortcuts.

**Architecture:** A new shared module `app/lib/headword.ts` owns text normalization and headword matching (exact → prefix → edit-distance fuzzy); both the diff scorer and the sentence highlighter consume it. `diffAnswer` gains an optional `headword` param that weights the tested word 3× and forces/caps the suggested grade. All UI changes live in `app/routes/review.tsx`. The generation prompt line for `sentenceEn` in `app/lib/openrouter.ts` is rewritten.

**Tech Stack:** React 19 + React Router 8 (framework mode, SSR) on Cloudflare Workers, TypeScript, Vitest 4, hand-written CSS (`app/app.css`).

## Global Constraints

- No schema changes, no new dependencies, no config options.
- Conventional commits (`feat:`, `docs:` — matches git log).
- Hand-written semantic CSS classes in `app/app.css` — no Tailwind utilities.
- The 9 existing tests in `tests/diff.test.ts` must remain **byte-identical and passing** (they prove the no-headword path is unchanged).
- Test commands: `npm test` (full suite), `npx vitest run tests/<file>.test.ts` (single file). Typecheck: `npm run typecheck`.
- No UI test infra exists (no testing-library/jsdom) — keyboard/rendering behavior is verified manually in Task 7; do not add UI test tooling.
- User decisions (final, do not redesign): headword missing → forced `again`; headword typo → cap at `good`; headword weighs 3× in score; sentences: max ~12 words, everyday context, simple B1 grammar; match on DB columns `word`/`wordPl` exact-first with fuzzy fallback for inflections.

---

### Task 1: Headword matching utility (`app/lib/headword.ts`)

**Files:**
- Create: `app/lib/headword.ts`
- Modify: `app/lib/diff.ts` (delete moved functions, import them instead)
- Test: `tests/headword.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (used by Tasks 2 and 3):
  - `normalize(s: string): string[]` — lowercase, strip everything but letters/numbers/apostrophes, split on whitespace (moved verbatim from `diff.ts`)
  - `similar(a: string, b: string): boolean` — moved verbatim from `diff.ts`; note it returns **false** for identical strings
  - `tokenMatchesHeadword(word: string, head: string): boolean`
  - `findHeadwordIndices(tokens: string[], headTokens: string[]): number[][]` — non-overlapping occurrences, each an array of consecutive indices
  - `interface Segment { text: string; head: boolean }`
  - `highlightHeadword(sentence: string, headword: string | null | undefined): Segment[]` — invariant: `segments.map(s => s.text).join('') === sentence`

- [ ] **Step 1: Write the failing tests**

Create `tests/headword.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findHeadwordIndices, highlightHeadword, tokenMatchesHeadword } from '../app/lib/headword'

describe('tokenMatchesHeadword', () => {
  it('matches identical words', () => {
    expect(tokenMatchesHeadword('deliberately', 'deliberately')).toBe(true)
  })

  it('matches an English inflection via the prefix rule', () => {
    expect(tokenMatchesHeadword('ignored', 'ignore')).toBe(true)
  })

  it('matches a longer suffix inflection the edit distance would miss', () => {
    // "helpful" is 3 edits from "help" — too many for similar(), fine for prefix
    expect(tokenMatchesHeadword('helpful', 'help')).toBe(true)
  })

  it('matches a Polish inflection via edit distance', () => {
    // "ignorowała" vs "ignorować": 2 edits on a 10-letter word
    expect(tokenMatchesHeadword('ignorowała', 'ignorować')).toBe(true)
  })

  it('keeps short headwords exact-only', () => {
    // "up" must never claim "upset"
    expect(tokenMatchesHeadword('upset', 'up')).toBe(false)
    expect(tokenMatchesHeadword('up', 'up')).toBe(true)
  })

  it('rejects unrelated words', () => {
    expect(tokenMatchesHeadword('argument', 'deliberately')).toBe(false)
  })
})

describe('findHeadwordIndices', () => {
  it('finds a single word', () => {
    expect(findHeadwordIndices(['she', 'deliberately', 'ignored'], ['deliberately'])).toEqual([[1]])
  })

  it('finds a phrasal verb as consecutive tokens', () => {
    expect(findHeadwordIndices(['never', 'give', 'up', 'hope'], ['give', 'up'])).toEqual([[1, 2]])
  })

  it('finds every occurrence', () => {
    expect(findHeadwordIndices(['run', 'fast', 'run'], ['run'])).toEqual([[0], [2]])
  })

  it('returns [] when absent', () => {
    expect(findHeadwordIndices(['she', 'ignored', 'him'], ['deliberately'])).toEqual([])
  })

  it('returns [] for an empty headword', () => {
    expect(findHeadwordIndices(['she'], [])).toEqual([])
  })
})

describe('highlightHeadword', () => {
  const rejoin = (s: string, h: string | null) => highlightHeadword(s, h).map((x) => x.text).join('')
  const heads = (s: string, h: string) => highlightHeadword(s, h).filter((x) => x.head).map((x) => x.text)

  it('always reassembles to the exact input', () => {
    const s = 'She deliberately ignored his calls, after the argument!'
    expect(rejoin(s, 'deliberately')).toBe(s)
    expect(rejoin(s, null)).toBe(s)
    expect(rejoin(s, 'absent')).toBe(s)
  })

  it('flags the headword', () => {
    expect(heads('She deliberately ignored him.', 'deliberately')).toEqual(['deliberately'])
  })

  it('keeps punctuation attached to a highlighted word', () => {
    expect(heads('He was ignored, then left.', 'ignore')).toEqual(['ignored,'])
  })

  it('ignores casing', () => {
    expect(heads('Deliberately, she left.', 'deliberately')).toEqual(['Deliberately,'])
  })

  it('flags a phrasal verb as one continuous span', () => {
    expect(heads('Never give up hope.', 'give up')).toEqual(['give up'])
  })

  it('returns one plain segment when the headword is absent', () => {
    expect(highlightHeadword('She left.', 'deliberately')).toEqual([{ text: 'She left.', head: false }])
  })

  it('handles empty input', () => {
    expect(highlightHeadword('', 'x')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/headword.test.ts`
Expected: FAIL — cannot resolve `../app/lib/headword`.

- [ ] **Step 3: Create `app/lib/headword.ts`**

`normalize`, `levenshtein`, `similar` are **moved verbatim** from `app/lib/diff.ts` (lines 7–33), with `normalize`/`similar` now exported; the rest is new:

```ts
// Locating the tested word (headword) inside a sentence, tolerating the
// inflections Polish and English put on it ("ignorować" → "ignorowała").

export function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return dp[a.length][b.length]
}

// Edit distance has to scale with word length: 2 edits on a 3-letter word means
// "shares one letter" ("the"/"use"), which is not a typo — it's a different word.
export function similar(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 4) return false
  return levenshtein(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1)
}

// One normalized sentence token vs one normalized headword token.
// Exact first — similar() deliberately returns false for identical words.
export function tokenMatchesHeadword(word: string, head: string): boolean {
  if (word === head) return true
  if (
    head.length >= 4 &&
    Math.abs(word.length - head.length) <= 3 &&
    (word.startsWith(head) || head.startsWith(word))
  )
    return true
  return similar(word, head)
}

// All non-overlapping occurrences of the headword token sequence inside
// `tokens`, each as the run of consecutive indices it covers.
export function findHeadwordIndices(tokens: string[], headTokens: string[]): number[][] {
  if (headTokens.length === 0) return []
  const out: number[][] = []
  for (let i = 0; i + headTokens.length <= tokens.length; i++) {
    if (headTokens.every((h, k) => tokenMatchesHeadword(tokens[i + k], h))) {
      out.push(headTokens.map((_, k) => i + k))
      i += headTokens.length - 1
    }
  }
  return out
}

export interface Segment { text: string; head: boolean }

// Split a sentence into segments that re-concatenate exactly to the input,
// with headword occurrences flagged — punctuation stays attached to its word.
export function highlightHeadword(sentence: string, headword: string | null | undefined): Segment[] {
  if (!sentence) return []
  const parts = sentence.split(/(\s+)/) // capturing split: join('') round-trips
  // Each non-whitespace part normalizes to at most one token (its "shadow")
  const words = parts
    .map((part, partIndex) => ({ partIndex, norm: normalize(part)[0] ?? '' }))
    .filter((w) => w.norm !== '')
  const occs = findHeadwordIndices(words.map((w) => w.norm), headword ? normalize(headword) : [])
  const headParts = new Set<number>()
  for (const occ of occs) {
    const first = words[occ[0]].partIndex
    const last = words[occ[occ.length - 1]].partIndex
    for (let p = first; p <= last; p++) headParts.add(p) // interior whitespace bolds too
  }
  const segments: Segment[] = []
  parts.forEach((text, p) => {
    if (!text) return
    const head = headParts.has(p)
    const prev = segments[segments.length - 1]
    if (prev && prev.head === head) prev.text += text
    else segments.push({ text, head })
  })
  return segments
}
```

- [ ] **Step 4: Point `diff.ts` at the moved functions**

In `app/lib/diff.ts`: delete the local `normalize`, `levenshtein`, `similar` definitions (lines 7–33 including their comments) and add at the top:

```ts
import { normalize, similar } from './headword'
```

Nothing else in `diff.ts` changes in this task.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: `tests/headword.test.ts` PASS, all pre-existing suites (incl. the 9 `diff.test.ts` tests) PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add app/lib/headword.ts app/lib/diff.ts tests/headword.test.ts
git commit -m "feat: add headword matching utility"
```

---

### Task 2: Main-word-weighted scoring (`app/lib/diff.ts`)

**Files:**
- Modify: `app/lib/diff.ts`
- Modify: `app/routes/review.tsx` (pass `card.word`, show headword status)
- Modify: `app/app.css` (`.diff-head`)
- Test: `tests/diff.test.ts` (append a new `describe`; the existing one stays byte-identical)

**Interfaces:**
- Consumes: `normalize`, `similar`, `findHeadwordIndices` from `app/lib/headword.ts` (Task 1).
- Produces (used by Task 3's rendering and by `review.tsx`):
  - `diffAnswer(expected: string, typed: string, headword?: string): DiffResult`
  - `interface DiffToken { text: string; kind: TokenKind; head?: boolean }` — `head: true` only on expected-side tokens belonging to the headword
  - `type HeadwordStatus = 'match' | 'typo' | 'missing'`
  - `DiffResult` gains optional `headword?: HeadwordStatus` — present only when the headword was located in the expected sentence

- [ ] **Step 1: Write the failing tests**

Append to `tests/diff.test.ts` (after the existing `describe`, which must not change):

```ts
describe('diffAnswer with headword', () => {
  const EXPECTED = 'She deliberately ignored his calls after the argument.'

  it('perfect answer is easy with headword match', () => {
    const r = diffAnswer(EXPECTED, 'she deliberately ignored his calls after the argument', 'deliberately')
    expect(r.score).toBe(1)
    expect(r.suggestedGrade).toBe('easy')
    expect(r.headword).toBe('match')
  })

  it('missing headword forces again even when everything else matches', () => {
    // Unweighted this is 7/8 = 87.5% "good" — the bug from the screenshot.
    const r = diffAnswer(EXPECTED, 'she ignored his calls after the argument', 'deliberately')
    expect(r.headword).toBe('missing')
    expect(r.suggestedGrade).toBe('again')
    expect(r.score).toBe(0.7) // 7 plain matches / (8 words + 2 extra headword weight)
  })

  it('headword typo stays good in a longer sentence', () => {
    const r = diffAnswer(EXPECTED, 'she deliberatly ignored his calls after the argument', 'deliberately')
    expect(r.headword).toBe('typo')
    expect(r.score).toBe(0.85) // (7 + 3·0.5) / 10
    expect(r.suggestedGrade).toBe('good')
  })

  it('headword typo in a short sentence can still fall to again', () => {
    // Cap-at-good is an upper bound, not a floor: (3 + 1.5) / 6 = 0.75
    const r = diffAnswer('She deliberately left home.', 'she deliberatly left home', 'deliberately')
    expect(r.headword).toBe('typo')
    expect(r.score).toBe(0.75)
    expect(r.suggestedGrade).toBe('again')
  })

  it('marks headword tokens in the diff', () => {
    const r = diffAnswer(EXPECTED, 'she ignored his calls after the argument', 'deliberately')
    expect(r.tokens.filter((t) => t.head).map((t) => t.text)).toEqual(['deliberately'])
  })

  it('falls back to unweighted behavior when the headword is not in the expected sentence', () => {
    const r = diffAnswer('She left early.', 'she left early', 'deliberately')
    expect(r).toEqual(diffAnswer('She left early.', 'she left early'))
    expect(r.headword).toBeUndefined()
  })

  it('a phrasal headword with one word missing counts as missing', () => {
    const r = diffAnswer('Never give up hope.', 'never give hope', 'give up')
    expect(r.headword).toBe('missing')
    expect(r.suggestedGrade).toBe('again')
  })

  it('headword typed correctly once is not missing when the sentence has it twice', () => {
    const r = diffAnswer('run fast run', 'run fast', 'run')
    expect(r.headword).toBe('match')
  })

  it('empty answer is again with headword missing', () => {
    const r = diffAnswer(EXPECTED, '', 'deliberately')
    expect(r.score).toBe(0)
    expect(r.suggestedGrade).toBe('again')
    expect(r.headword).toBe('missing')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/diff.test.ts`
Expected: the new `describe` FAILS (`headword` is `undefined`, scores differ); the original 9 tests still PASS.

- [ ] **Step 3: Implement weighted scoring**

Replace `app/lib/diff.ts` in full (the dp alignment is unchanged; the walk gains bookkeeping, the score gains weights, the grade gains the override/cap):

```ts
import type { Grade } from './srs'
import { findHeadwordIndices, normalize, similar } from './headword'

export type TokenKind = 'match' | 'typo' | 'missing' | 'extra'
export interface DiffToken { text: string; kind: TokenKind; head?: boolean }
export type HeadwordStatus = 'match' | 'typo' | 'missing'
export interface DiffResult {
  tokens: DiffToken[]
  score: number
  suggestedGrade: Grade
  headword?: HeadwordStatus
}

// Alignment weights: an exact pairing must outrank a fuzzy one, so a word you
// wrote correctly is never orphaned by a lookalike sitting next to it.
// Integers keep the dp exact — 0.9-style weights accumulate float error.
const EXACT = 10
const TYPO = 9

// The tested word is the whole point of the card — it weighs as much as
// three ordinary words in the score.
const HEAD_WEIGHT = 3

export function diffAnswer(expected: string, typed: string, headword?: string): DiffResult {
  const exp = normalize(expected)
  const got = normalize(typed)
  const occs = headword ? findHeadwordIndices(exp, normalize(headword)) : []
  const isHead = new Set(occs.flat())

  // Weighted LCS over words; exact match or close typo both align, exact wins ties
  const n = exp.length, m = got.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = exp[i] === got[j]
        ? dp[i + 1][j + 1] + EXACT
        : Math.max(
            similar(exp[i], got[j]) ? dp[i + 1][j + 1] + TYPO : 0,
            dp[i + 1][j],
            dp[i][j + 1],
          )

  const tokens: DiffToken[] = []
  const kindByExp: ('match' | 'typo' | 'missing')[] = []
  let i = 0, j = 0
  const pushExp = (kind: 'match' | 'typo' | 'missing') => {
    kindByExp[i] = kind
    tokens.push({ text: exp[i], kind, ...(isHead.has(i) ? { head: true } : {}) })
    i++
  }
  while (i < n && j < m) {
    if (exp[i] === got[j]) {
      pushExp('match'); j++
    } else if (similar(exp[i], got[j]) && dp[i][j] === dp[i + 1][j + 1] + TYPO) {
      pushExp('typo'); j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushExp('missing')
    } else {
      tokens.push({ text: got[j], kind: 'extra' }); j++
    }
  }
  while (i < n) pushExp('missing')
  while (j < m) tokens.push({ text: got[j++], kind: 'extra' })

  // Headword tokens weigh HEAD_WEIGHT; with no headword this reduces exactly
  // to the old (matches + 0.5·typos) / max(n, m).
  let credit = 0
  for (let k = 0; k < n; k++) {
    const w = isHead.has(k) ? HEAD_WEIGHT : 1
    credit += w * (kindByExp[k] === 'match' ? 1 : kindByExp[k] === 'typo' ? 0.5 : 0)
  }
  const wExp = n + (HEAD_WEIGHT - 1) * isHead.size
  const denom = Math.max(wExp, wExp + (m - n)) // each surplus typed word adds 1
  const score = denom === 0 ? 0 : credit / denom

  // Worst kind within an occurrence (a phrase missing one word is missing),
  // best across occurrences (typed correctly once = not missing).
  const rank = { match: 0, typo: 1, missing: 2 } as const
  let status: HeadwordStatus | undefined
  for (const occ of occs) {
    const occStatus = occ
      .map((idx) => kindByExp[idx])
      .reduce<HeadwordStatus>((worst, k) => (rank[k] > rank[worst] ? k : worst), 'match')
    if (status === undefined || rank[occStatus] < rank[status]) status = occStatus
  }

  let suggestedGrade: Grade = score === 1 ? 'easy' : score >= 0.8 ? 'good' : 'again'
  if (status === 'missing') suggestedGrade = 'again' // the tested word is the point
  else if (status === 'typo' && suggestedGrade === 'easy') suggestedGrade = 'good'

  return { tokens, score, suggestedGrade, ...(status !== undefined ? { headword: status } : {}) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/diff.test.ts`
Expected: all tests PASS — the original 9 unchanged, the 9 new ones green.

- [ ] **Step 5: Wire the headword into `review.tsx` and surface its status**

In `app/routes/review.tsx`, `WriteCard` (currently lines 82–123):

Extract the check into a helper and pass `card.word` (this helper is reused by Task 4's Enter handling):

```tsx
const check = () => setResult(diffAnswer(card.sentenceEn ?? '', typed, card.word))
```

Form tag becomes:

```tsx
<form onSubmit={(e) => { e.preventDefault(); check() }}>
```

In the result branch, emphasize headword tokens in the diff readout (line 109):

```tsx
<span key={i} className={`diff-${t.kind}${t.head ? ' diff-head' : ''}`}>{t.text} </span>
```

Under the score line (after line 115), add the status lines:

```tsx
{result.headword === 'missing' && <p className="error">Main word missing: <b>{card.word}</b></p>}
{result.headword === 'typo' && <p className="muted">Main word had a typo.</p>}
```

Append to `app/app.css` (bold only — the diff kind keeps its color semantics, so a missing headword stays red/strikethrough):

```css
.diff-head { font-weight: 700; }
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add app/lib/diff.ts app/routes/review.tsx app/app.css tests/diff.test.ts
git commit -m "feat: weight the tested word 3x in write-mode scoring"
```

---

### Task 3: Highlight the tested word in review sentences

**Files:**
- Modify: `app/routes/review.tsx`
- Modify: `app/app.css` (`.head`, `.answer`)

**Interfaces:**
- Consumes: `highlightHeadword(sentence, headword): Segment[]` from `app/lib/headword.ts` (Task 1).
- Produces: local component `Sentence({ text, headword, lang, bold? })` in `review.tsx` — not exported.

- [ ] **Step 1: Add the `Sentence` component**

In `app/routes/review.tsx`, add the import and the component (above `GradeButtons`):

```tsx
import { highlightHeadword } from '../lib/headword'
```

```tsx
function Sentence({ text, headword, lang, bold }: {
  text: string | null
  headword: string | null
  lang: string
  bold?: boolean
}) {
  if (!text) return null
  return (
    <p lang={lang} className={bold ? 'answer' : undefined}>
      {highlightHeadword(text, headword).map((s, i) =>
        s.head ? <b className="head" key={i}>{s.text}</b> : <span key={i}>{s.text}</span>,
      )}
    </p>
  )
}
```

- [ ] **Step 2: Replace the four render sites**

- `FlipCard` front (line 65) and `WriteCard` front (line 92) — Polish sentence, bold `wordPl`:

```tsx
<div className="card-face"><Sentence text={card.sentencePl} headword={card.wordPl} lang="pl" /></div>
```

- `FlipCard` back (line 71) and `WriteCard` result (line 112) — English sentence; `bold` keeps the current all-bold answer look via CSS, the accent-colored `.head` still stands out inside it. Replaces `<p lang="en"><b>{card.sentenceEn}</b></p>`:

```tsx
<Sentence text={card.sentenceEn} headword={card.word} lang="en" bold />
```

- [ ] **Step 3: Add CSS**

Append to `app/app.css`:

```css
.head { color: var(--accent); font-weight: 700; }
.answer { font-weight: 700; }
```

- [ ] **Step 4: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / clean (no new unit tests — rendering is covered by `highlightHeadword` tests from Task 1; visual check happens in Task 7).

- [ ] **Step 5: Commit**

```bash
git add app/routes/review.tsx app/app.css
git commit -m "feat: highlight the tested word in review sentences"
```

---

### Task 4: Enter submits the check in write mode

**Files:**
- Modify: `app/routes/review.tsx` (`WriteCard` textarea)

**Interfaces:**
- Consumes: the `check()` helper extracted in Task 2, Step 5.
- Produces: nothing new.

- [ ] **Step 1: Add the keydown handler to the textarea**

In `WriteCard`, the `<textarea>` (lines 95–101) gains `onKeyDown` — Enter checks, Shift+Enter keeps the newline, IME composition is ignored:

```tsx
<textarea
  value={typed}
  onChange={(e) => setTyped(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      check()
    }
  }}
  placeholder="Write the English sentence…"
  autoFocus
  rows={3}
/>
```

No "disable after check" code is needed: the form sits in the `!result` branch and unmounts when the result appears, so the textarea can't swallow the Task 5 grade keys. Empty-Enter behaves like clicking Check with an empty answer (score 0) — same as today.

- [ ] **Step 2: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add app/routes/review.tsx
git commit -m "feat: submit write-mode check with Enter"
```

---

### Task 5: Keyboard shortcuts — 1/2/3 grades, Space/Enter reveal

**Files:**
- Modify: `app/routes/review.tsx` (`GradeButtons`, `FlipCard`)
- Modify: `app/app.css` (kbd hints)

**Interfaces:**
- Consumes: existing `GradeButtons` fetcher and props (`cardId: number`, `mode: string`, `typed?: string`); server `action` is untouched — `fetcher.submit` posts the identical payload the form posts.
- Produces: module-level `const KEY_TO_GRADE: Record<string, 'again' | 'good' | 'easy'>`.

- [ ] **Step 1: Add the grade-key listener**

In `app/routes/review.tsx`, add at module level (near the top, below imports):

```tsx
const KEY_TO_GRADE: Record<string, 'again' | 'good' | 'easy'> = { '1': 'again', '2': 'good', '3': 'easy' }
```

Inside `GradeButtons` (after the `failed` line). The listener lives here because the component only mounts when grades are visible and unmounts per card (`key={card.id}`):

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    const grade = KEY_TO_GRADE[e.key]
    if (!grade) return
    const el = e.target
    if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    if (fetcher.state !== 'idle') return
    e.preventDefault()
    fetcher.submit(
      { cardId: String(cardId), mode, grade, ...(typed !== undefined ? { typed } : {}) },
      { method: 'post' },
    )
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [fetcher, cardId, mode, typed])
```

Guards, in order: modifier combos (Cmd+1 switches browser tabs), held-key repeat, focus inside an editable element, in-flight submission.

- [ ] **Step 2: Add kbd hints to the buttons**

Buttons (lines 48–50) become:

```tsx
<button name="grade" value="again" className="grade-again" disabled={fetcher.state !== 'idle'}>Again <kbd>1</kbd></button>
<button name="grade" value="good" disabled={fetcher.state !== 'idle'}>Good <kbd>2</kbd></button>
<button name="grade" value="easy" className="grade-easy" disabled={fetcher.state !== 'idle'}>Easy <kbd>3</kbd></button>
```

- [ ] **Step 3: Space/Enter reveals in flip mode**

In `FlipCard`, add below the existing audio `useEffect`:

```tsx
useEffect(() => {
  if (revealed) return
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target
    if (el instanceof HTMLElement && ['BUTTON', 'A', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return
    e.preventDefault() // Space must not scroll the page
    setRevealed(true)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [revealed])
```

(The tag guard lets a focused "Show answer" or mode-toggle button keep its native Enter/Space behavior.)

- [ ] **Step 4: Add kbd CSS (hidden on touch devices)**

Append to `app/app.css`:

```css
.grades kbd { font-size: 0.75em; background: rgba(255, 255, 255, 0.18); border-radius: 4px; padding: 0.05em 0.35em; margin-left: 0.35em; }
@media (hover: none) { .grades kbd { display: none; } }
```

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add app/routes/review.tsx app/app.css
git commit -m "feat: grade with 1/2/3 keyboard shortcuts"
```

---

### Task 6: Simpler generated sentences

**Files:**
- Modify: `app/lib/openrouter.ts:10` (one line of `SYSTEM_PROMPT`)
- Test: `tests/openrouter.test.ts` (one assertion added to an existing test)

**Interfaces:**
- Consumes/Produces: none — prompt text only; response shape and validation unchanged.

- [ ] **Step 1: Add the failing assertion**

In `tests/openrouter.test.ts`, inside the existing `'POSTs to chat completions and parses the JSON content'` test, after `expect(body.model).toBe('anthropic/claude-sonnet-5')` add:

```ts
expect(body.messages[0].content).toContain('max 12 words')
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/openrouter.test.ts`
Expected: FAIL on the new assertion (prompt still says "DELIBERATELY slightly above B1 level").

- [ ] **Step 3: Rewrite the `sentenceEn` prompt line**

In `app/lib/openrouter.ts`, replace line 10:

```
  "sentenceEn": "<one natural example sentence using the word, DELIBERATELY slightly above B1 level (B2): use richer grammar (e.g. conditionals, relative clauses, phrasal verbs) while staying comprehensible>",
```

with:

```
  "sentenceEn": "<one short natural example sentence using the word: max 12 words, everyday context, simple B1-level grammar — the target word must be the only challenging element. Good example for 'deliberately': 'She deliberately ignored his calls after the argument.'>",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/openrouter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/openrouter.ts tests/openrouter.test.ts
git commit -m "feat: generate simpler B1-level example sentences"
```

---

### Task 7: End-to-end manual verification

**Files:** none (verification only). No UI test infra exists in this repo — this checklist is the coverage for keyboard/rendering behavior.

- [ ] **Step 1: Full automated check**

Run: `npm test && npm run typecheck`
Expected: every suite PASS (incl. unchanged original diff tests), typecheck clean.

- [ ] **Step 2: Manual checklist in `npm run dev`** (needs `.dev.vars` with `OPENROUTER_API_KEY` for generation; review-flow checks work without it)

Write mode (`/review?mode=write`):
- Enter checks the answer; Shift+Enter inserts a newline; empty-Enter = empty Check.
- After checking, pressing 1/2/3 grades (Again/Good/Easy) — nothing swallows the keys.
- Answer typed **without** the main word → suggestion `again` + red "Main word missing: <word>"; main word bold in the diff readout.
- Main word with a typo → at most `good` + "Main word had a typo."
- Tested word shows accent-bold in the Polish prompt and in the English answer, punctuation attached ("ignored,").
- A card whose `wordPl` inflects irregularly renders un-bolded, no errors in console.

Flip mode (`/review`):
- Space or Enter reveals the answer (page does not scroll on Space); 1/2/3 only work after reveal.
- With DevTools network throttled to offline, pressing a grade key while a submission is in flight does nothing.

Generation:
- Add a new word on the home page → generated sentence is ≤ ~12 words with simple grammar.
- Mobile viewport (DevTools device emulation): `<kbd>` hints hidden.
