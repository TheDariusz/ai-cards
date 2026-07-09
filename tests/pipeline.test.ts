import { describe, it, expect } from 'vitest'
import { testDb } from './helpers/db'
import { insertPendingCard, getCard } from '../app/db/repo'
import { runCardPipeline } from '../app/lib/pipeline'
import type { AiProvider } from '../app/lib/ai'

const NOW = 1_750_000_000_000
const CONTENT = {
  wordPl: 'niechętny', explanationEn: 'not wanting to',
  sentenceEn: 'She was reluctant.', sentencePl: 'Była niechętna.',
}

function fakeAudio() {
  const store = new Map<string, ArrayBuffer>()
  return { store, put: async (k: string, v: ArrayBuffer) => void store.set(k, v) }
}

const okAi: AiProvider = {
  generateCard: async () => CONTENT,
  tts: async () => new Uint8Array([9]).buffer,
}

describe('runCardPipeline', () => {
  it('happy path: content + audio, card ready', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    const audio = fakeAudio()
    await runCardPipeline({ db, ai: okAi, audio }, id, 'reluctant')
    const card = await getCard(db, id)
    expect(card!.status).toBe('ready')
    expect(card!.sentenceEn).toBe(CONTENT.sentenceEn)
    expect(card!.audioKey).toBe(`audio/${id}.mp3`)
    expect(audio.store.has(`audio/${id}.mp3`)).toBe(true)
  })

  it('content failure marks card failed', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    const ai = { ...okAi, generateCard: async () => { throw new Error('boom') } }
    await runCardPipeline({ db, ai, audio: fakeAudio() }, id, 'reluctant')
    expect((await getCard(db, id))!.status).toBe('failed')
  })

  it('TTS failure still yields a ready text-only card', async () => {
    const db = testDb()
    const id = await insertPendingCard(db, 'reluctant', NOW)
    const ai = { ...okAi, tts: async () => { throw new Error('no audio') } }
    await runCardPipeline({ db, ai, audio: fakeAudio() }, id, 'reluctant')
    const card = await getCard(db, id)
    expect(card!.status).toBe('ready')
    expect(card!.audioKey).toBeNull()
  })
})
