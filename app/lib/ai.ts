export interface DecodePart {
  en: string
  pl: string
}

export interface CardContent {
  wordPl: string
  explanationEn: string
  sentenceEn: string
  sentencePl: string
  decodeParts: DecodePart[]
}

export interface AiProvider {
  generateCard(word: string, hint?: string): Promise<CardContent>
  tts(text: string): Promise<ArrayBuffer>
}

export function validateCardContent(value: unknown): CardContent {
  if (!value || typeof value !== 'object') throw new Error('card content must be an object')
  const parsed = value as Partial<Record<keyof CardContent, unknown>>
  for (const key of ['wordPl', 'explanationEn', 'sentenceEn', 'sentencePl'] as const) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
      throw new Error(`card content missing ${key}`)
    }
  }
  const sentenceEn = parsed.sentenceEn as string
  return {
    wordPl: parsed.wordPl as string,
    explanationEn: parsed.explanationEn as string,
    sentenceEn,
    sentencePl: parsed.sentencePl as string,
    decodeParts: validateDecodeParts(parsed.decodeParts, sentenceEn),
  }
}

export function validateDecodeParts(value: unknown, sentenceEn: string): DecodePart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error('card content decodeParts must be a non-empty array')
  }
  const parts = value.map((part, index) => {
    if (!part || typeof part !== 'object') throw new Error(`decodeParts[${index}] must be an object`)
    const { en, pl } = part as { en?: unknown; pl?: unknown }
    if (typeof en !== 'string' || !en.trim() || typeof pl !== 'string' || !pl.trim()) {
      throw new Error(`decodeParts[${index}] must contain non-empty en and pl strings`)
    }
    return { en: en.trim(), pl: pl.trim() }
  })
  if (normalizeSpaces(parts.map((part) => part.en).join(' ')) !== normalizeSpaces(sentenceEn)) {
    throw new Error('decodeParts English fragments must reproduce sentenceEn in order')
  }
  const sentenceWordCount = words(sentenceEn).length
  const partWordCounts = parts.map((part) => words(part.en).length)
  if (partWordCounts.some((count) => count > 3)) {
    throw new Error('decodeParts may group at most three English words in one expression')
  }
  if (parts.length < Math.ceil(sentenceWordCount * 0.6)) {
    throw new Error('decodeParts are too broadly grouped; decode individual words by default')
  }
  return parts
}

export function decodePartsToText(parts: DecodePart[] | null): string {
  return parts?.map((part) => `${part.en} | ${part.pl}`).join('\n') ?? ''
}

export function decodePartsFromText(text: string, sentenceEn: string): DecodePart[] | null {
  if (!text.trim()) return null
  const parts = text.trim().split(/\r?\n/).map((line, index) => {
    const separator = line.indexOf('|')
    if (separator < 0) throw new Error(`Decode line ${index + 1} needs an English | Polish separator`)
    return { en: line.slice(0, separator), pl: line.slice(separator + 1) }
  })
  return validateDecodeParts(parts, sentenceEn)
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function words(value: string): string[] {
  return normalizeSpaces(value).split(' ').filter(Boolean)
}
