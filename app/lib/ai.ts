export interface CardContent {
  wordPl: string
  explanationEn: string
  sentenceEn: string
  sentencePl: string
}

export interface AiProvider {
  generateCard(word: string, hint?: string): Promise<CardContent>
  tts(text: string): Promise<ArrayBuffer>
}
