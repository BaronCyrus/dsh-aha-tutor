// The microphone beside a question box: click to start, click again to stop,
// and the words go into the box to check before asking. It works through
// DSH's experimental Voice Input and records from the microphone chosen there;
// until Voice Input is enabled and its recognizer is ready, the button looks
// greyed out and, when clicked, says how to set it up. A page with a
// push-to-talk key passes its presses on through the ref (see talk-key.js).

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

import { ApiError } from './api.js'
import { errorText } from './components.jsx'
import { useApp } from './hooks.js'
import { Icon } from './icons.jsx'
import { bytesToBase64, chosenMicrophone, createRecorder } from './recorder.js'
import { keepInsideWhileShown } from './scroll.js'
import { createTalkKey } from './talk-key.js'

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

// The microphone chosen in DSH is named when DSH saved its name.
function noteText(t, error) {
  return error?.code === 'mic-chosen-missing' && error.device ? t('micChosenMissing', { name: error.device }) : errorText(t, error)
}

// onStart: the recording begins (a lesson pauses so its voice is not
// recorded). onText(text): what was said. keyHint: a tooltip line naming the
// page's push-to-talk key; ref: { press(at), release(at) } for that key.
export const VoiceButton = forwardRef(function VoiceButton({ onText, onStart, disabled = false, keyHint = '' }, ref) {
  const { api, t } = useApp()
  const [status, setStatus] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [note, setNote] = useState(null)
  // Read again on hover: the choice may change in DSH while this page is open.
  const [micName, setMicName] = useState(() => chosenMicrophone()?.label ?? '')
  const recorder = useRef(null)
  const noteBox = useRef(null)
  const button = useRef(null)
  // The phase as of now, for key presses that come between renders, and a
  // stop asked for while the microphone was still opening.
  const phaseNow = useRef('idle')
  const stopWhenStarted = useRef(false)
  const talkKey = useRef(null)
  talkKey.current ??= createTalkKey()
  const move = next => {
    phaseNow.current = next
    setPhase(next)
  }

  // In a narrow window the note would stick out beside the button.
  useLayoutEffect(() => (note && noteBox.current ? keepInsideWhileShown(noteBox.current) : undefined), [note])

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
    move('working')
    try {
      const { text } = await transcribe(api, await current.stop())
      onText?.(text)
    } catch (error) {
      setNote({ text: errorText(t, error), error: true })
      if (/speech-(off|unprepared)$/u.test(String(error?.code ?? ''))) refresh()
    } finally {
      move('idle')
    }
  }

  async function begin() {
    setNote(null)
    stopWhenStarted.current = false
    move('starting')
    // Voice Input may have been set up since the page opened.
    const current = status?.state === 'ready' ? status : await refresh()
    if (current.state !== 'ready') {
      move('idle')
      setNote({ text: t(`voice_${current.state}`) })
      return
    }
    onStart?.()
    const local = createRecorder({ maxSeconds: current.maxSeconds ?? 120, onLimit: () => { finish() } })
    recorder.current = local
    setSeconds(0)
    try {
      await local.start()
      move('recording')
      if (stopWhenStarted.current) finish()
    } catch (error) {
      recorder.current = null
      move('idle')
      setNote({ text: noteText(t, error), error: true })
    }
  }

  function stop() {
    if (phaseNow.current === 'starting') stopWhenStarted.current = true
    else if (phaseNow.current === 'recording') finish()
  }

  function click() {
    if (phaseNow.current === 'recording') finish()
    else if (phaseNow.current === 'idle') begin()
  }

  useImperativeHandle(ref, () => ({
    press(at) {
      if (disabled && phaseNow.current === 'idle') return
      const action = talkKey.current.down(phaseNow.current, at)
      if (action === 'start') {
        // On a narrow page the question box may sit below the board.
        button.current?.scrollIntoView?.({ block: 'nearest' })
        begin()
      } else if (action === 'stop') {
        stop()
      }
    },
    release(at) {
      if (talkKey.current.up(phaseNow.current, at) === 'stop') stop()
    },
  }))

  const unavailable = status !== null && status.state !== 'ready'
  const recording = phase === 'recording'
  const title = recording ? t('voiceStop') : unavailable ? t('voiceSetup') : micName ? t('voiceAskWith', { name: micName }) : t('voiceAsk')
  return <span className="aha-mic">
    <button ref={button} type="button" className="aha-btn aha-micBtn" data-state={phase} data-unavailable={unavailable ? 'true' : undefined}
      aria-pressed={recording} aria-label={recording ? t('voiceStop') : t('voiceAsk')}
      title={keyHint ? `${title}\n${keyHint}` : title}
      disabled={(disabled && phase === 'idle') || phase === 'starting' || phase === 'working'} onClick={click}
      onPointerEnter={() => setMicName(chosenMicrophone()?.label ?? '')}>
      {phase === 'working' ? <span className="aha-spinner" /> : <Icon name={recording ? 'stop' : 'mic'} size={16} />}
      {recording ? <span className="aha-micTime">{clock(seconds)}</span> : phase === 'working' ? <span className="aha-micTime">{t('voiceWorking')}</span> : null}
    </button>
    {note ? <span ref={noteBox} className="aha-micNote" role="status" data-error={note.error ? 'true' : undefined}>
      {note.text}
      <button type="button" className="aha-micClose" aria-label={t('close')} onClick={() => setNote(null)}>×</button>
    </span> : null}
  </span>
})
