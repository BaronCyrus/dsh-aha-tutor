import assert from 'node:assert/strict'
import { test } from 'node:test'

import katex from 'katex'
import { DOMParser } from 'linkedom'

import { estimateSpeechMs } from '../src/core/board-script.js'
import { FIT_FLOOR, fitFormula, fitPlan, groupLines, writtenPart } from '../src/ui/board/fit.js'
import { estimateHeight, layoutBoard, reidSteps } from '../src/ui/board/layout.js'
import { createPlayer } from '../src/ui/board/player.js'
import { goalStates, transcriptEntries } from '../src/ui/board/sidepanel.js'
import { STYLE } from '../src/ui/styles.js'

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

test('a long formula shrinks a little, then breaks into lines, and takes the room of its lines', () => {
  // At a 294 px column (a 1440 px window), the sizes the board measured.
  assert.deepEqual(fitPlan({ room: 294, natural: 260 }), { mode: 'fit', scale: 1 })
  assert.deepEqual(fitPlan({ room: 294, natural: 294 }), { mode: 'fit', scale: 1 })
  const equation = fitPlan({ room: 294, natural: 412, widest: 170 })
  assert.equal(equation.mode, 'shrink', 'the overall equation of photosynthesis stays on one line')
  assert.ok(equation.scale >= FIT_FLOOR && equation.scale < 0.72)
  assert.deepEqual(fitPlan({ room: 294, natural: 684, widest: 160 }), { mode: 'wrap', scale: 1 }, 'past 70 % it breaks into lines at full size')
  const unbreakable = fitPlan({ room: 294, natural: 706, widest: 377 })
  assert.equal(unbreakable.mode, 'wrap')
  assert.equal(unbreakable.scale, 294 / 377, 'a piece too wide to break shrinks until it fits')
  assert.deepEqual(fitPlan({ room: 294, natural: 615, widest: 590 }), { mode: 'shrink', scale: 294 / 615 }, 'a wide matrix keeps its "A =" on its line')
  assert.deepEqual(fitPlan({ room: 294, natural: 552, widest: 552 }), { mode: 'shrink', scale: 294 / 552 }, 'one piece that cannot break')
  assert.deepEqual(fitPlan({ room: 0, natural: 500 }), { mode: 'fit', scale: 1 }, 'nothing is fitted before the column has a width')

  // fitFormula starts from the formula's own size every time, so fitting
  // again (a resized window, fonts arriving) lands in the same place, and it
  // takes off the pixels that do not scale with the font (KaTeX rounds some
  // sizes). The stand-in lays a formula out as the browser would.
  const formula = ({ room, natural, pieces }) => {
    const scale = element => (element.style.fontSize ? Number.parseFloat(element.style.fontSize) / 20 : 1)
    const element = {
      clientWidth: room,
      style: { fontSize: '' },
      dataset: {},
      removeAttribute(name) { if (name === 'data-fit') delete this.dataset.fit },
      get scrollWidth() { return this.dataset.fit === 'wrap' ? Math.ceil(Math.max(room, Math.max(...pieces) * scale(this))) : Math.ceil(natural * scale(this)) + 4 },
      querySelectorAll: () => pieces.map(width => ({ getBoundingClientRect: () => ({ width: width * scale(element) }) })),
    }
    return element
  }
  const computed = globalThis.getComputedStyle
  globalThis.getComputedStyle = () => ({ fontSize: '20px' })
  try {
    const shrunk = formula({ room: 294, natural: 412, pieces: [86, 170, 112, 44] })
    assert.equal(fitFormula(shrunk), 'shrink')
    assert.ok(shrunk.scrollWidth <= shrunk.clientWidth, `no pixel over, so no scroll bar (${shrunk.scrollWidth})`)
    const size = shrunk.style.fontSize
    fitFormula(shrunk)
    assert.equal(shrunk.style.fontSize, size)
    const wrapped = formula({ room: 294, natural: 706, pieces: [70, 377, 259] })
    assert.equal(fitFormula(wrapped), 'wrap')
    assert.equal(wrapped.dataset.fit, 'wrap')
    assert.ok(Math.abs(Number.parseFloat(wrapped.style.fontSize) - (20 * 294) / 377) < 0.1, wrapped.style.fontSize)
    assert.ok(wrapped.scrollWidth <= wrapped.clientWidth)
    const short = formula({ room: 294, natural: 120, pieces: [120] })
    short.dataset.fit = 'wrap'
    short.style.fontSize = '9px'
    assert.equal(fitFormula(short), 'fit', 'a column that grew lets the formula back to its size')
    assert.deepEqual([short.dataset.fit, short.style.fontSize], [undefined, ''])
  } finally {
    globalThis.getComputedStyle = computed
  }

  // The pieces fit.js measures: KaTeX splits display math after its top-level
  // operators and keeps an equation number apart, and the board's styles let
  // those pieces wrap and put the number after them.
  const html = katex.renderToString('6CO_2 + 6H_2O \\xrightarrow{光、叶绿体} C_6H_{12}O_6 + 6O_2 \\tag{1}', { displayMode: true, throwOnError: false, strict: 'ignore', trust: false, output: 'html' })
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  assert.equal(document.querySelectorAll('.katex-html > .katex-base').length, 4)
  assert.equal(document.querySelectorAll('.katex-html > .katex-tag').length, 1)
  assert.ok(STYLE.includes('.aha-op-math[data-fit=wrap] .katex-display>.katex{white-space:normal}'))
  assert.ok(STYLE.includes('.aha-op-math .katex-display>.katex>.katex-html>.katex-tag{position:static;'))

  // A formula that will break into lines takes more of its column, so a page
  // of them spills into the next column instead of running off the board.
  const expansion = '(a+b)^{10} = a^{10} + 10a^9b + 45a^8b^2 + 120a^7b^3 + 210a^6b^4 + 252a^5b^5 + 210a^4b^6 + 120a^3b^7 + 45a^2b^8 + 10ab^9 + b^{10}'
  assert.equal(estimateHeight({ t: 'math', tex: 'F=-kx' }), 2)
  assert.ok(Math.abs(estimateHeight({ t: 'math', tex: expansion }) - 5.6) < 1e-9, 'four lines')
  const { where } = layoutBoard([{ ops: Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, t: 'math', tex: expansion })) }])
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => where.get(`m${index}`).column), [0, 0, 0, 0, 1, 1])
})

test('a formula is written line by line, with the pencil where the writing is', () => {
  // Pieces flow left to right; one that starts back at the left opens a line.
  const lines = groupLines([
    { left: 20, right: 110, top: 10, bottom: 40 },
    { left: 110, right: 270, top: 0, bottom: 44 },
    { left: 0, right: 0, top: 0, bottom: 0 },
    { left: 60, right: 180, top: 50, bottom: 80 },
    { left: 180, right: 230, top: 52, bottom: 80 },
  ])
  assert.deepEqual(lines, [{ left: 20, right: 270, top: 0, bottom: 44 }, { left: 60, right: 230, top: 50, bottom: 80 }])

  // 250 + 170 px to write. Halfway is 210 px into the first line, whose band
  // runs from the top to midway between the lines.
  assert.deepEqual(writtenPart(lines, 0.5), { clip: 'polygon(0 0, 100% 0, 100% 0, 230px 0, 230px 47px, 0 47px)', pen: { x: 230, y: 44 } })
  // At 90 % the first line is done and the second is 128 px along.
  assert.deepEqual(writtenPart(lines, 0.9), { clip: 'polygon(0 0, 100% 0, 100% 47px, 188px 47px, 188px 100%, 0 100%)', pen: { x: 188, y: 80 } })
  assert.deepEqual(writtenPart(lines, 1), { clip: '', pen: null })
  assert.deepEqual(writtenPart([], 0.25), { clip: 'inset(0 75% 0 0)', pen: null }, 'before it is laid out, a plain wipe')
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

  const corrected = transcriptEntries([main[0], { id: 'a3_s1', say: '这里错了', aside: true }], 1, [{ id: 'a3', kind: 'correction', label: '订正：漏了负根', streaming: false, steps: [{ id: 'a3_s1' }] }])
  assert.deepEqual(corrected.map(entry => [entry.kind, entry.text]), [['say', '开场'], ['correction', '订正：漏了负根'], ['say', '这里错了']])
})
