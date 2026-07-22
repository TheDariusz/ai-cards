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
