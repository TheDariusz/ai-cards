import type { Grade } from './srs'

export type TokenKind = 'match' | 'typo' | 'missing' | 'extra'
export interface DiffToken { text: string; kind: TokenKind }
export interface DiffResult { tokens: DiffToken[]; score: number; suggestedGrade: Grade }

function normalize(s: string): string[] {
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

function similar(a: string, b: string): boolean {
  return a !== b && levenshtein(a, b) <= 2 && Math.min(a.length, b.length) >= 3
}

export function diffAnswer(expected: string, typed: string): DiffResult {
  const exp = normalize(expected)
  const got = normalize(typed)

  // LCS over words; exact match or close typo both align
  const n = exp.length, m = got.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = exp[i] === got[j] || similar(exp[i], got[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])

  const tokens: DiffToken[] = []
  let matches = 0, typos = 0
  let i = 0, j = 0
  while (i < n && j < m) {
    if (exp[i] === got[j]) {
      tokens.push({ text: exp[i], kind: 'match' }); matches++; i++; j++
    } else if (similar(exp[i], got[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      tokens.push({ text: exp[i], kind: 'typo' }); typos++; i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: exp[i], kind: 'missing' }); i++
    } else {
      tokens.push({ text: got[j], kind: 'extra' }); j++
    }
  }
  while (i < n) tokens.push({ text: exp[i++], kind: 'missing' })
  while (j < m) tokens.push({ text: got[j++], kind: 'extra' })

  const denom = Math.max(n, m)
  const score = denom === 0 ? 0 : (matches + 0.5 * typos) / denom
  const suggestedGrade: Grade = score === 1 ? 'easy' : score >= 0.8 ? 'good' : 'again'
  return { tokens, score, suggestedGrade }
}
