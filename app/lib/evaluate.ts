import type { AnswerVerdict } from './ai'
import type { HeadwordStatus } from './diff'
import { headwordVariants, normalize, similar } from './headword'
import type { Grade } from './srs'

const SUFFIXES = ['s', 'es', 'd', 'ed', 'ing', 'er', 'est', 'ly']

// A typed English token is the headword or a regular inflection of it. Stricter
// than tokenMatchesHeadword on purpose: on free learner input a shorter word that
// merely prefixes the headword ("for" / "forget") must not pass. Irregular forms
// ("took" for "take") are not recognized.
function inflectsHeadword(word: string, head: string): boolean {
  if (word === head) return true
  const stems = [head]
  if (head.endsWith('e')) stems.push(head.slice(0, -1)) // ignore → ignoring
  if (/[^aeiou]y$/.test(head)) stems.push(`${head.slice(0, -1)}i`) // carry → carried
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(head)) stems.push(head + head.at(-1)) // stop → stopped
  return stems.some((stem) => SUFFIXES.some((suffix) => word === stem + suffix))
}

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
  if (occurs(inflectsHeadword)) return 'match'
  if (occurs((word, head) => inflectsHeadword(word, head) || similar(word, head))) return 'typo'
  return 'missing'
}

const GRADE_BY_VERDICT: Record<AnswerVerdict, Grade> = { correct: 'easy', minor: 'good', wrong: 'again' }

export function suggestGrade(verdict: AnswerVerdict, headword: HeadwordStatus): Grade {
  if (headword === 'missing') return 'again' // the tested word is the point of the card
  const grade = GRADE_BY_VERDICT[verdict]
  return headword === 'typo' && grade === 'easy' ? 'good' : grade
}
