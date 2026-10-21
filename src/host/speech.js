// Voice questions: the browser records a question and DSH's own speech
// service turns it into text. That service is the experimental Voice Input
// bundle with its local SenseVoice recognizer, in the language the learner
// set there. The plugin never prepares or downloads a recognizer, keeps no
// audio and sends it nowhere else.

import { TutorError } from './generate.js'

export const MAX_SPEECH_SECONDS = 120
const BYTES_PER_SECOND = 32000
export const MAX_SPEECH_BYTES = 44 + MAX_SPEECH_SECONDS * BYTES_PER_SECOND
const MAX_TEXT = 2000

// Recognizer phases a recording can use: loaded, or checked and waiting for
// its first recording.
const USABLE = new Set(['ready', 'standby'])
const PREPARING = new Set(['checking', 'downloading', 'cancelling'])

// Seconds in a canonical 16 kHz mono PCM16 WAV (the only format DSH's
// recognizer takes), or null for anything else.
export function wavSeconds(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : null
  if (!data || data.length < 46) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tag = at => String.fromCharCode(...data.subarray(at, at + 4))
  const canonical = tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data'
    && view.getUint32(4, true) === data.length - 8
    && view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1
    && view.getUint32(24, true) === 16000 && view.getUint32(28, true) === BYTES_PER_SECOND
    && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16
    && view.getUint32(40, true) === data.length - 44 && (data.length - 44) % 2 === 0
  return canonical ? (data.length - 44) / BYTES_PER_SECOND : null
}

// getSpeech(): DSH's speechToText service, or undefined while Voice Input is
// not enabled.
export function createSpeechInput({ getSpeech, logger }) {
  // { state: 'ready' | 'off' | 'unprepared' | 'preparing' | 'failed', maxSeconds }
  function status() {
    const speech = getSpeech()
    let snapshot = null
    try {
      snapshot = speech?.snapshot?.() ?? null
    } catch {
      snapshot = null
    }
    const chosen = snapshot?.selection?.providerId
    const provider = snapshot?.providers?.find(entry => entry.id === chosen)
    if (!provider) return { state: 'off', maxSeconds: MAX_SPEECH_SECONDS }
    const phase = provider.preparation?.phase ?? 'ready'
    const state = USABLE.has(phase) ? 'ready' : PREPARING.has(phase) ? 'preparing' : phase === 'failed' ? 'failed' : 'unprepared'
    return { state, maxSeconds: MAX_SPEECH_SECONDS }
  }

  // audio: the recording's WAV bytes. Resolves with { text }.
  async function transcribe({ audio, signal }) {
    const { state } = status()
    if (state === 'off') throw new TutorError('speech-off', 'Voice input is not enabled in DSH')
    if (state !== 'ready') throw new TutorError('speech-unprepared', 'The speech recognizer is not ready yet')
    const seconds = wavSeconds(audio)
    if (seconds === null) throw new TutorError('speech-audio', 'The recording could not be read')
    if (seconds > MAX_SPEECH_SECONDS) throw new TutorError('speech-too-long', `Recordings are limited to ${MAX_SPEECH_SECONDS} seconds`)
    const speech = getSpeech()
    let result
    try {
      // No provider or language: DSH's own Voice Input choices apply.
      result = await speech.transcribe(speech.resolve({ audio: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength) }), signal ?? new AbortController().signal)
    } catch (error) {
      if (signal?.aborted) throw error
      logger?.debug?.('aha-tutor speech recognition failed: %s', error?.message)
      throw new TutorError('speech-failed', 'Speech recognition failed')
    }
    const text = String(typeof result === 'string' ? result : result?.text ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT)
    if (!text) throw new TutorError('speech-empty', 'No speech was heard')
    return { text }
  }

  return Object.freeze({ status, transcribe })
}
