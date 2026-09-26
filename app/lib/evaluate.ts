import type { AnswerVerdict } from './ai'
import type { HeadwordStatus } from './diff'
import { headwordVariants, normalize, similar, tokenInflectsHeadword } from './headword'
import type { Grade } from './srs'

// Where the headword sits in a free-form answer — scanned over every position,
// never aligned against the reference, so a reordered paraphrase still finds it.
export function headwordInAnswer(typed: string, headword: string): HeadwordStatus {
  const tokens = normalize(typed)
  const variants = headwordVariants(headword)
  const occurs = (matches: (word: string, head: string) => boolean) =>
    variants.some((v) => {
      for (let i = 0; i + v.length <= tokens.length; i++) {
        if (v.every((head, k) => matches(tokens[i + k], head))) return true
      }
      return false
    })
  if (occurs(tokenInflectsHeadword)) return 'match'
  if (occurs((word, head) => tokenInflectsHeadword(word, head) || similar(word, head))) return 'typo'
  return 'missing'
}

const GRADE_BY_VERDICT: Record<AnswerVerdict, Grade> = { correct: 'easy', minor: 'good', wrong: 'again' }

export function suggestGrade(verdict: AnswerVerdict, headword: HeadwordStatus): Grade {
  if (headword === 'missing') return 'again' // the tested word is the point of the card
  const grade = GRADE_BY_VERDICT[verdict]
  return headword === 'typo' && grade === 'easy' ? 'good' : grade
}
