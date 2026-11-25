// Narration for the whiteboard. Two engines share one interface:
//   browser — the OS voices behind window.speechSynthesis (free, offline)
//   cloud   — MP3 from the host's TTS proxy, a sentence at a time, played
//             with <audio> elements
// speak() returns { done, tracked }: done resolves when the narration ends
// (or is cancelled); tracked says onSentence will report each sentence as it
// starts, the first one included.
// Browser speech is queued sentence by sentence: Chromium stops long
// utterances after ~15 s on some voices, and pause/resume is unreliable on
// Windows, so pausing cancels the current sentence and resuming restarts it.

import { estimateSpeechMs } from '../core/board-script.js'

const SENTENCE = /[^。！？!?；;\n]+[。！？!?；;]*\s*|\n+/gu

// Chromium drops an utterance spoken in the same task as a cancel() that
// removed one not yet started: no event ever comes for it, speechSynthesis
// keeps saying it is speaking, and every later utterance waits behind it
// until the next cancel() (seen in DSH's Electron on macOS). So a sentence
// spoken after a cancel waits for the next task, and the engine does not
// wait forever for a sentence that never starts or never ends.
const START_WAIT_MS = 4000
// A sentence this far past its estimated length is taken as ended. Going on
// only queues the next sentence; it never cuts a voice off.
const END_SLACK = 2
const END_EXTRA_MS = 4000

// speechSynthesis is one queue for the whole page, so the task after the
// last cancel is tracked here, not per engine.
let settled = null
function hush() {
  window.speechSynthesis.cancel()
  settled ??= new Promise(resolve => setTimeout(() => { settled = null; resolve() }, 0))
}

export function splitSentences(textValue) {
  const parts = []
  for (const match of String(textValue ?? '').matchAll(SENTENCE)) {
    const part = match[0].trim()
    if (!part) continue
    // Keep each utterance short enough for every engine.
    if (part.length <= 160) parts.push(part)
    else for (let index = 0; index < part.length; index += 140) parts.push(part.slice(index, index + 140))
  }
  return parts
}

export function browserSpeechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

export function listVoices() {
  if (!browserSpeechAvailable()) return []
  return window.speechSynthesis.getVoices().map(voice => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang, local: voice.localService, default: voice.default }))
}

export function onVoicesChanged(callback) {
  if (!browserSpeechAvailable()) return () => undefined
  const handler = () => callback(listVoices())
  window.speechSynthesis.addEventListener?.('voiceschanged', handler)
  return () => window.speechSynthesis.removeEventListener?.('voiceschanged', handler)
}

// Best local voice for a language; natural/enhanced voices first.
export function pickVoice(language, preferredId) {
  if (!browserSpeechAvailable()) return null
  const voices = window.speechSynthesis.getVoices()
  if (preferredId) {
    const chosen = voices.find(voice => voice.voiceURI === preferredId)
    if (chosen) return chosen
  }
  const lang = String(language || 'zh-CN').toLowerCase()
  const base = lang.split('-')[0]
  const score = voice => {
    const voiceLang = voice.lang.toLowerCase().replace('_', '-')
    let value = 0
    if (voiceLang === lang) value += 40
    else if (voiceLang.startsWith(base)) value += 25
    else return -1
    if (base === 'zh' && lang === 'zh-cn' && /tw|hk/u.test(voiceLang)) value -= 10
    if (/natural|neural|enhanced|premium|siri/iu.test(voice.name)) value += 12
    if (voice.localService) value += 6
    if (/xiaoxiao|tingting|yunxi|xiaoyi|lili|huihui/iu.test(voice.name)) value += 4
    return value
  }
  return voices.map(voice => ({ voice, value: score(voice) })).filter(entry => entry.value >= 0).sort((a, b) => b.value - a.value)[0]?.voice ?? null
}

function browserEngine() {
  let session = null

  // `sentences` (optional) is the narration already split the way captions
  // show it; onSentence(index, total) then reports positions in that list.
  function speak(textValue, { language, voiceId, rate = 1, onSentence, sentences: given } = {}) {
    cancel()
    const pieces = Array.isArray(given) && given.length
      ? given.flatMap((sentence, owner) => splitSentences(sentence).map(text => ({ text, owner })))
      : splitSentences(textValue).map((text, owner) => ({ text, owner }))
    const total = Array.isArray(given) && given.length ? given.length : pieces.length
    if (!browserSpeechAvailable() || !pieces.length) return { done: Promise.resolve({ completed: true }) }
    let resolveDone
    const done = new Promise(resolve => { resolveDone = resolve })
    // retried: the sentence already spoken a second time after not starting.
    const state = { sentences: pieces.map(piece => piece.text), owners: pieces.map(piece => piece.owner), total, index: 0, paused: false, cancelled: false, rate, language, voiceId, resolveDone, onSentence, utterance: null, timer: null, retried: -1 }
    session = state
    playFrom(state)
    return { done, tracked: typeof onSentence === 'function' }
  }

  function finish(state, result) {
    clearTimeout(state.timer)
    if (session === state) session = null
    state.resolveDone(result)
  }

  function playFrom(state) {
    clearTimeout(state.timer)
    if (state.cancelled || state.paused) return
    if (state.index >= state.sentences.length) {
      finish(state, { completed: true })
      return
    }
    const current = state.index
    const text = state.sentences[current]
    const utterance = new window.SpeechSynthesisUtterance(text)
    const voice = pickVoice(state.language, state.voiceId)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else if (state.language) {
      utterance.lang = state.language
    }
    utterance.rate = Math.min(2, Math.max(0.5, state.rate))
    // Events of an utterance that was cancelled, paused or replaced are old news.
    const live = () => state.utterance === utterance && !state.cancelled && !state.paused
    const next = () => {
      if (!live() || state.index !== current) return
      state.index += 1
      playFrom(state)
    }
    utterance.onstart = () => {
      if (!live()) return
      clearTimeout(state.timer)
      // An end event that never comes must not hold the lesson.
      state.timer = setTimeout(next, estimateSpeechMs(text, state.rate) * END_SLACK + END_EXTRA_MS)
      state.onSentence?.(state.owners[current], state.total)
    }
    utterance.onend = next
    utterance.onerror = event => {
      if (!live()) return
      if (event?.error === 'not-allowed' || event?.error === 'synthesis-unavailable') {
        // No permission or no engine: stop and let the board pace itself.
        state.cancelled = true
        finish(state, { completed: false, error: event.error })
        return
      }
      // Any other error, an interruption from elsewhere on the page included,
      // must not stall the lesson: skip to the next sentence.
      next()
    }
    state.utterance = utterance
    const say = () => {
      if (!live()) return
      window.speechSynthesis.speak(utterance)
      state.timer = setTimeout(() => {
        if (!live()) return
        hush()
        // Not started: clear whatever holds the voice and try once more,
        // then give up on the voice for this narration.
        if (state.retried !== current) {
          state.retried = current
          playFrom(state)
          return
        }
        state.cancelled = true
        finish(state, { completed: false, error: 'The system voice did not start speaking', code: 'speech-stalled' })
      }, START_WAIT_MS)
    }
    if (settled) settled.then(say)
    else say()
  }

  function pause() {
    if (!session || session.paused) return
    session.paused = true
    clearTimeout(session.timer)
    hush()
  }

  function resume() {
    if (!session || !session.paused) return
    session.paused = false
    playFrom(session)
  }

  function setRate(rate) {
    if (!session) return
    session.rate = rate
  }

  function cancel() {
    if (!session) return
    const state = session
    session = null
    state.cancelled = true
    clearTimeout(state.timer)
    if (browserSpeechAvailable()) hush()
    state.resolveDone({ completed: false })
  }

  return { speak, pause, resume, cancel, setRate }
}

// The cloud voice the host speaks with, as a key for audio kept in the
// browser: the service and its settings, which never include a key.
export function cloudVoiceOf(settings) {
  const provider = settings?.ttsProvider ?? ''
  const config = settings?.tts?.[provider] ?? {}
  return JSON.stringify([provider, Object.keys(config).sort().map(key => [key, config[key]])])
}

// Sentences of a cloud narration asked for ahead of the one being said.
const LOOKAHEAD = 2
// A sentence after the first whose audio failed for a reason that may pass
// (a rate limit, a server error, no connection) is asked for once more after
// this long.
const RETRY_MS = 1500
const PASSING_FAILURES = new Set(['tts-rate-limit', 'tts-server', 'tts-network', 'tts-failed'])
// Text with nothing to say ("……") is not sent to the service.
const SPEAKABLE = /[\p{L}\p{N}]/u
const playbackRate = rate => Math.min(2, Math.max(0.5, Number(rate) || 1))
const failureCode = error => (typeof error?.code === 'string' && error.code ? error.code.replace(/^aha-tutor\//u, '') : '')

// The pieces a narration is said in: the sentences the captions show, or the
// whole narration when there are none.
function piecesOf(textValue, sentences) {
  const given = Array.isArray(sentences) ? sentences.map(sentence => String(sentence ?? '').trim()) : []
  if (given.some(Boolean)) return given
  const whole = String(textValue ?? '').trim()
  return whole ? [whole] : []
}

function cloudEngine({ fetchAudio }) {
  let session = null
  // Audio by voice (cloudVoiceOf) and text: once the voice changes, a
  // sentence heard before is fetched again in the new voice.
  const cache = new Map()

  async function load(textValue, voice = '') {
    const key = `${voice}\n${textValue}`
    if (cache.has(key)) return cache.get(key)
    const promise = fetchAudio(textValue).then(({ blob, base64, mime }) => {
      if (blob) return URL.createObjectURL(blob)
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }))
    })
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
    if (cache.size > 120) {
      const [oldestKey, oldest] = cache.entries().next().value
      cache.delete(oldestKey)
      oldest.then(url => URL.revokeObjectURL(url)).catch(() => undefined)
    }
    return promise
  }

  // The first sentence of a narration about to be spoken.
  function prefetch(textValue, voice, sentences) {
    const first = piecesOf(textValue, sentences).find(piece => SPEAKABLE.test(piece))
    if (first) load(first, voice).catch(() => undefined)
  }

  // `sentences` (optional) is the narration as captions split it. Each
  // sentence is then its own audio, asked for a sentence or two ahead, and
  // with onSentence each is reported as its audio starts.
  function speak(textValue, { rate = 1, cloudVoice, sentences, onSentence } = {}) {
    cancel()
    const pieces = piecesOf(textValue, sentences)
    if (!pieces.some(piece => SPEAKABLE.test(piece))) return { done: Promise.resolve({ completed: true }) }
    const tracked = typeof onSentence === 'function' && Array.isArray(sentences) && sentences.length > 0
    let resolveDone
    const done = new Promise(resolve => { resolveDone = resolve })
    // index: the piece being said. audio: its <audio>, once its audio came.
    // waiting: a piece with nothing to say, shown for as long as it would take.
    const state = { cancelled: false, paused: false, rate, resolveDone, index: -1, audio: null, waiting: null, waitTimer: null, retryTimer: null, reported: -1, retried: new Set() }
    session = state
    const live = () => session === state && !state.cancelled
    // Each piece is asked for once the one before it has come, so a
    // narration has at most one request out at a time.
    const requested = new Map()
    let queue = Promise.resolve()
    const request = index => {
      if (index >= pieces.length || !SPEAKABLE.test(pieces[index])) return null
      if (!requested.has(index)) {
        const loading = queue.then(() => (live() ? load(pieces[index], cloudVoice) : null))
        queue = loading.catch(() => undefined)
        requested.set(index, loading)
      }
      return requested.get(index)
    }
    const heard = index => {
      if (!tracked || index <= state.reported) return
      state.reported = index
      onSentence(index, pieces.length)
    }
    const settle = result => {
      clearTimeout(state.waitTimer)
      clearTimeout(state.retryTimer)
      if (session === state) session = null
      resolveDone(result)
    }
    // The host's failures carry their code (tts-no-key, …). A browser that
    // will not play the audio, one not clicked yet for instance, gives only a
    // DOMException, whose numeric code means nothing to the learner.
    const fail = (error, fallback) => {
      state.audio?.pause()
      settle({ completed: false, error: error?.message ?? fallback.code, code: typeof error?.code === 'string' && error.code ? error.code : fallback.code })
    }
    const wait = index => {
      state.waiting = index
      if (state.paused) return
      clearTimeout(state.waitTimer)
      state.waitTimer = setTimeout(() => {
        if (!live() || state.waiting !== index) return
        state.waiting = null
        play(index + 1)
      }, Math.max(300, estimateSpeechMs(pieces[index], state.rate)))
    }
    const play = index => {
      if (!live()) return
      state.index = index
      state.audio = null
      state.waiting = null
      if (index >= pieces.length) {
        settle({ completed: true })
        return
      }
      for (let ahead = index; ahead <= index + LOOKAHEAD; ahead += 1) request(ahead)
      const loading = request(index)
      if (!loading) {
        heard(index)
        wait(index)
        return
      }
      loading.then(url => {
        if (!live() || state.index !== index || !url) return
        // A page that cannot play audio fails like a voice that cannot
        // speak, and the lesson goes on silently.
        let audio
        try {
          audio = new Audio()
        } catch (error) {
          console.error(error)
          fail(error, { code: 'speech' })
          return
        }
        audio.preservesPitch = true
        audio.src = url
        audio.playbackRate = playbackRate(state.rate)
        const current = () => live() && state.audio === audio
        // A sentence is reported when its audio is heard, not when it was
        // asked for.
        audio.onplaying = () => { if (current()) heard(index) }
        audio.onended = () => { if (current()) play(index + 1) }
        audio.onerror = () => { if (current()) fail(null, { code: 'playback' }) }
        state.audio = audio
        if (!state.paused) audio.play().catch(error => { if (current()) fail(error, { code: 'playback' }) })
      }, error => {
        if (!live() || state.index !== index) return
        if (index > 0 && !state.retried.has(index) && PASSING_FAILURES.has(failureCode(error) || 'tts-failed')) {
          // Asked for straight away, not behind the sentences after it.
          state.retried.add(index)
          state.retryTimer = setTimeout(() => {
            requested.set(index, load(pieces[index], cloudVoice))
            play(index)
          }, RETRY_MS)
          return
        }
        fail(error, { code: 'tts-failed' })
      })
    }
    // After a pause: the sentence being said goes on, a piece with nothing to
    // say waits from its start, and a sentence whose audio has not come yet
    // plays when it comes.
    state.resumeWith = () => {
      if (state.audio) state.audio.play().catch(() => undefined)
      else if (state.waiting !== null) wait(state.waiting)
    }
    play(0)
    return { done, tracked }
  }

  function cancel() {
    if (!session) return
    const state = session
    session = null
    state.cancelled = true
    clearTimeout(state.waitTimer)
    clearTimeout(state.retryTimer)
    state.audio?.pause()
    state.resolveDone({ completed: false })
  }

  function pause() {
    if (!session || session.paused) return
    session.paused = true
    clearTimeout(session.waitTimer)
    session.audio?.pause()
  }

  function resume() {
    if (!session || !session.paused) return
    session.paused = false
    session.resumeWith()
  }

  return {
    speak,
    prefetch,
    pause,
    resume,
    setRate: rate => {
      if (!session) return
      session.rate = rate
      if (session.audio) session.audio.playbackRate = playbackRate(rate)
    },
    cancel,
    clear() {
      for (const promise of cache.values()) promise.then(url => URL.revokeObjectURL(url)).catch(() => undefined)
      cache.clear()
    },
  }
}

// settings: { engine: 'browser' | 'cloud' | 'off', voiceId, rate, language,
// cloudVoice } — cloudVoice (cloudVoiceOf) is the host's current cloud voice.
export function createSpeech({ fetchAudio }) {
  const engines = { browser: browserEngine(), cloud: cloudEngine({ fetchAudio }) }
  let settings = { engine: 'browser', rate: 1 }
  let active = null

  return {
    configure(next) {
      settings = { ...settings, ...next }
    },
    get settings() {
      return settings
    },
    speak(textValue, options = {}) {
      active?.cancel()
      if (settings.engine === 'off') {
        active = null
        return { done: Promise.resolve({ completed: true, silent: true }) }
      }
      active = engines[settings.engine] ?? engines.browser
      // An engine that throws fails like one whose audio never came: the
      // lesson goes on silently instead of taking the page down with it.
      try {
        return active.speak(textValue, { ...settings, ...options })
      } catch (error) {
        console.error(error)
        return { done: Promise.resolve({ completed: false, error: error?.message ?? 'speech' }) }
      }
    },
    // The start of a narration about to be spoken; sentences as for speak().
    prefetch(textValue, { sentences } = {}) {
      if (settings.engine === 'cloud') engines.cloud.prefetch(textValue, settings.cloudVoice, sentences)
    },
    pause: () => active?.pause(),
    resume: () => active?.resume(),
    setRate(rate) {
      settings = { ...settings, rate }
      active?.setRate(rate)
    },
    cancel: () => active?.cancel(),
    dispose() {
      engines.browser.cancel()
      engines.cloud.cancel()
      engines.cloud.clear()
    },
  }
}

// Failures that will not pass during a lesson: the voice's settings are
// wrong (no key, a rejected key, a bad address or region, a refused request),
// the service stopped answering or timed out (each try holds a step for 10 to
// 45 s), or the voice cannot speak at all ('speech': a system voice without
// permission or engine, or an engine that threw). Other failures (no
// connection, a rate limit, a server error) may pass, so they stop the voice
// only when the next step fails too.
const LASTING_FAILURES = new Set(['tts-no-key', 'tts-auth', 'tts-address', 'tts-app-id', 'tts-azure', 'tts-config', 'tts-request', 'tts-stalled', 'tts-timeout', 'no-credentials', 'speech'])

// What one step's narration means for the rest of a lesson. `failures`
// counts failed narrations in a row; `stop` ({ code, message }) is set when
// the voice should stay off and the learner be told why.
export function afterNarration(failures, result) {
  if (!result?.error) return { failures: result?.completed && !result.silent ? 0 : failures, stop: null }
  // The host names its codes aha-tutor/tts-no-key and so on.
  const code = (typeof result.code === 'string' && result.code ? result.code : 'speech').replace(/^aha-tutor\//u, '')
  const count = failures + 1
  return { failures: count, stop: LASTING_FAILURES.has(code) || count >= 2 ? { code, message: String(result.error) } : null }
}
