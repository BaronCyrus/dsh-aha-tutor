// Lesson playback: narrates each step while writing its ops one after
// another, waits on understanding checks, buffers while the lesson is still
// being generated, and supports pause, seek, speed and inserted steps.
// Framework-free; the React layer subscribes to snapshots.

import { estimateSpeechMs, stepTiming } from '../../core/board-script.js'
import { captionSentences, spokenText } from './inline.js'

const STEP_GAP_MS = 450

export function createPlayer({ speech, onChange, now = () => performance.now(), frame, cancelFrame, startIndex = 0 }) {
  const requestFrame = frame ?? (callback => requestAnimationFrame(callback))
  const cancel = cancelFrame ?? (handle => cancelAnimationFrame(handle))
  let steps = []
  let complete = false
  let rate = 1
  let handle = null
  let run = null
  const answered = new Set()
  const state = {
    index: Math.max(0, startIndex),
    op: 0,
    progress: 0,
    sentence: 0, // the caption sentence being spoken
    status: 'idle', // idle | playing | paused | check | buffering | ended
  }

  const snapshot = () => ({ ...state, total: steps.length, complete, rate, step: steps[state.index] ?? null })
  const emit = () => onChange?.(snapshot())

  function stopLoop() {
    if (handle !== null) cancel(handle)
    handle = null
  }

  function startStep() {
    stopLoop()
    speech?.cancel?.()
    const step = steps[state.index]
    if (!step) {
      state.status = complete ? 'ended' : 'buffering'
      emit()
      return
    }
    state.op = 0
    state.progress = 0
    state.sentence = 0
    state.status = 'playing'
    const timing = stepTiming(step, { rate })
    const sentences = captionSentences(step.say).map(spokenText)
    run = { step, timing, startedAt: now(), elapsedBefore: 0, speechDone: !step.say, silentUntil: null, token: {}, sentences, exactSentence: false }
    const token = run.token
    if (step.say) {
      const spoken = speech?.speak(spokenText(step.say), {
        rate,
        sentences,
        // System voices report each sentence as it starts; other engines are
        // followed by elapsed time instead (see sentenceAt).
        onSentence: index => {
          if (!run || run.token !== token) return
          run.exactSentence = true
          if (state.sentence !== index) {
            state.sentence = index
            emit()
          }
        },
      }) ?? { done: Promise.resolve({ silent: true }) }
      spoken.done.then(result => {
        if (!run || run.token !== token) return
        if (result?.silent || result?.error) run.silentUntil = estimateSpeechMs(step.say, rate) * 0.8
        else run.speechDone = true
      })
      speech?.prefetch?.(spokenText(steps[state.index + 1]?.say ?? ''))
    }
    emit()
    loop()
  }

  // Which sentence is being spoken, estimated from elapsed time and the
  // sentences' lengths when the engine does not report it.
  function sentenceAt(time) {
    const sentences = run?.sentences ?? []
    if (sentences.length < 2) return 0
    if (run.speechDone) return sentences.length - 1
    const total = estimateSpeechMs(run.step.say, rate)
    const lengths = sentences.map(sentence => [...sentence].length)
    const sum = lengths.reduce((acc, value) => acc + value, 0) || 1
    let passed = 0
    for (let index = 0; index < lengths.length; index += 1) {
      passed += lengths[index]
      if (time < (passed / sum) * total) return index
    }
    return sentences.length - 1
  }

  function elapsed() {
    if (!run) return 0
    return run.elapsedBefore + (state.status === 'playing' ? now() - run.startedAt : 0)
  }

  function loop() {
    handle = requestFrame(tick)
  }

  function tick() {
    handle = null
    if (state.status !== 'playing' || !run) return
    const time = elapsed()
    const writes = run.timing.writeMs
    let acc = 0
    let op = writes.length
    let progress = 1
    for (let index = 0; index < writes.length; index += 1) {
      if (time < acc + writes[index]) {
        op = index
        progress = writes[index] ? (time - acc) / writes[index] : 1
        break
      }
      acc += writes[index]
    }
    const sentence = run.exactSentence ? state.sentence : sentenceAt(time)
    const changed = op !== state.op || Math.abs(progress - state.progress) > 0.002 || sentence !== state.sentence
    state.op = op
    state.sentence = sentence
    state.progress = Math.min(1, Math.max(0, progress))
    if (run.silentUntil !== null && time >= run.silentUntil) run.speechDone = true
    const written = op >= writes.length
    if (written && run.speechDone && time >= acc + STEP_GAP_MS) {
      finishStep()
      return
    }
    if (changed) emit()
    loop()
  }

  function finishStep() {
    const step = steps[state.index]
    state.op = step?.ops.length ?? 0
    state.progress = 1
    if (step?.check && !answered.has(step.check.id)) {
      state.status = 'check'
      emit()
      return
    }
    advance()
  }

  function advance() {
    state.index += 1
    startStep()
  }

  return {
    get state() {
      return snapshot()
    },
    setSteps(next, { done = false } = {}) {
      steps = next
      complete = done
      if (state.status === 'buffering' && steps[state.index]) startStep()
      else if (state.status === 'buffering' && complete) {
        state.status = 'ended'
        emit()
      } else emit()
    },
    play() {
      if (state.status === 'playing') return
      if (state.status === 'paused' && run) {
        state.status = 'playing'
        run.startedAt = now()
        speech?.resume?.()
        emit()
        loop()
        return
      }
      if (state.status === 'ended') state.index = 0
      if (state.status === 'check') return
      startStep()
    },
    pause() {
      if (state.status !== 'playing' || !run) return
      run.elapsedBefore = elapsed()
      state.status = 'paused'
      stopLoop()
      speech?.pause?.()
      emit()
    },
    toggle() {
      if (state.status === 'playing') this.pause()
      else this.play()
    },
    next() {
      const step = steps[state.index]
      if (state.status === 'check' && step?.check) answered.add(step.check.id)
      if (!step) return
      stopLoop()
      speech?.cancel?.()
      advance()
    },
    prev() {
      stopLoop()
      speech?.cancel?.()
      // Like a media player: at the very start of a step go back one step,
      // otherwise replay the current step.
      const atStart = state.op === 0 && state.progress < 0.05
      state.index = Math.max(0, Math.min(steps.length - 1, atStart ? state.index - 1 : state.index))
      startStep()
    },
    seek(index) {
      stopLoop()
      speech?.cancel?.()
      state.index = Math.min(Math.max(0, index), Math.max(0, steps.length))
      startStep()
    },
    // The learner answered the step's check; continue the lesson.
    answer(checkId) {
      answered.add(checkId)
      if (state.status === 'check') advance()
    },
    setRate(value) {
      const nextRate = Math.min(2, Math.max(0.5, Number(value) || 1))
      if (run && state.status === 'playing') {
        // Keep the current position, rescale what remains.
        const time = elapsed()
        const ratio = rate / nextRate
        run.elapsedBefore = time * ratio
        run.startedAt = now()
        run.timing = stepTiming(run.step, { rate: nextRate })
      }
      rate = nextRate
      speech?.setRate?.(nextRate)
      emit()
    },
    // Insert steps (an answer, a re-explanation) right after the current one.
    insertAfterCurrent(extra) {
      if (!extra?.length) return steps
      const at = Math.min(steps.length, state.index + 1)
      steps = [...steps.slice(0, at), ...extra, ...steps.slice(at)]
      emit()
      return steps
    },
    dispose() {
      stopLoop()
      speech?.cancel?.()
      run = null
    },
  }
}
