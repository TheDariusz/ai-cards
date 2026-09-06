import { validateCardContent, type AiProvider } from './ai'

const BASE = 'https://openrouter.ai/api/v1'
// Without this a stalled response hangs the waitUntil promise forever: it never
// settles, the isolate is reclaimed, and the card is stranded in `pending`.
const TIMEOUT_MS = 60_000

const SYSTEM_PROMPT = `You create English flashcards for a Polish native speaker at B1 level who wants to reach B2.
Given an English word, reply with ONLY a JSON object, no other text:
{
  "wordPl": "<the most common Polish equivalent>",
  "explanationEn": "<one-sentence explanation of the meaning in simple English a B1 learner understands>",
  "sentenceEn": "<one short natural example sentence using the word: max 12 words, everyday context, simple B1-level grammar — the target word must be the only challenging element. Good example for 'deliberately': 'She deliberately ignored his calls after the argument.'>",
  "sentencePl": "<natural Polish translation of that sentence>",
  "decodeParts": [
    { "en": "<first English word>", "pl": "<literal Polish equivalent>" },
    { "en": "<next English word>", "pl": "<literal Polish equivalent preserving the English order>" }
  ]
}

decodeParts is a literal Birkenbihl decode, not a natural translation. Decode ONE ENGLISH WORD PER ITEM by default, even when the resulting Polish sounds unnatural. Keep the English order, cover the entire English sentence exactly once, keep punctuation attached to its English word, and make joining every "en" value with one space reproduce sentenceEn exactly.

For "She was reluctant to speak.", use separate items for "She", "was", "reluctant", "to", and "speak.". Group two or at most three English words only when they form one genuinely inseparable construction, phrasal verb, or proper name, for example "the most" → "najbardziej". Do not group ordinary adjacent words merely to make the Polish translation sound natural.`

export function createOpenRouter(opts: {
  apiKey: string
  cardModel: string
  ttsModel: string
  voice: string
}): AiProvider {
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  }

  return {
    async generateCard(word, hint) {
      const user = hint
        ? `Word: ${word}\nGenerate a NEW, different sentence. Hint: ${hint}`
        : `Word: ${word}`
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: opts.cardModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      const raw = data.choices[0]?.message?.content ?? ''
      const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) // tolerate stray text
      return validateCardContent(JSON.parse(json))
    },

    async tts(text) {
      const res = await fetch(`${BASE}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: opts.ttsModel, input: text, voice: opts.voice, response_format: 'mp3' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`OpenRouter TTS failed: ${res.status} ${await res.text()}`)
      return res.arrayBuffer()
    },
  }
}

export function aiFromEnv(env: Env): AiProvider {
  return createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    cardModel: env.CARD_MODEL,
    ttsModel: env.TTS_MODEL,
    voice: env.TTS_VOICE,
  })
}
