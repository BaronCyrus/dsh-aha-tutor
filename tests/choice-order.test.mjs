import assert from 'node:assert/strict'
import { test } from 'node:test'

import { orderBoardOptions, orderOptions } from '../src/core/choice-order.js'
import { normalizeItem } from '../src/core/course-model.js'
import { gradeObjective } from '../src/core/grading.js'

const choice = (prompt, options, answer = 0, extra = {}) => normalizeItem({ kind: 'choice', prompt, options, answer, ...extra })

test('the right option no longer sits at A, and stays right', () => {
  const positions = [0, 0, 0, 0]
  for (let index = 0; index < 200; index += 1) {
    const item = choice(`第 ${index} 题：下面哪一项是对的？`, [`对的说法 ${index}`, `错的说法甲 ${index}`, `错的说法乙 ${index}`, `错的说法丙 ${index}`])
    const shown = orderOptions(item)
    const right = shown.options.find(option => option.id === shown.answer)
    assert.equal(right.text, `对的说法 ${index}`)
    assert.deepEqual(shown.options.map(option => option.id), ['a', 'b', 'c', 'd'])
    assert.equal(gradeObjective(shown, shown.answer).correct, true)
    positions[shown.options.indexOf(right)] += 1
  }
  assert.ok(positions.every(count => count >= 30), `answers spread over A–D: ${positions.join(', ')}`)
})

test('the order depends on the question only, so it is the same every time', () => {
  const item = choice('哪种运动的投影是简谐运动？', ['匀速圆周运动', '匀加速直线运动', '平抛运动', '自由落体运动'])
  const once = orderOptions(item)
  assert.deepEqual(orderOptions(structuredClone(item)), once, 'the same question normalized again (a streamed board) gets the same order')
  assert.deepEqual(orderOptions(once).options.map(option => option.text), once.options.map(option => option.text), 'ordering an ordered question changes nothing')
})

test('several right options follow their options', () => {
  const item = normalizeItem({ kind: 'multi', prompt: '哪些量影响弹簧振子的周期？（多选）', options: ['质量 m', '劲度系数 k', '振幅 A', '初相位 φ'], answer: [0, 1] })
  const shown = orderOptions(item)
  assert.deepEqual(shown.answer.map(id => shown.options.find(option => option.id === id).text).sort(), ['劲度系数 k', '质量 m'])
  assert.deepEqual(shown.answer, [...shown.answer].sort())
})

test('numbers run from small to large, and yes stays before no', () => {
  const sizes = orderOptions(choice('$x = 3\\cos(2t)$ 中振幅是多少？', ['3 cm', '2 cm', '6 cm', '1.5 cm']))
  assert.deepEqual(sizes.options.map(option => option.text), ['1.5 cm', '2 cm', '3 cm', '6 cm'])
  assert.equal(sizes.options.find(option => option.id === sizes.answer).text, '3 cm')
  const odds = orderOptions(choice('已知点数大于 3，是 5 的概率？', ['1/3', '1/6', '1/2', '2/3']))
  assert.deepEqual(odds.options.map(option => option.text), ['1/6', '1/3', '1/2', '2/3'])
  const guesses = orderOptions(choice('阳性后真正患病的概率？', ['约 99%', '约 50%', '约 9%', '约 1%'], 2))
  assert.deepEqual(guesses.options.map(option => option.text), ['约 1%', '约 9%', '约 50%', '约 99%'])
  assert.equal(guesses.options.find(option => option.id === guesses.answer).text, '约 9%')
  // Mixed units are not sorted by their numbers.
  assert.notDeepEqual(orderOptions(choice('哪个最长？', ['2 m', '30 cm', '1 km', '5 mm'])).options.map(option => option.text), ['1 km', '2 m', '5 mm', '30 cm'])
  const truth = choice('惯性只和质量有关。', ['错误', '正确'], 1)
  const shown = orderOptions(truth)
  assert.deepEqual(shown.options.map(option => option.text), ['正确', '错误'])
  assert.equal(shown.answer, 'a')
  const already = choice('能整除吗？', ['能', '不能'])
  assert.equal(orderOptions(already), already)
})

test('an option about the others keeps its place', () => {
  const item = choice('下列说法正确的是？', ['速度越大惯性越大', '质量越大惯性越大', '静止的物体没有惯性', '以上都不对'], 1)
  for (const variant of [item, { ...item, prompt: `${item.prompt}（第二问）` }, { ...item, prompt: `${item.prompt}（第三问）` }]) {
    const shown = orderOptions(variant)
    assert.equal(shown.options[3].text, '以上都不对')
    assert.equal(shown.options.find(option => option.id === shown.answer).text, '质量越大惯性越大')
  }
  const english = choice('Which is a vector?', ['Mass', 'Speed', 'Velocity', 'None of the above'], 2)
  assert.equal(orderOptions(english).options[3].text, 'None of the above')
})

test('a question that names options by letter is left as it is', () => {
  const both = choice('哪些说法正确？', ['甲', '乙', 'A 和 B 都对', '都不对'])
  assert.equal(orderOptions(both), both)
  const listed = choice('下列哪个正确？A. 甲 B. 乙', ['甲说法', '乙说法'])
  assert.equal(orderOptions(listed), listed, 'a stem that lists other lettered text keeps the order it names')
})

test('letters that name options in the explanation follow them, other letters stay', () => {
  const item = choice('下列哪个是矢量？', ['质量', '速度', '路程', '时间'], 1, {
    explanation: '选 B：速度有方向。A 选项质量只有大小；答案是 B，而 C、D 都是标量。点 A 到点 B 的距离是路程。',
    hints: ['先排除选项 A 和 D'],
  })
  const shown = orderOptions(item)
  const letterOf = textValue => shown.options.find(option => option.text === textValue).id.toUpperCase()
  assert.ok(shown.explanation.startsWith(`选 ${letterOf('速度')}：`), shown.explanation)
  assert.ok(shown.explanation.includes(`${letterOf('质量')} 选项质量`), shown.explanation)
  assert.ok(shown.explanation.includes(`答案是 ${letterOf('速度')}`), shown.explanation)
  assert.ok(shown.explanation.endsWith('点 A 到点 B 的距离是路程。'), 'points named by letters are not options')
  assert.equal(shown.hints[0], `先排除选项 ${letterOf('质量')} 和 ${letterOf('时间')}`)
  const english = orderOptions(choice('Which is a vector?', ['Mass', 'Velocity', 'Distance', 'Time'], 1, { explanation: 'The answer is B. Option A has no direction; a force F has one.' }))
  const letter = textValue => english.options.find(option => option.text === textValue).id.toUpperCase()
  assert.equal(english.explanation, `The answer is ${letter('Velocity')}. Option ${letter('Mass')} has no direction; a force F has one.`)
})

test('an order question never starts solved', () => {
  for (let index = 0; index < 50; index += 1) {
    const item = normalizeItem({ kind: 'order', prompt: `排列步骤 ${index}`, options: ['第一步', '第二步', '第三步'], answer: [0, 1, 2] })
    const shown = orderOptions(item)
    assert.notDeepEqual(shown.options.map(option => option.id), shown.answer, `question ${index}`)
    assert.deepEqual(shown.answer.map(id => shown.options.find(option => option.id === id).text), ['第一步', '第二步', '第三步'])
  }
  const two = normalizeItem({ kind: 'order', prompt: '先后', options: ['先', '后'], answer: [0, 1] })
  assert.deepEqual(orderOptions(two).options.map(option => option.text), ['后', '先'])
})

test('other kinds and board steps without checks are untouched', () => {
  const blank = normalizeItem({ kind: 'blank', prompt: '$F=$ ____', answer: ['-kx'] })
  assert.equal(orderOptions(blank), blank)
  const board = { title: 't', steps: [{ id: 's1', say: '你好', ops: [] }] }
  assert.equal(orderBoardOptions(board), board)
  const check = choice('哪种运动的投影是简谐运动？', ['匀速圆周运动', '匀加速直线运动', '平抛运动', '自由落体运动'])
  const ordered = orderBoardOptions({ title: 't', steps: [{ id: 's1', say: '问', ops: [], check: { ...check, id: 'k1' } }] })
  assert.deepEqual(ordered.steps[0].check, { ...orderOptions(check), id: 'k1' })
})

test('options the model lettered lose the letters, and a stem that repeats them is cut', () => {
  const item = normalizeItem({ kind: 'choice', prompt: '下列说法正确的是（ ）\nA. 速度越大惯性越大\nB. 质量越大惯性越大\nC. 静止的物体没有惯性', options: ['A. 速度越大惯性越大', 'B．质量越大惯性越大', '(C) 静止的物体没有惯性'], answer: 'B. 质量越大惯性越大' })
  assert.deepEqual(item.options.map(option => option.text), ['速度越大惯性越大', '质量越大惯性越大', '静止的物体没有惯性'])
  assert.equal(item.prompt, '下列说法正确的是（ ）')
  assert.equal(item.answer, 'b')
  // Options that only start with a letter keep it.
  const points = normalizeItem({ kind: 'choice', prompt: '哪一点最高？', options: ['A点', 'B点'], answer: 0 })
  assert.deepEqual(points.options.map(option => option.text), ['A点', 'B点'])
  // A stem that names other things by letter keeps them.
  const stem = normalizeItem({ kind: 'choice', prompt: '物体 A 和 B 哪个先落地？', options: ['A', 'B', '同时'], answer: 2 })
  assert.equal(stem.prompt, '物体 A 和 B 哪个先落地？')
  assert.equal(orderOptions(stem), stem, 'options that are letters themselves keep their order')
})
