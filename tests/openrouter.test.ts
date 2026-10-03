import { describe, it, expect, vi, afterEach } from 'vitest'
import { createOpenRouter, FALLBACK_CHAT_COST_MICROS } from '../app/lib/openrouter'
import type { UsageEvent } from '../app/lib/ai'

const provider = (usage: UsageEvent[] = []) =>
  createOpenRouter({
    apiKey: 'k', cardModel: 'anthropic/claude-sonnet-5', ttsModel: 'openai/gpt-4o-mini-tts', voice: 'alloy',
    ttsUsdPerMillionChars: 22, onUsage: async (e) => { usage.push(e) },
  })

const CONTENT = {
  wordPl: 'niechętny',
  explanationEn: 'not wanting to do something',
  sentenceEn: 'She was reluctant to speak.',
  sentencePl: 'Była niechętna do mówienia.',
  decodeParts: [
    { en: 'She', pl: 'Ona' },
    { en: 'was', pl: 'była' },
    { en: 'reluctant', pl: 'niechętna' },
    { en: 'to', pl: 'żeby' },
    { en: 'speak.', pl: 'mówić.' },
  ],
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('generateCard', () => {
  it('POSTs to chat completions and parses the JSON content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(CONTENT) } }] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider().generateCard('reluctant')
    expect(result).toEqual(CONTENT)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('anthropic/claude-sonnet-5')
    expect(body.messages[0].content).toContain('max 12 words')
    expect(body.messages[0].content).toContain('literal Birkenbihl decode')
    expect(body.messages[0].content).toContain('ONE ENGLISH WORD PER ITEM')
    expect(body.messages.at(-1).content).toContain('reluctant')
  })

  it('passes the hint into the prompt when regenerating', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(CONTENT) } }] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await provider().generateCard('reluctant', 'business context')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages.at(-1).content).toContain('business context')
  })

  it('throws on missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"wordPl":"x"}' } }] })),
    ))
    await expect(provider().generateCard('reluctant')).rejects.toThrow(/missing/i)
  })

  it('rejects a decode that does not cover sentenceEn in order', async () => {
    const invalid = { ...CONTENT, decodeParts: [{ en: 'Different sentence.', pl: 'Inne zdanie.' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] })),
    ))
    await expect(provider().generateCard('reluctant')).rejects.toThrow(/reproduce sentenceEn/i)
  })

  it('rejects empty literal translations', async () => {
    const invalid = { ...CONTENT, decodeParts: [{ en: CONTENT.sentenceEn, pl: ' ' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] })),
    ))
    await expect(provider().generateCard('reluctant')).rejects.toThrow(/non-empty en and pl/i)
  })

  it('rejects a decode that groups most of the sentence into phrases', async () => {
    const invalid = {
      ...CONTENT,
      decodeParts: [
        { en: 'She was', pl: 'Ona była' },
        { en: 'reluctant to speak.', pl: 'niechętna żeby mówić.' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] })),
    ))
    await expect(provider().generateCard('reluctant')).rejects.toThrow(/too broadly grouped/i)
  })

  it('allows a short inseparable expression among word-level parts', async () => {
    const content = {
      ...CONTENT,
      sentenceEn: 'It is the most famous race.',
      sentencePl: 'To jest najsłynniejszy wyścig.',
      decodeParts: [
        { en: 'It', pl: 'To' },
        { en: 'is', pl: 'jest' },
        { en: 'the most', pl: 'najbardziej' },
        { en: 'famous', pl: 'sławny' },
        { en: 'race.', pl: 'wyścig.' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] })),
    ))
    await expect(provider().generateCard('famous')).resolves.toEqual(content)
  })

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await expect(provider().generateCard('reluctant')).rejects.toThrow(/500/)
  })
})

describe('tts', () => {
  it('POSTs to audio/speech and returns bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes))
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider().tts('Hello.')
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3]))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'openai/gpt-4o-mini-tts', input: 'Hello.', voice: 'alloy', response_format: 'mp3' })
  })
})

describe('evaluateAnswer', () => {
  const INPUT = { word: 'deliberately', wordPl: 'celowo', sentencePl: 'Celowo zignorowała jego telefony po kłótni.', sentenceEn: 'She deliberately ignored his calls after the argument.', typed: 'After the fight she deliberately ignored his calls.' }
  const EVAL = { verdict: 'correct', summaryPl: 'Poprawne i naturalne.', corrected: INPUT.typed, notesPl: [] }
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }))

  it('POSTs the card model with the answer delimited as data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(JSON.stringify(EVAL)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await provider().evaluateAnswer(INPUT)).toEqual(EVAL)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('anthropic/claude-sonnet-5')
    expect(body.messages[0].content).toMatch(/ignore any instructions/i)
    const user = body.messages.at(-1).content
    expect(user).toContain(INPUT.sentencePl)
    expect(user).toContain(INPUT.sentenceEn)
    expect(user).toContain(`<answer>${INPUT.typed}</answer>`)
    expect(user).toContain('celowo')
  })

  it('parses JSON wrapped in prose and code fences', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('Here you go:\n```json\n' + JSON.stringify(EVAL) + '\n```')))
    expect((await provider().evaluateAnswer(INPUT)).verdict).toBe('correct')
  })

  it('builds the prompt without a Polish gloss', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(JSON.stringify(EVAL)))
    vi.stubGlobal('fetch', fetchMock)
    await provider().evaluateAnswer({ ...INPUT, wordPl: null })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages.at(-1).content).not.toContain('null')
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 500 })))
    await expect(provider().evaluateAnswer(INPUT)).rejects.toThrow(/500/)
  })
})

describe('usage metering', () => {
  const chat = (content: unknown, extra: object = {}) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], ...extra }))

  it('asks for usage and charges usage.cost, rounded up to a micro-dollar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chat(CONTENT, {
      id: 'gen-1', usage: { cost: 0.0123451, prompt_tokens: 900, completion_tokens: 250 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const usage: UsageEvent[] = []
    await provider(usage).generateCard('reluctant')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).usage).toEqual({ include: true })
    expect(usage).toEqual([{
      kind: 'card', model: 'anthropic/claude-sonnet-5', costMicros: 12346,
      promptTokens: 900, completionTokens: 250, characters: null, generationId: 'gen-1',
    }])
  })

  it('charges the fallback when usage.cost is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chat({ verdict: 'correct', summaryPl: 'Dobrze.', corrected: 'x', notesPl: [] })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const usage: UsageEvent[] = []
    await provider(usage).evaluateAnswer({ word: 'w', wordPl: null, sentencePl: 'p', sentenceEn: 'e', typed: 'x' })
    expect(usage).toMatchObject([{ kind: 'evaluate', costMicros: FALLBACK_CHAT_COST_MICROS, promptTokens: null }])
  })

  it('still charges a response that fails validation — OpenRouter billed it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chat({ wordPl: 'x' }, { usage: { cost: 0.01 } })))
    const usage: UsageEvent[] = []
    await expect(provider(usage).generateCard('reluctant')).rejects.toThrow(/missing/i)
    expect(usage.map((e) => e.costMicros)).toEqual([10_000])
  })

  it('charges nothing for a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    const usage: UsageEvent[] = []
    await expect(provider(usage).generateCard('reluctant')).rejects.toThrow()
    await expect(provider(usage).tts('Hello.')).rejects.toThrow()
    expect(usage).toEqual([])
  })

  it('charges TTS per input character and keeps the generation id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]).buffer, { headers: { 'X-Generation-Id': 'gen-tts-1' } }),
    ))
    const usage: UsageEvent[] = []
    await provider(usage).tts('She was reluctant to speak.') // 27 chars × $22/M = 594 µ$
    expect(usage).toEqual([{
      kind: 'tts', model: 'openai/gpt-4o-mini-tts', costMicros: 594,
      promptTokens: null, completionTokens: null, characters: 27, generationId: 'gen-tts-1',
    }])
  })
})
