// Record one spoken question and turn it into the WAV DSH's recognizer takes:
// 16 kHz, mono, 16-bit PCM. The browser records in its own format
// (MediaRecorder); the recording is decoded and resampled once it stops.

const RATE = 16000

// What a refused or failed microphone means to the learner.
const MIC_ERRORS = {
  NotAllowedError: { code: 'mic-denied' },
  SecurityError: { code: 'mic-denied' },
  NotFoundError: { code: 'mic-missing' },
  OverconstrainedError: { code: 'mic-missing' },
  NotReadableError: { code: 'mic-busy' },
  AbortError: { code: 'mic-busy' },
}
const UNSUPPORTED = { code: 'mic-unsupported' }
const UNREADABLE = { code: 'speech-audio' }

// device: the name of the microphone chosen in DSH, when that one is missing.
function recordingError({ code, device }) {
  return Object.assign(new Error(code), { name: 'RecordingError', code }, device ? { device } : {})
}

// DSH's speechToText service knows only the recognizer and its language. The
// input device chosen in Voice input's details is kept by DSH's browser side,
// in this page's storage under this key, as { id, label } with an empty id for
// the system default. DSH has no API for it; should DSH keep it elsewhere,
// recordings fall back to the system default.
export const DSH_MICROPHONE_KEY = 'dsh.voice-input.microphone'

// The microphone chosen in DSH ({ id, label }), or null for the system default.
export function chosenMicrophone() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DSH_MICROPHONE_KEY) ?? 'null')
    if (typeof saved?.id === 'string' && saved.id && typeof saved.label === 'string') return { id: saved.id, label: saved.label.slice(0, 120) }
  } catch {
    // storage unavailable or unreadable
  }
  return null
}

// Float samples (-1…1) at 16 kHz → a canonical PCM16 WAV.
export function encodeWav(samples) {
  const data = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(data.buffer)
  const tag = (at, value) => { for (let index = 0; index < 4; index += 1) data[at + index] = value.charCodeAt(index) }
  tag(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  tag(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0))
    view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), true)
  }
  return data
}

// A recording in any format the browser decodes → WAV, at most maxSeconds.
// A mono destination mixes stereo down.
export async function recordingToWav(blob, maxSeconds) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext
  const context = new Context()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * RATE))
    const offline = new OfflineAudioContext(1, frames, RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodeWav(rendered.getChannelData(0))
  } finally {
    context.close?.()?.catch?.(() => undefined)
  }
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

// One recording at a time: start() asks for the microphone chosen in DSH,
// stop() resolves with the WAV bytes, cancel() drops everything. onLimit fires
// when the recording reaches maxSeconds.
export function createRecorder({ maxSeconds = 120, onLimit } = {}) {
  let stream = null
  let recorder = null
  let chunks = []
  let timer = null
  let startedAt = 0

  const release = () => {
    clearTimeout(timer)
    for (const track of stream?.getTracks?.() ?? []) track.stop()
    stream = null
  }

  async function start() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder !== 'function') throw recordingError(UNSUPPORTED)
    // Like DSH, a chosen microphone that is gone is reported, not replaced.
    const microphone = chosenMicrophone()
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(microphone ? { deviceId: { exact: microphone.id } } : {}) } })
    } catch (error) {
      if (microphone && (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError')) throw recordingError({ code: 'mic-chosen-missing', device: microphone.label })
      throw recordingError(MIC_ERRORS[error?.name] ?? UNSUPPORTED)
    }
    chunks = []
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
    recorder.start(250)
    startedAt = performance.now()
    timer = setTimeout(() => onLimit?.(), maxSeconds * 1000)
  }

  function stop() {
    return new Promise((resolve, reject) => {
      const current = recorder
      recorder = null
      if (!current || current.state === 'inactive') {
        release()
        reject(recordingError(UNREADABLE))
        return
      }
      current.onstop = async () => {
        release()
        try {
          resolve(await recordingToWav(new Blob(chunks, { type: current.mimeType || 'audio/webm' }), maxSeconds))
        } catch {
          reject(recordingError(UNREADABLE))
        }
      }
      current.stop()
    })
  }

  function cancel() {
    const current = recorder
    recorder = null
    chunks = []
    if (current && current.state !== 'inactive') {
      current.onstop = null
      current.stop()
    }
    release()
  }

  return { start, stop, cancel, elapsed: () => (startedAt ? (performance.now() - startedAt) / 1000 : 0) }
}
