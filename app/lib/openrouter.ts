import type { AiProvider, CardContent } from './ai'

const BASE = 'https://openrouter.ai/api/v1'

const SYSTEM_PROMPT = `You create English flashcards for a Polish native speaker at B1 level who wants to reach B2.
Given an English word, reply with ONLY a JSON object, no other text:
{
  "wordPl": "<the most common Polish equivalent>",
  "explanationEn": "<one-sentence explanation of the meaning in simple English a B1 learner understands>",
  "sentenceEn": "<one short natural example sentence using the word: max 12 words, everyday context, simple B1-level grammar — the target word must be the only challenging element. Good example for 'deliberately': 'She deliberately ignored his calls after the argument.'>",
  "sentencePl": "<natural Polish translation of that sentence>"
}`

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
      })
      if (!res.ok) throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      const raw = data.choices[0]?.message?.content ?? ''
      const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) // tolerate stray text
      const parsed = JSON.parse(json) as Partial<CardContent>
      for (const key of ['wordPl', 'explanationEn', 'sentenceEn', 'sentencePl'] as const) {
        if (typeof parsed[key] !== 'string' || !parsed[key]) throw new Error(`card content missing ${key}`)
      }
      return parsed as CardContent
    },

    async tts(text) {
      const res = await fetch(`${BASE}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: opts.ttsModel, input: text, voice: opts.voice, response_format: 'mp3' }),
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
