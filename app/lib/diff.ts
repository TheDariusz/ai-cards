import type { Grade } from './srs'
import { normalize, similar } from './headword'

export type TokenKind = 'match' | 'typo' | 'missing' | 'extra'
export interface DiffToken { text: string; kind: TokenKind }
export interface DiffResult { tokens: DiffToken[]; score: number; suggestedGrade: Grade }

// Alignment weights: an exact pairing must outrank a fuzzy one, so a word you
// wrote correctly is never orphaned by a lookalike sitting next to it.
// Integers keep the dp exact — 0.9-style weights accumulate float error.
const EXACT = 10
const TYPO = 9

export function diffAnswer(expected: string, typed: string): DiffResult {
  const exp = normalize(expected)
  const got = normalize(typed)

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
  let matches = 0, typos = 0
  let i = 0, j = 0
  while (i < n && j < m) {
    if (exp[i] === got[j]) {
      tokens.push({ text: exp[i], kind: 'match' }); matches++; i++; j++
    } else if (similar(exp[i], got[j]) && dp[i][j] === dp[i + 1][j + 1] + TYPO) {
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
