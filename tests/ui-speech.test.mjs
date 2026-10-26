import assert from 'node:assert/strict'
import { test } from 'node:test'

import { estimateSpeechMs } from '../src/core/board-script.js'
import { afterNarration, createSpeech } from '../src/ui/speech.js'

// Chromium's speechSynthesis as DSH's Electron showed it on macOS: an
// utterance starts on a later task and ends after its length; cancel()
// interrupts the one speaking and cancels the waiting ones; and an utterance
// spoken in the same task as a cancel() that removed one not yet started is
// dropped without any event, leaving the queue "speaking" until the next
// cancel(). stuck: start that way; broken: never start anything; loseEnd:
// sentences whose end event never comes.
function fakeChromium({ stuck = false, broken = false, loseEnd = () => false, lengthMs = 100 } = {}) {
  const heard = []
  let waiting = []
  let speaking = null
  let dropping = false
  const startNext = () => {
    if (stuck || broken || speaking || !waiting.length) return
    const utterance = waiting.shift()
    speaking = utterance
    heard.push(utterance.text)
    utterance.onstart?.()
    setTimeout(() => {
      if (speaking !== utterance) return
      speaking = null
      if (!loseEnd(utterance.text)) utterance.onend?.()
      startNext()
    }, lengthMs)
  }
  const synth = {
    heard,
    get speaking() { return stuck || Boolean(speaking) || waiting.length > 0 },
    getVoices: () => [],
    speak(utterance) {
      if (dropping) {
        stuck = true
        return
      }
      waiting.push(utterance)
      setTimeout(startNext, 0)
    },
    cancel() {
      const interrupted = speaking
      const cancelled = waiting
      if (cancelled.length) {
        dropping = true
        setTimeout(() => { dropping = false }, 0)
      }
      speaking = null
      waiting = []
      stuck = false
      setTimeout(() => {
        interrupted?.onerror?.({ error: 'interrupted' })
        for (const utterance of cancelled) utterance.onerror?.({ error: 'canceled' })
      }, 0)
    },
  }
  return synth
}

class FakeUtterance {
  constructor(text) {
    this.text = text
  }
}

// A browser speech engine on the fake, with time under the test's control.
function setup(t, options) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const synth = fakeChromium(options)
  globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance }
  t.after(() => { delete globalThis.window })
  const speech = createSpeech({ fetchAudio: async () => ({}) })
  speech.configure({ engine: 'browser', language: 'zh-CN' })
  const run = async ms => {
    for (let passed = 0; passed < ms; passed += 5) {
      t.mock.timers.tick(5)
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  const outcome = spoken => {
    const seen = { result: undefined }
    spoken.done.then(result => { seen.result = result })
    return seen
  }
  return { synth, speech, run, outcome }
}

const NARRATION = '我们来看看你这一步哪里写错了。移项的时候要变号。'
const SENTENCES = ['我们来看看你这一步哪里写错了。', '移项的时候要变号。']

test('a step started twice in one go is still spoken, though Chromium drops what follows a cancel', async t => {
  // What the classroom did when a correction's first step arrived: the player
  // started the step, then started it again from the jump to the answer.
  const { synth, speech, run, outcome } = setup(t)
  const first = outcome(speech.speak(NARRATION))
  speech.cancel()
  const second = outcome(speech.speak(NARRATION))
  await run(1000)
  assert.deepEqual(first.result, { completed: false })
  assert.deepEqual(second.result, { completed: true }, 'the narration ends, so the lesson goes on')
  assert.deepEqual(synth.heard, SENTENCES)
  assert.equal(synth.speaking, false)
})

test('a voice held by an earlier drop is cleared and the sentence spoken again', async t => {
  const { synth, speech, run, outcome } = setup(t, { stuck: true })
  const spoken = outcome(speech.speak(NARRATION))
  await run(3900)
  assert.equal(spoken.result, undefined, 'waits a little for the voice to start')
  await run(1000)
  assert.deepEqual(spoken.result, { completed: true })
  assert.deepEqual(synth.heard, SENTENCES)
})

test('a voice that never starts is given up for the narration, as a failure that may pass', async t => {
  const { synth, speech, run, outcome } = setup(t, { broken: true })
  const spoken = outcome(speech.speak(NARRATION))
  await run(8100)
  assert.equal(spoken.result?.completed, false)
  assert.equal(spoken.result?.code, 'speech-stalled')
  assert.deepEqual(synth.heard, [])
  // The lesson goes on silently; only a second stalled narration in a row
  // turns the voice off with a note.
  const once = afterNarration(0, spoken.result)
  assert.deepEqual(once, { failures: 1, stop: null })
  assert.equal(afterNarration(once.failures, spoken.result).stop.code, 'speech-stalled')
})

test('an end event that never comes does not hold the narration', async t => {
  const { synth, speech, run, outcome } = setup(t, { loseEnd: text => text === SENTENCES[0] })
  const spoken = outcome(speech.speak(NARRATION))
  // Twice the sentence's estimate and four seconds more.
  const allowance = estimateSpeechMs(SENTENCES[0]) * 2 + 4000
  await run(allowance - 500)
  assert.equal(spoken.result, undefined, 'a sentence may run well past its estimate')
  await run(1000)
  assert.deepEqual(spoken.result, { completed: true })
  assert.deepEqual(synth.heard, SENTENCES)
})

test('an interruption from elsewhere on the page skips the sentence instead of stalling', async t => {
  const { synth, speech, run, outcome } = setup(t)
  const spoken = outcome(speech.speak(NARRATION))
  await run(50)
  globalThis.window.speechSynthesis.cancel()
  await run(500)
  assert.deepEqual(spoken.result, { completed: true })
  assert.deepEqual(synth.heard, SENTENCES)
})

test('pausing and resuming speaks the sentence again, and the old one\'s events are ignored', async t => {
  const { synth, speech, run, outcome } = setup(t)
  const spoken = outcome(speech.speak(NARRATION))
  await run(50)
  speech.pause()
  await run(1000)
  assert.equal(spoken.result, undefined, 'the interrupted sentence does not count as spoken')
  assert.deepEqual(synth.heard, [SENTENCES[0]])
  speech.resume()
  await run(1000)
  assert.deepEqual(spoken.result, { completed: true })
  assert.deepEqual(synth.heard, [SENTENCES[0], ...SENTENCES])
})
