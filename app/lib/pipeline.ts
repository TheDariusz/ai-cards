import type { AiProvider } from './ai'
import { markReady, markFailed, getCard, type Db } from '../db/repo'

export interface AudioStore {
  put(key: string, value: ArrayBuffer): Promise<unknown>
  delete(key: string): Promise<unknown>
}

export async function generateAudio(
  deps: { ai: AiProvider; audio: AudioStore },
  cardId: number,
  sentence: string,
): Promise<string> {
  const bytes = await deps.ai.tts(sentence)
  const audioKey = `audio/${cardId}-${Date.now()}.mp3`
  await deps.audio.put(audioKey, bytes)
  return audioKey
}

export async function runCardPipeline(
  deps: { db: Db; ai: AiProvider; audio: AudioStore },
  cardId: number,
  word: string,
  hint?: string,
): Promise<void> {
  const { db, ai, audio } = deps
  let prev: Awaited<ReturnType<typeof getCard>> = undefined
  try {
    prev = await getCard(db, cardId)
    const content = await ai.generateCard(word, hint)
    let audioKey: string | null = prev?.audioKey ?? null
    try {
      const newKey = await generateAudio({ ai, audio }, cardId, content.sentenceEn)
      if (prev?.audioKey && prev.audioKey !== newKey) {
        await audio.delete(prev.audioKey).catch(() => {})
      }
      audioKey = newKey
    } catch (err) {
      console.error(`TTS failed for card ${cardId}:`, err)
      // Old audio, if any, no longer matches the newly generated sentence —
      // the card must be text-only so the "Generate audio" retry button appears.
      if (prev?.audioKey) {
        await audio.delete(prev.audioKey).catch(() => {})
      }
      audioKey = null
    }
    await markReady(db, cardId, content, audioKey)
  } catch (err) {
    console.error(`Card generation failed for card ${cardId}:`, err)
    if (prev?.status !== 'ready') await markFailed(db, cardId)
    // a ready card being regenerated keeps its existing content and status
  }
}
