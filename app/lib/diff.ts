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
