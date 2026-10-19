import assert from 'node:assert/strict'
import { test } from 'node:test'

import { estimateSpeechMs } from '../src/core/board-script.js'
import { layoutBoard, reidSteps } from '../src/ui/board/layout.js'
import { createPlayer } from '../src/ui/board/player.js'
import { goalStates, transcriptEntries } from '../src/ui/board/sidepanel.js'

function harness() {
  let time = 0
  const frames = []
  const spoken = []
  const options = []
  const pending = []
  const speech = {
    speak(textValue, settings) {
      spoken.push(textValue)
      options.push(settings)
      let resolve
      const done = new Promise(r => { resolve = r })
      pending.push(resolve)
      return { done }
    },
    cancel() {},
    pause() {},
    resume() {},
    setRate() {},
    prefetch() {},
  }
  const snapshots = []
  const player = createPlayer({
    speech,
    now: () => time,
    frame: callback => { frames.push(callback); return frames.length },
    cancelFrame: () => undefined,
    onChange: snapshot => snapshots.push(snapshot),
  })
  const advance = async ms => {
    const target = time + ms
    while (time < target) {
      time = Math.min(target, time + 16)
      const batch = frames.splice(0)
      for (const callback of batch) callback()
      await Promise.resolve()
    }
  }
  const finishSpeech = async () => {
    for (const resolve of pending.splice(0)) resolve({ completed: true })
    await Promise.resolve()
    await Promise.resolve()
  }
  return { player, advance, finishSpeech, spoken, options, snapshots }
}

const steps = [
  { id: 's1', say: '第一步', ops: [{ id: 'o1', t: 'h', text: '标题' }, { id: 'o2', t: 'p', text: '一段说明文字' }] },
  { id: 's2', say: '第二步', ops: [{ id: 'o3', t: 'p', text: 'x' }], check: { id: 'k2', kind: 'choice', prompt: '?', options: [], answer: 'a' } },
  { id: 's3', say: '第三步', ops: [] },
]

test('player writes ops in order, waits for narration and pauses on checks', async () => {
  const { player, advance, finishSpeech, spoken } = harness()
  player.setSteps(steps.slice(0, 2))
  player.play()
  assert.equal(player.state.status, 'playing')
  assert.deepEqual(spoken, ['第一步'])
  await advance(200)
  assert.equal(player.state.op, 0)
  assert.ok(player.state.progress > 0 && player.state.progress < 1)
  await advance(10_000)
  assert.equal(player.state.index, 0, 'waits for the narration to end')
  assert.equal(player.state.op, 2)
  await finishSpeech()
  await advance(600)
  assert.equal(player.state.index, 1)
  await finishSpeech()
  await advance(10_000)
  assert.equal(player.state.status, 'check')
  player.answer('k2')
  assert.equal(player.state.status, 'buffering', 'no third step yet')
  player.setSteps(steps, { done: true })
  assert.equal(player.state.status, 'playing')
  assert.equal(player.state.index, 2)
  await finishSpeech()
  await advance(1000)
  assert.equal(player.state.status, 'ended')
})

test('pause freezes progress; next, prev, seek and inserted steps move the cursor', async () => {
  const { player, advance, finishSpeech } = harness()
  player.setSteps(steps, { done: true })
  player.play()
  await advance(300)
  player.pause()
  const frozen = player.state.progress
  await advance(2000)
  assert.equal(player.state.progress, frozen)
  player.play()
  await advance(100)
  assert.ok(player.state.progress > frozen || player.state.op > 0)
  player.next()
  assert.equal(player.state.index, 1)
  player.prev()
  assert.equal(player.state.index, 0, 'at the start of a step, prev goes back one')
  await advance(400)
  player.prev()
  assert.equal(player.state.index, 0, 'mid-step, prev replays the step')
  const inserted = player.insertAfterCurrent(reidSteps([{ id: 's1', say: '插入', ops: [{ id: 'o1', t: 'p', text: 'aside' }, { id: 'o2', t: 'mark', ref: 'o1' }] }], 'q1_'))
  assert.equal(inserted[1].ops[0].id, 'q1_o1')
  assert.equal(inserted[1].ops[1].ref, 'q1_o1')
  assert.equal(inserted[1].aside, true)
  player.seek(1)
  assert.equal(player.state.step.say, '插入')
  player.setRate(1.5)
  assert.equal(player.state.rate, 1.5)
  await finishSpeech()
  player.dispose()
})

test('layout honors columns and pages and breaks long content automatically', () => {
  const long = Array.from({ length: 60 }, (_, index) => ({ id: `p${index}`, t: 'p', text: '一行比较长的手写说明文字，需要占用一些空间。' }))
  const { pages, where } = layoutBoard([
    { ops: [{ id: 't', t: 'title', text: '第一页' }, { id: 'a', t: 'h', text: 'A' }, { id: 'c', t: 'col' }, { id: 'b', t: 'p', text: 'B' }] },
    { ops: [{ id: 'n', t: 'page', title: '第二页' }, ...long] },
  ])
  assert.equal(pages[0].title, '第一页')
  assert.equal(where.get('a').column, 0)
  assert.equal(where.get('b').column, 1)
  assert.equal(pages[1].title, '第二页')
  assert.ok(pages.length >= 3, 'long content spilled onto more pages')
  assert.ok(pages.every(page => page.columns.every(column => column.length <= 30)))
})

test('a script column break right after an overflow break does not turn the page', () => {
  const tall = Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, t: 'svg', svg: '<svg></svg>' }))
  const { pages, where } = layoutBoard([{ ops: [...tall, { id: 'c', t: 'col' }, { id: 'after', t: 'p', text: 'x' }] }])
  assert.equal(where.get('f3').column, 1, 'overflow moved writing right')
  assert.equal(pages.length, 1, 'the script col did not open a new page')
  assert.equal(where.get('after').column, 1)
})

test('captions follow the spoken sentence and formulas are spoken as text', async () => {
  const say = '先看 $a^2+b^2=c^2$。再看图形！最后总结。'
  const exact = harness()
  exact.player.setSteps([{ id: 's1', say, ops: [] }], { done: true })
  exact.player.play()
  assert.equal(exact.spoken[0], '先看 a²+b²=c²。再看图形！最后总结。')
  assert.deepEqual(exact.options[0].sentences, ['先看 a²+b²=c²。', '再看图形！', '最后总结。'])
  assert.equal(exact.player.state.sentence, 0)
  exact.options[0].onSentence(1, 3)
  assert.equal(exact.player.state.sentence, 1, 'a system voice reports the sentence it starts')
  await exact.advance(estimateSpeechMs(say, 1) * 0.95)
  assert.equal(exact.player.state.sentence, 1, 'reported positions are not overridden by the estimate')

  // Engines that do not report sentences (cloud voices, muted) are followed by time.
  const timed = harness()
  timed.player.setSteps([{ id: 's1', say, ops: [] }], { done: true })
  timed.player.play()
  const seen = new Set()
  for (let elapsed = 0; elapsed < estimateSpeechMs(say, 1) * 0.98; elapsed += 200) {
    await timed.advance(200)
    seen.add(timed.player.state.sentence)
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2])
  await timed.finishSpeech()
})

test('in a synced step each op waits for its sentence, and the board highlights it', async () => {
  const say = '第一句讲公式。第二句讲负号。'
  const steps = [{ id: 's1', say, ops: [{ id: 'o1', t: 'math', tex: 'F=-kx', at: 0 }, { id: 'o2', t: 'p', text: '负号表示方向相反', at: 1 }, { id: 'o3', t: 'mark', ref: 'o2', style: 'underline', at: 1 }] }]
  const { player, advance, options } = harness()
  player.setSteps(steps, { done: true })
  player.play()
  options[0].onSentence(0, 2)
  await advance(5000)
  assert.equal(player.state.op, 1, 'the second op waits for the second sentence')
  assert.equal(player.state.progress, 0)
  assert.deepEqual(player.state.now, ['o1'])
  options[0].onSentence(1, 2)
  await advance(300)
  assert.equal(player.state.op, 1)
  assert.ok(player.state.progress > 0, 'and starts once it is spoken')
  await advance(5000)
  assert.deepEqual(player.state.now, ['o2', 'o2'], 'a mark highlights the op it points at')

  // Unsynced steps keep the old pacing: writing does not wait for sentences.
  const plain = harness()
  plain.player.setSteps([{ id: 's1', say, ops: [{ id: 'o1', t: 'p', text: '一' }, { id: 'o2', t: 'p', text: '二' }] }], { done: true })
  plain.player.play()
  await plain.advance(1500)
  assert.equal(plain.player.state.op, 2, 'both ops are written without waiting for the second sentence')
  assert.deepEqual(plain.player.state.now, [])
})

test('the side panel tracks goals and lists what was said, with questions', () => {
  const main = [{ id: 's1', say: '开场' }, { id: 's2', say: '讲 A', goal: 0 }, { id: 's3', say: '再讲 A', goal: 0 }, { id: 's4', say: '讲 B', goal: 1 }, { id: 's5', say: '总结' }]
  assert.deepEqual(goalStates(main, 0, 3), ['todo', 'todo', 'todo'])
  assert.deepEqual(goalStates(main, 2, 3), ['current', 'todo', 'todo'])
  assert.deepEqual(goalStates(main, 4, 3), ['done', 'done', 'todo'])
  assert.deepEqual(goalStates(main, 4, 3, true), ['done', 'done', 'done'])
  assert.equal(goalStates([{ id: 's1', say: '旧课' }], 0, 2), null, 'older boards list goals without state')
  assert.deepEqual(goalStates(main, 0, 0), [])

  const asides = [{ id: 'a1', kind: 'question', label: '为什么？', streaming: false, steps: [{ id: 'a1_s1' }] }, { id: 'a2', kind: 'question', label: '还有呢？', streaming: true, steps: [] }]
  const merged = [main[0], main[1], { id: 'a1_s1', say: '因为……', aside: true }, main[2], main[3]]
  const entries = transcriptEntries(merged, 3, asides)
  assert.deepEqual(entries.map(entry => [entry.kind, entry.text, entry.stepIndex]), [
    ['say', '开场', 0], ['say', '讲 A', 1], ['question', '为什么？', 2], ['say', '因为……', 2], ['say', '再讲 A', 3], ['question', '还有呢？', -1],
  ])
  assert.equal(entries.at(-1).pending, true)
})
