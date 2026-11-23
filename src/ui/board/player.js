// Lesson playback: narrates each step while writing its ops one after
// another, waits on understanding checks, buffers while the lesson is still
// being generated, and supports pause, seek, speed and inserted steps.
// Framework-free; the React layer subscribes to snapshots.

import { estimateSpeechMs, opSentences, sentenceAtFraction, stepTiming } from '../../core/board-script.js'
import { captionSentences, spokenText } from './inline.js'

const STEP_GAP_MS = 450
// A voice that reports its sentences gets this long to start (a cloud voice
// still downloading, a system voice warming up) before the board goes on
// without it.
const VOICE_WAIT_MS = 3000
// How much faster than planned the board writes what it still owes once the
// voice has reached a later sentence with ops of its own, or has finished.
const CATCH_UP = 2.5

const total = values => values.reduce((sum, value) => sum + value, 0)

// onNarration(result) hears how each step's narration ended (spoken, silent
// or failed), except a narration cut short by moving to another step.
export function createPlayer({ speech, onChange, onNarration, now = () => performance.now(), frame, cancelFrame, startIndex = 0 }) {
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

  // In a synced step, the ops written during the sentence being spoken: the
  // board highlights them (the pencil already shows the one being written).
  const nowOps = () => {
    if (!run?.synced || (state.status !== 'playing' && state.status !== 'paused')) return []
    return run.step.ops.filter((op, index) => index <= state.op && run.owners[index] === state.sentence).map(op => (op.t === 'mark' ? op.ref : op.id))
  }
  const snapshot = () => ({ ...state, total: steps.length, complete, rate, step: steps[state.index] ?? null, now: nowOps() })
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
    const sentences = captionSentences(step.say).map(spokenText)
    const sentenceMs = sentences.map(sentence => estimateSpeechMs(sentence, rate))
    const timing = stepTiming(step, { rate, sentenceMs })
    // Synced steps write each op when its sentence starts (see tick).
    const owners = opSentences(step, sentences.length)
    // offset: time spent waiting for the voice to start, which the step's
    // clock leaves out. tracked: the voice reports each sentence it starts.
    run = { step, timing, sentenceMs, owners, startedAt: now(), elapsedBefore: 0, offset: 0, speechDone: !step.say, silent: false, silentUntil: null, token: {}, sentences, exactSentence: false, tracked: false, poll: null, synced: Boolean(owners), written: 0, lastTime: 0, finishAt: null }
    const token = run.token
    if (step.say) {
      const spoken = speech?.speak(spokenText(step.say), {
        rate,
        sentences,
        // Voices report each sentence as it starts (a system voice from its
        // events, a cloud voice from where its audio is); a voice that does
        // not, or that fails, is followed by elapsed time (see sentenceAt).
        onSentence: index => {
          if (!run || run.token !== token) return
          run.exactSentence = true
          if (state.sentence !== index) {
            state.sentence = index
            emit()
          }
        },
      }) ?? { done: Promise.resolve({ silent: true }) }
      run.tracked = Boolean(spoken.tracked)
      run.poll = typeof spoken.poll === 'function' ? spoken.poll : null
      spoken.done.then(result => {
        if (!run || run.token !== token) return
        if (result?.silent || result?.error) {
          run.silent = true
          run.tracked = false
          run.silentUntil = total(run.sentenceMs) * 0.8
        } else run.speechDone = true
        onNarration?.(result)
      })
      speech?.prefetch?.(spokenText(steps[state.index + 1]?.say ?? ''))
    }
    emit()
    loop()
  }

  // Which sentence is being spoken, estimated from the step's clock and how
  // long each sentence should take, when the voice does not report it.
  function sentenceAt(clock) {
    if (run.speechDone) return Math.max(0, run.sentences.length - 1)
    return sentenceAtFraction(run.sentenceMs, clock / Math.max(1, total(run.sentenceMs)))
  }

  function elapsed() {
    if (!run) return 0
    return run.elapsedBefore + (state.status === 'playing' ? now() - run.startedAt : 0)
  }

  function loop() {
    handle = requestFrame(tick)
  }

  // A synced step's writing clock only runs while the next op's sentence has
  // been reached, runs faster while the board is behind the voice, and never
  // goes back; otherwise writing simply follows the step's own clock.
  function writingTime(clock, sentence, writes) {
    if (!run.synced) return clock
    const delta = Math.max(0, clock - run.lastTime)
    run.lastTime = clock
    const reached = run.speechDone ? Infinity : sentence
    let allowed = 0
    let cap = 0
    while (allowed < writes.length && run.owners[allowed] <= reached) {
      cap += writes[allowed]
      allowed += 1
    }
    // The op being written now.
    let current = 0
    let end = writes[0] ?? 0
    while (current < writes.length - 1 && run.written >= end) {
      current += 1
      end += writes[current]
    }
    const behind = run.written < cap && ((run.speechDone && !run.silent) || run.owners[allowed - 1] > run.owners[current])
    run.written = Math.max(run.written, Math.min(run.written + delta * (behind ? CATCH_UP : 1), cap))
    return run.written
  }

  function tick() {
    handle = null
    if (state.status !== 'playing' || !run) return
    // A voice that is asked where it is reports a sentence it has reached.
    run.poll?.()
    const time = elapsed()
    // Until a voice that reports its sentences starts, the step's clock
    // waits for it, and the board never guesses ahead of such a voice.
    if (run.tracked && !run.exactSentence && !run.speechDone && time < VOICE_WAIT_MS) run.offset = time
    const clock = time - run.offset
    const writes = run.timing.writeMs
    if (run.silentUntil !== null && clock >= run.silentUntil) run.speechDone = true
    const sentence = run.exactSentence ? state.sentence : run.tracked ? 0 : sentenceAt(clock)
    const writeTime = writingTime(clock, sentence, writes)
    let acc = 0
    let op = writes.length
    let progress = 1
    for (let index = 0; index < writes.length; index += 1) {
      if (writeTime < acc + writes[index]) {
        op = index
        progress = writes[index] ? (writeTime - acc) / writes[index] : 1
        break
      }
      acc += writes[index]
    }
    const changed = op !== state.op || Math.abs(progress - state.progress) > 0.002 || sentence !== state.sentence
    state.op = op
    state.sentence = sentence
    state.progress = Math.min(1, Math.max(0, progress))
    const written = op >= writes.length
    if (written && run.speechDone) {
      // A short pause once both the board and the narration are done.
      run.finishAt ??= run.synced ? clock + STEP_GAP_MS : acc + STEP_GAP_MS
      if (clock >= run.finishAt) {
        finishStep()
        return
      }
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
      if (run && (state.status === 'playing' || state.status === 'paused')) {
        // Keep the current position, rescale what remains.
        const time = elapsed()
        const ratio = rate / nextRate
        run.elapsedBefore = time * ratio
        run.offset *= ratio
        run.startedAt = now()
        run.sentenceMs = run.sentences.map(sentence => estimateSpeechMs(sentence, nextRate))
        run.timing = stepTiming(run.step, { rate: nextRate, sentenceMs: run.sentenceMs })
        run.written *= ratio
        run.lastTime = run.elapsedBefore - run.offset
        run.finishAt = null
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
