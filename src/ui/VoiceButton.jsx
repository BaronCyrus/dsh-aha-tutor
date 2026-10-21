// The microphone beside a question box: click to start, click again to stop,
// and the words go into the box to check before asking. It works through
// DSH's experimental Voice Input; until that is enabled and its recognizer is
// ready, the button looks greyed out and, when clicked, says how to set it up.

import { useEffect, useRef, useState } from 'react'

import { ApiError } from './api.js'
import { errorText } from './components.jsx'
import { useApp } from './hooks.js'
import { Icon } from './icons.jsx'
import { bytesToBase64, createRecorder } from './recorder.js'

// Raw WAV over the plugin's HTTP route; base64 over RPC on hosts without it.
async function transcribe(api, wav) {
  try {
    const response = await fetch(new URL('api/aha-tutor/speech', document.baseURI), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'audio/wav' },
      body: wav,
    })
    if (response.status !== 404) {
      const body = await response.json()
      if (!body?.ok) throw new ApiError(body?.error?.code ?? 'speech-failed', body?.error?.message ?? 'Speech recognition failed')
      return body.value
    }
  } catch (error) {
    if (error?.message !== 'Failed to fetch') throw error
  }
  return api.call('speech/transcribe', { base64: bytesToBase64(wav) })
}

const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// onStart: the recording begins (a lesson pauses so its voice is not
// recorded). onText(text): what was said.
export function VoiceButton({ onText, onStart, disabled = false }) {
  const { api, t } = useApp()
  const [status, setStatus] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [note, setNote] = useState(null)
  const recorder = useRef(null)

  async function refresh() {
    let value
    try {
      value = await api.call('speech/status')
    } catch {
      value = { state: 'off' }
    }
    setStatus(value)
    return value
  }

  useEffect(() => {
    refresh()
    return () => recorder.current?.cancel()
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return undefined
    const timer = setInterval(() => setSeconds(Math.floor(recorder.current?.elapsed() ?? 0)), 250)
    return () => clearInterval(timer)
  }, [phase])

  async function finish() {
    const current = recorder.current
    if (!current) return
    recorder.current = null
    setPhase('working')
    try {
      const { text } = await transcribe(api, await current.stop())
      onText?.(text)
    } catch (error) {
      setNote({ text: errorText(t, error), error: true })
      if (/speech-(off|unprepared)$/u.test(String(error?.code ?? ''))) refresh()
    } finally {
      setPhase('idle')
    }
  }

  async function click() {
    if (phase === 'recording') {
      finish()
      return
    }
    if (phase !== 'idle') return
    setNote(null)
    // Voice Input may have been set up since the page opened.
    const current = status?.state === 'ready' ? status : await refresh()
    if (current.state !== 'ready') {
      setNote({ text: t(`voice_${current.state}`) })
      return
    }
    onStart?.()
    const local = createRecorder({ maxSeconds: current.maxSeconds ?? 120, onLimit: () => { finish() } })
    recorder.current = local
    setSeconds(0)
    setPhase('starting')
    try {
      await local.start()
      setPhase('recording')
    } catch (error) {
      recorder.current = null
      setPhase('idle')
      setNote({ text: errorText(t, error), error: true })
    }
  }

  const unavailable = status !== null && status.state !== 'ready'
  const recording = phase === 'recording'
  return <span className="aha-mic">
    <button type="button" className="aha-btn aha-micBtn" data-state={phase} data-unavailable={unavailable ? 'true' : undefined}
      aria-pressed={recording} aria-label={recording ? t('voiceStop') : t('voiceAsk')} title={recording ? t('voiceStop') : unavailable ? t('voiceSetup') : t('voiceAsk')}
      disabled={(disabled && phase === 'idle') || phase === 'starting' || phase === 'working'} onClick={click}>
      {phase === 'working' ? <span className="aha-spinner" /> : <Icon name={recording ? 'stop' : 'mic'} size={16} />}
      {recording ? <span className="aha-micTime">{clock(seconds)}</span> : phase === 'working' ? <span className="aha-micTime">{t('voiceWorking')}</span> : null}
    </button>
    {note ? <span className="aha-micNote" role="status" data-error={note.error ? 'true' : undefined}>
      {note.text}
      <button type="button" className="aha-micClose" aria-label={t('close')} onClick={() => setNote(null)}>×</button>
    </span> : null}
  </span>
}
