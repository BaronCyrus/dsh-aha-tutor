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

test('a system voice says it reports sentences when asked to', async t => {
  const { speech, run } = setup(t)
  assert.equal(speech.speak(NARRATION, { sentences: SENTENCES, onSentence() {} }).tracked, true)
  assert.equal(speech.speak(NARRATION).tracked, false)
  speech.cancel()
  await run(50)
})

// <audio> elements: each starts playing a moment after play(); the test ends
// them.
class FakeAudio {
  constructor() {
    this.paused = true
    this.plays = 0
    FakeAudio.all.push(this)
  }

  play() {
    this.paused = false
    this.plays += 1
    queueMicrotask(() => { if (!this.paused) this.onplaying?.() })
    return Promise.resolve()
  }

  pause() {
    this.paused = true
  }
}

// A cloud voice on fake audio, whose host answers each sentence when the
// test says so: answer(text) or fail(text, code).
function cloudSetup(t) {
  FakeAudio.all = []
  globalThis.Audio = FakeAudio
  t.after(() => { delete globalThis.Audio })
  const asked = []
  const pending = new Map()
  const speech = createSpeech({
    fetchAudio: textValue => {
      asked.push(textValue)
      return new Promise((resolve, reject) => pending.set(textValue, { resolve, reject }))
    },
  })
  speech.configure({ engine: 'cloud' })
  const flush = async () => {
    for (let round = 0; round < 5; round += 1) await new Promise(resolve => setImmediate(resolve))
  }
  const answer = async textValue => {
    pending.get(textValue).resolve({ blob: new Blob([textValue], { type: 'audio/mpeg' }) })
    await flush()
  }
  const fail = async (textValue, code) => {
    pending.get(textValue).reject(Object.assign(new Error('failed'), { code }))
    await flush()
  }
  return { speech, asked, answer, fail, flush, playing: () => FakeAudio.all.at(-1) }
}

test('a cloud voice says each sentence as its own audio and reports it as its audio starts', async t => {
  const { speech, asked, answer, flush, playing } = cloudSetup(t)
  const sentences = ['先看这个公式。', '它说明力与位移的方向相反。', '记住负号。', '下面算一道题。']
  const heard = []
  const spoken = speech.speak(sentences.join(''), { sentences, onSentence: (index, total) => heard.push([index, total]) })
  assert.equal(spoken.tracked, true)
  await flush()
  assert.deepEqual(asked, [sentences[0]], 'one request at a time, the first sentence first')
  assert.deepEqual(heard, [], 'nothing is reported while its audio is being fetched')
  await answer(sentences[0])
  assert.deepEqual(heard, [[0, 4]], 'the first sentence once its audio is heard')
  assert.deepEqual(asked, sentences.slice(0, 2), 'the next sentence is asked for once the one before it came')
  await answer(sentences[1])
  await answer(sentences[2])
  assert.deepEqual(asked, sentences.slice(0, 3), 'two sentences ahead of the one being said, no more')
  const first = playing()
  first.onended()
  await flush()
  assert.deepEqual(heard.at(-1), [1, 4], 'the next sentence as soon as its audio starts')
  assert.deepEqual(asked, sentences, 'and one more is asked for')
  assert.notEqual(playing(), first)

  // Paused and resumed, the sentence goes on where it was.
  speech.pause()
  assert.equal(playing().paused, true)
  speech.resume()
  assert.equal(playing().paused, false)
  assert.equal(playing().plays, 2)

  // Ended before the next audio came: the voice waits for it, and a pause in
  // that wait holds it once it comes.
  playing().onended()
  await flush()
  playing().onended()
  await flush()
  assert.deepEqual(heard.map(([index]) => index), [0, 1, 2])
  speech.pause()
  await answer(sentences[3])
  assert.equal(playing().paused, true, 'audio that comes during a pause waits for the resume')
  assert.deepEqual(heard.map(([index]) => index), [0, 1, 2])
  speech.resume()
  await flush()
  assert.deepEqual(heard.map(([index]) => index), [0, 1, 2, 3])
  playing().onended()
  assert.deepEqual(await spoken.done, { completed: true })
  assert.equal(heard.length, 4, 'each sentence once')
  assert.equal(speech.speak('你好').tracked, false, 'without sentences to follow')
  await flush()
  assert.equal(asked.at(-1), '你好', 'which is said as one piece')
  speech.cancel()
})

test('a cloud sentence with nothing to say is shown for its time without a request', async t => {
  const { speech, asked, answer, flush, playing } = cloudSetup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sentences = ['看这里。', '……', '就是这样。']
  const heard = []
  const spoken = speech.speak(sentences.join(''), { sentences, onSentence: index => heard.push(index) })
  await flush()
  await answer(sentences[0])
  assert.deepEqual(asked, [sentences[0], sentences[2]])
  playing().onended()
  await flush()
  assert.deepEqual(heard, [0, 1])
  t.mock.timers.tick(estimateSpeechMs('……') + 300)
  await answer(sentences[2])
  assert.deepEqual(heard, [0, 1, 2])
  playing().onended()
  assert.deepEqual(await spoken.done, { completed: true })
})

test('a later cloud sentence whose audio failed for a reason that may pass is asked for once more', async t => {
  const { speech, asked, answer, fail, flush, playing } = cloudSetup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sentences = ['第一句。', '第二句。', '第三句。']
  const heard = []
  const spoken = speech.speak(sentences.join(''), { sentences, onSentence: index => heard.push(index) })
  await flush()
  await answer(sentences[0])
  await fail(sentences[1], 'aha-tutor/tts-rate-limit')
  await answer(sentences[2])
  playing().onended()
  await flush()
  assert.deepEqual(heard, [0], 'the next sentence is not reported while its audio is missing')
  t.mock.timers.tick(1500)
  await flush()
  assert.deepEqual(asked, [sentences[0], sentences[1], sentences[2], sentences[1]], 'asked for again after a moment')
  await answer(sentences[1])
  assert.deepEqual(heard, [0, 1])
  playing().onended()
  await flush()
  playing().onended()
  assert.deepEqual(await spoken.done, { completed: true })

  // Failing again, or failing for a lasting reason, ends the narration with
  // its code; so does the first sentence failing.
  const again = speech.speak(sentences.join('').replace(/句/gu, '段'), { sentences: sentences.map(text => text.replace('句', '段')), onSentence() {} })
  await flush()
  await answer('第一段。')
  await fail('第二段。', 'aha-tutor/tts-server')
  playing().onended()
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  await fail('第二段。', 'aha-tutor/tts-server')
  assert.deepEqual(await again.done, { completed: false, error: 'failed', code: 'aha-tutor/tts-server' })
  const lasting = speech.speak('甲。乙。', { sentences: ['甲。', '乙。'], onSentence() {} })
  await flush()
  await answer('甲。')
  await fail('乙。', 'aha-tutor/tts-auth')
  playing().onended()
  assert.deepEqual(await lasting.done, { completed: false, error: 'failed', code: 'aha-tutor/tts-auth' })
  const firstFailed = speech.speak('丙。丁。', { sentences: ['丙。', '丁。'], onSentence() {} })
  await flush()
  await fail('丙。', 'aha-tutor/tts-rate-limit')
  assert.deepEqual(await firstFailed.done, { completed: false, error: 'failed', code: 'aha-tutor/tts-rate-limit' })
})

test('a cloud voice fetches the first sentence of the narration to come', async t => {
  const { speech, asked, flush } = cloudSetup(t)
  speech.prefetch('……下一步。再说。', { sentences: ['……', '下一步。', '再说。'] })
  await flush()
  assert.deepEqual(asked, ['下一步。'])
})
