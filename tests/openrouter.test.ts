import { describe, it, expect, vi, afterEach } from 'vitest'
import { createOpenRouter } from '../app/lib/openrouter'

const provider = () =>
  createOpenRouter({ apiKey: 'k', cardModel: 'anthropic/claude-sonnet-5', ttsModel: 'openai/gpt-4o-mini-tts', voice: 'alloy' })

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

afterEach(() => vi.unstubAllGlobals())

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
