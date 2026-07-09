import type { AiProvider } from './ai'
import { markReady, markFailed, type Db } from '../db/repo'

export interface AudioStore {
  put(key: string, value: ArrayBuffer): Promise<unknown>
}

export async function runCardPipeline(
  deps: { db: Db; ai: AiProvider; audio: AudioStore },
  cardId: number,
  word: string,
  hint?: string,
): Promise<void> {
  const { db, ai, audio } = deps
  try {
    const content = await ai.generateCard(word, hint)
    let audioKey: string | null = null
    try {
      const bytes = await ai.tts(content.sentenceEn)
      audioKey = `audio/${cardId}.mp3`
      await audio.put(audioKey, bytes)
    } catch (err) {
      console.error(`TTS failed for card ${cardId}:`, err)
    }
    await markReady(db, cardId, content, audioKey)
  } catch (err) {
    console.error(`Card generation failed for card ${cardId}:`, err)
    await markFailed(db, cardId)
  }
}
