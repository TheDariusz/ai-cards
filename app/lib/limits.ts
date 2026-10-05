// Text sent to the LLM or TTS is billed by length, and the credit check only runs before the call,
// so uncapped input would let one request cost far more than the caller has left.
// Kept free of server imports: the forms use these for maxLength too.
export const MAX_WORD_CHARS = 100
export const MAX_TEXT_CHARS = 500
