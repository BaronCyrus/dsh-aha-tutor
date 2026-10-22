import assert from 'node:assert/strict'
import { test } from 'node:test'

import { speechRoute } from '../src/host/http.js'
import { createRoutes } from '../src/host/rpc.js'
import { createSpeechInput, MAX_SPEECH_BYTES, MAX_SPEECH_SECONDS, wavSeconds } from '../src/host/speech.js'
import { en, format, zh } from '../src/ui/i18n.js'
import { bytesToBase64, chosenMicrophone, createRecorder, DSH_MICROPHONE_KEY, encodeWav } from '../src/ui/recorder.js'

// A stand-in for DSH's speechToText service with one recognizer.
function fakeSpeech({ phase = 'standby', answer = '为什么 回复力  和位移相反？', fail = null } = {}) {
  const calls = []
  return {
    calls,
    snapshot: () => ({ providers: [{ id: 'sensevoice-local', languages: ['auto', 'zh'], preparation: { phase } }], selection: { providerId: 'sensevoice-local', language: 'auto' } }),
    resolve: request => {
      calls.push({ resolve: Object.keys(request).sort() })
      return { provider: 'sensevoice-local', audio: request.audio, language: 'auto' }
    },
    transcribe: async (spec, signal) => {
      calls.push({ transcribe: spec.audio.length, signal: signal instanceof AbortSignal })
      if (fail) throw new Error(fail)
      return answer
    },
  }
}

const second = encodeWav(new Float32Array(16000).map((_, index) => Math.sin(index / 10) * 0.5))

test('the browser\'s recording is the WAV DSH\'s recognizer takes', () => {
  assert.equal(second.length, 44 + 32000)
  assert.equal(wavSeconds(second), 1)
  const view = new DataView(second.buffer)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint16(34, true), 16, '16-bit')
  // Samples are clamped to the 16-bit range.
  const loud = new DataView(encodeWav(new Float32Array([2, -2, 0.5])).buffer)
  assert.deepEqual([loud.getInt16(44, true), loud.getInt16(46, true), loud.getInt16(48, true)], [32767, -32768, 16384])
  // Anything else is refused before it reaches DSH.
  const bad = second.slice()
  new DataView(bad.buffer).setUint32(24, 44100, true)
  assert.equal(wavSeconds(bad), null)
  assert.equal(wavSeconds(second.slice(0, 40)), null)
  assert.equal(wavSeconds(second.slice(0, second.length - 1)), null, 'a header that disagrees with the length')
  assert.equal(MAX_SPEECH_BYTES, 44 + MAX_SPEECH_SECONDS * 32000)
  assert.equal(Buffer.from(bytesToBase64(second), 'base64').equals(Buffer.from(second)), true)
})

test('voice questions are transcribed by DSH\'s Voice Input in its own language, and refused while it is not ready', async () => {
  // Not enabled: DSH has no speechToText service.
  const off = createSpeechInput({ getSpeech: () => undefined })
  assert.deepEqual(off.status(), { state: 'off', maxSeconds: MAX_SPEECH_SECONDS })
  await assert.rejects(off.transcribe({ audio: second }), { code: 'speech-off' })

  const phases = { unprepared: 'unprepared', cancelled: 'unprepared', checking: 'preparing', downloading: 'preparing', failed: 'failed', standby: 'ready', ready: 'ready' }
  for (const [phase, state] of Object.entries(phases)) assert.equal(createSpeechInput({ getSpeech: () => fakeSpeech({ phase }) }).status().state, state, phase)
  await assert.rejects(createSpeechInput({ getSpeech: () => fakeSpeech({ phase: 'downloading' }) }).transcribe({ audio: second }), { code: 'speech-unprepared' })

  const speech = fakeSpeech()
  const input = createSpeechInput({ getSpeech: () => speech })
  assert.deepEqual(await input.transcribe({ audio: second }), { text: '为什么 回复力 和位移相反？' })
  assert.deepEqual(speech.calls[0], { resolve: ['audio'] }, 'no provider or language of its own: DSH\'s choices apply')
  assert.deepEqual(speech.calls[1], { transcribe: second.length, signal: true })

  await assert.rejects(input.transcribe({ audio: second.slice(0, 100) }), { code: 'speech-audio' })
  const long = encodeWav(new Float32Array(16000 * (MAX_SPEECH_SECONDS + 1)))
  await assert.rejects(input.transcribe({ audio: long }), { code: 'speech-too-long' })
  await assert.rejects(createSpeechInput({ getSpeech: () => fakeSpeech({ answer: '  ' }) }).transcribe({ audio: second }), { code: 'speech-empty' })
  await assert.rejects(createSpeechInput({ getSpeech: () => fakeSpeech({ answer: { text: '' } }) }).transcribe({ audio: second }), { code: 'speech-empty' })
  assert.deepEqual(await createSpeechInput({ getSpeech: () => fakeSpeech({ answer: { text: ' ok ' } }) }).transcribe({ audio: second }), { text: 'ok' })
  // A recognizer failure reaches the learner without its internal details.
  await assert.rejects(createSpeechInput({ getSpeech: () => fakeSpeech({ fail: 'worker crashed at /secret/path' }) }).transcribe({ audio: second }), error => error.code === 'speech-failed' && !error.message.includes('/secret'))
})

test('a recording reaches the host as raw WAV over HTTP, or as base64 over RPC', async () => {
  const route = speechRoute({ speechInput: createSpeechInput({ getSpeech: () => fakeSpeech() }) })
  assert.equal(route.path, '/api/aha-tutor/speech')
  const ok = await route.fetch(new Request('http://dsh/api/aha-tutor/speech', { method: 'POST', body: second, headers: { 'content-type': 'audio/wav' } }))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, value: { text: '为什么 回复力 和位移相反？' } })

  const tooLong = await route.fetch(new Request('http://dsh/api/aha-tutor/speech', { method: 'POST', body: new Uint8Array(MAX_SPEECH_BYTES + 1) }))
  assert.equal(tooLong.status, 413)
  assert.equal((await tooLong.json()).error.code, 'aha-tutor/speech-too-long')

  const offRoute = speechRoute({ speechInput: createSpeechInput({ getSpeech: () => undefined }) })
  const refused = await offRoute.fetch(new Request('http://dsh/api/aha-tutor/speech', { method: 'POST', body: second }))
  assert.equal(refused.status, 400)
  assert.equal((await refused.json()).error.code, 'aha-tutor/speech-off')

  const routes = createRoutes({ speechInput: createSpeechInput({ getSpeech: () => fakeSpeech() }) })
  assert.deepEqual(await routes['speech/status'](), { state: 'ready', maxSeconds: MAX_SPEECH_SECONDS })
  assert.deepEqual(await routes['speech/transcribe']({ base64: bytesToBase64(second) }), { text: '为什么 回复力 和位移相反？' })
  await assert.rejects(routes['speech/transcribe']({ base64: 'not base64!' }), { code: 'speech-audio' })
  await assert.rejects(routes['speech/transcribe']({ base64: 'A'.repeat(Math.ceil(MAX_SPEECH_BYTES / 3) * 4 + 4) }), { code: 'speech-too-long' })
})

test('a voice question records from the microphone chosen in DSH\'s Voice input, and says so when it is gone', async () => {
  // DSH's browser side keeps the choice in the page's storage; the plugin
  // shares the page, so it reads the same entry. DSH 0.2.1's
  // @deepseek-ai/dsh-experimental-client-ui-voice-input persists
  // { id, label } under this name (createMicrophoneDeviceStore); recheck it
  // when DSH moves.
  assert.equal(DSH_MICROPHONE_KEY, 'dsh.voice-input.microphone')
  const saved = new Map()
  globalThis.window = { localStorage: { getItem: key => saved.get(key) ?? null } }
  const asked = []
  let refuse = null
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async constraints => {
          asked.push(constraints.audio)
          if (refuse) throw new DOMException('Requested device not found', refuse)
          return { getTracks: () => [{ stop() {} }] }
        },
      },
    },
  })
  globalThis.MediaRecorder = class {
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  const record = async () => {
    const recorder = createRecorder()
    await recorder.start()
    recorder.cancel()
    return asked.at(-1)
  }
  try {
    // Nothing chosen, or DSH's own "system default": the default input.
    assert.equal(chosenMicrophone(), null)
    assert.equal((await record()).deviceId, undefined)
    saved.set(DSH_MICROPHONE_KEY, JSON.stringify({ id: '', label: '' }))
    assert.equal((await record()).deviceId, undefined)

    // A chosen device is asked for exactly.
    saved.set(DSH_MICROPHONE_KEY, JSON.stringify({ id: 'usb-mic-1', label: 'USB 麦克风' }))
    assert.deepEqual(chosenMicrophone(), { id: 'usb-mic-1', label: 'USB 麦克风' })
    assert.deepEqual(await record(), { channelCount: 1, echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'usb-mic-1' } })

    // Gone (unplugged, or an id the browser no longer knows): said, never
    // swapped for another input.
    for (const name of ['OverconstrainedError', 'NotFoundError']) {
      refuse = name
      const before = asked.length
      await assert.rejects(createRecorder().start(), error => error.code === 'mic-chosen-missing' && error.device === 'USB 麦克风')
      assert.equal(asked.length, before + 1, 'no second try with another microphone')
    }
    refuse = 'NotAllowedError'
    await assert.rejects(createRecorder().start(), error => error.code === 'mic-denied' && error.device === undefined)
    assert.equal(format(zh.micChosenMissing, { name: 'USB 麦克风' }), 'DSH「语音输入」里选的麦克风「USB 麦克风」现在用不了：插上它，或到 DSH 插件管理的「语音输入」详情里换一个。')
    assert.equal(format(en.voiceAskWith, { name: 'USB mic' }), 'Ask by voice (microphone: USB mic)')
    refuse = null

    // An entry DSH might write differently one day reads as the default.
    for (const value of ['{"deviceId":"usb-mic-1"}', '"usb-mic-1"', 'not json', '{"id":7,"label":"x"}', '{"id":"usb-mic-1"}', 'null']) {
      saved.set(DSH_MICROPHONE_KEY, value)
      assert.equal(chosenMicrophone(), null, value)
    }
    globalThis.window = { localStorage: { getItem() { throw new DOMException('denied', 'SecurityError') } } }
    assert.equal(chosenMicrophone(), null, 'storage refused')
    delete globalThis.window
    assert.equal(chosenMicrophone(), null, 'no storage at all')
    assert.equal((await record()).deviceId, undefined)
  } finally {
    delete globalThis.window
    delete globalThis.MediaRecorder
    Object.defineProperty(globalThis, 'navigator', realNavigator)
  }
})
