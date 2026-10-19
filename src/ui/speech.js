// Narration for the whiteboard. Two engines share one interface:
//   browser — the OS voices behind window.speechSynthesis (free, offline)
//   cloud   — MP3 from the host's TTS proxy, played with an <audio> element
// speak() resolves when the narration ends (or is cancelled). Browser speech
// is queued sentence by sentence: Chromium stops long utterances after ~15 s
// on some voices, and pause/resume is unreliable on Windows, so pausing
// cancels the current sentence and resuming restarts it.

const SENTENCE = /[^。！？!?；;\n]+[。！？!?；;]*\s*|\n+/gu

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
    const state = { sentences: pieces.map(piece => piece.text), owners: pieces.map(piece => piece.owner), total, index: 0, paused: false, cancelled: false, rate, language, voiceId, resolveDone, onSentence }
    session = state
    playFrom(state)
    return { done }
  }

  function playFrom(state) {
    if (state.cancelled || state.paused) return
    if (state.index >= state.sentences.length) {
      state.resolveDone({ completed: true })
      if (session === state) session = null
      return
    }
    const utterance = new window.SpeechSynthesisUtterance(state.sentences[state.index])
    const voice = pickVoice(state.language, state.voiceId)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else if (state.language) {
      utterance.lang = state.language
    }
    utterance.rate = Math.min(2, Math.max(0.5, state.rate))
    const current = state.index
    utterance.onstart = () => state.onSentence?.(state.owners[current], state.total)
    const next = () => {
      if (state.cancelled || state.paused || state.index !== current) return
      state.index += 1
      playFrom(state)
    }
    utterance.onend = next
    // An engine error must not stall the lesson; skip to the next sentence.
    utterance.onerror = event => {
      if (event?.error === 'interrupted' || event?.error === 'canceled') return
      if (event?.error === 'not-allowed' || event?.error === 'synthesis-unavailable') {
        // No permission or no engine: stop and let the board pace itself.
        if (session === state) session = null
        state.cancelled = true
        state.resolveDone({ completed: false, error: event.error })
        return
      }
      next()
    }
    state.utterance = utterance
    window.speechSynthesis.speak(utterance)
  }

  function pause() {
    if (!session || session.paused) return
    session.paused = true
    window.speechSynthesis.cancel()
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
    if (browserSpeechAvailable()) window.speechSynthesis.cancel()
    state.resolveDone({ completed: false })
  }

  return { speak, pause, resume, cancel, setRate }
}

function cloudEngine({ fetchAudio }) {
  let session = null
  const cache = new Map()

  async function load(textValue) {
    if (cache.has(textValue)) return cache.get(textValue)
    const promise = fetchAudio(textValue).then(({ blob, base64, mime }) => {
      if (blob) return URL.createObjectURL(blob)
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }))
    })
    cache.set(textValue, promise)
    promise.catch(() => cache.delete(textValue))
    if (cache.size > 40) {
      const [oldestKey, oldest] = cache.entries().next().value
      cache.delete(oldestKey)
      oldest.then(url => URL.revokeObjectURL(url)).catch(() => undefined)
    }
    return promise
  }

  function prefetch(textValue) {
    if (textValue) load(textValue).catch(() => undefined)
  }

  function speak(textValue, { rate = 1 } = {}) {
    cancel()
    if (!String(textValue ?? '').trim()) return { done: Promise.resolve({ completed: true }) }
    let resolveDone
    const done = new Promise(resolve => { resolveDone = resolve })
    const audio = new Audio()
    audio.preservesPitch = true
    const state = { audio, cancelled: false, resolveDone, rate }
    session = state
    load(textValue).then(url => {
      if (state.cancelled) return
      audio.src = url
      audio.playbackRate = Math.min(2, Math.max(0.5, rate))
      audio.onended = () => { if (session === state) session = null; resolveDone({ completed: true }) }
      audio.onerror = () => { if (session === state) session = null; resolveDone({ completed: false, error: 'playback' }) }
      return audio.play()
    }).catch(error => {
      if (session === state) session = null
      resolveDone({ completed: false, error: error?.message ?? 'tts' })
    })
    return { done }
  }

  return {
    speak,
    prefetch,
    pause: () => session?.audio.pause(),
    resume: () => session?.audio.play().catch(() => undefined),
    setRate: rate => { if (session) session.audio.playbackRate = Math.min(2, Math.max(0.5, rate)) },
    cancel() {
      if (!session) return
      const state = session
      session = null
      state.cancelled = true
      state.audio.pause()
      state.resolveDone({ completed: false })
    },
    clear() {
      for (const promise of cache.values()) promise.then(url => URL.revokeObjectURL(url)).catch(() => undefined)
      cache.clear()
    },
  }
}

// settings: { engine: 'browser' | 'cloud' | 'off', voiceId, rate, language }
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
      return active.speak(textValue, { ...settings, ...options })
    },
    prefetch(textValue) {
      if (settings.engine === 'cloud') engines.cloud.prefetch(textValue)
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
