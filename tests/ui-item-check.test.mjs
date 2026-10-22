import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement as h } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'tsdown'

import { en, format, zh } from '../src/ui/i18n.js'
import { answerText, checkDone, checkNotice, fixedLines, itemSource, regradeResults, shownGrade } from '../src/ui/item-check.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const root = fileURLToPath(new URL('..', import.meta.url))
const t = (key, values) => format(zh[key] ?? key, values)
const tEn = (key, values) => format(en[key] ?? key, values)

const PRIME = {
  id: 'i1',
  kind: 'choice',
  prompt: '下列哪个是质数？',
  explanation: '21 只有 1 和它本身两个因数。',
  hints: [],
  difficulty: 2,
  conceptIds: ['cpt_aaaaaaaa'],
  options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }],
  answer: 'a',
}
const FIXED = { ...PRIME, answer: 'b', explanation: '23 只有 1 和它本身两个因数；21 = 3 × 7。', fixed: { was: { answer: 'a', explanation: PRIME.explanation }, at: '2026-10-22T08:03:00.000Z' } }

test('a practice question names where it is kept, for the host to fix it there', () => {
  const ids = { courseId: 'crs_aaaaaaaa', lessonId: 'les_aaaaaaaa', unitId: 'unt_aaaaaaaa', deckId: 'dck_aaaaaaaa' }
  assert.deepEqual(itemSource({ courseId: ids.courseId, lessonId: ids.lessonId }, PRIME), { kind: 'practice', courseId: ids.courseId, lessonId: ids.lessonId, itemId: 'i1' })
  assert.deepEqual(itemSource({ courseId: ids.courseId, unitId: ids.unitId }, PRIME), { kind: 'quiz', courseId: ids.courseId, unitId: ids.unitId, itemId: 'i1' })
  assert.deepEqual(itemSource({ deckId: ids.deckId }, PRIME), { kind: 'deck', deckId: ids.deckId, itemId: 'i1' })
  const source = { kind: 'check', courseId: ids.courseId, lessonId: ids.lessonId, stepId: 's3' }
  assert.deepEqual(itemSource({ courseId: ids.courseId }, { ...PRIME, context: { source } }), source, 'a review question names its own place')
  assert.equal(itemSource({ courseId: ids.courseId }, { ...PRIME, context: {} }), null)
  assert.equal(itemSource({}, PRIME), null, 'a question kept nowhere cannot be fixed')
})

test('a fixed question says what it first said, part by part', () => {
  assert.deepEqual(fixedLines(t, FIXED), ['答案：A. 21', `解析：${PRIME.explanation}`])
  const reworded = { ...FIXED, options: [{ id: 'a', text: '21' }, { id: 'b', text: '29' }, { id: 'c', text: '25' }], fixed: { was: { prompt: '哪个是质数', options: { b: '23' }, answer: 'b', hints: null, figure: true }, at: '' } }
  assert.deepEqual(fixedLines(t, reworded), ['题目：哪个是质数', '选项 B：23', '答案：B. 23', '提示：—', '图也重画了'], 'the old key reads with the old options')
  assert.deepEqual(fixedLines(t, { kind: 'number', answer: 4, unit: 'N', fixed: { was: { answer: 40, tolerance: null } } }), ['答案：40 N', '允许误差：—'])
  assert.deepEqual(fixedLines(t, PRIME), [])
  assert.equal(answerText({ kind: 'multi', answer: ['a', 'c'] }), 'A, C')
  assert.equal(answerText({ kind: 'order', options: [{ id: 'a', text: '一' }, { id: 'b', text: '二' }], answer: ['b', 'a'] }), '二 → 一')
  assert.equal(answerText({ kind: 'blank', answer: ['0.5', '1/2'] }), '0.5 / 1/2')
  assert.equal(answerText({ kind: 'short', answer: '长'.repeat(200) }).length, 161)
})

test('a check keeps what earlier checks found, and its outcome changes the round', () => {
  const answered = { score: 0, correct: false, partial: false, given: 'b', response: 'b', confidence: 'sure', timeMs: 9000, index: 2 }
  assert.deepEqual(shownGrade(answered), { score: 0, correct: false, partial: false, feedback: '', wrongStep: '', fix: '' })
  const first = checkDone({ status: 'checking', note: '23 才是质数吧？' }, { verdict: 'wrong', summary: '对，已更正。', explanation: '…', item: FIXED, result: { score: 1, correct: true, partial: false } }, answered)
  assert.deepEqual([first.status, first.note, first.verdict, first.item], ['done', '23 才是质数吧？', 'wrong', FIXED])
  assert.deepEqual(first.result, { ...answered, score: 1, correct: true, partial: false, regraded: true })
  // Asked again, the teacher finds it right: the fix and the new grade stay.
  const second = checkDone({ ...first, status: 'checking' }, { verdict: 'right', summary: '没错。', item: null, result: null }, first.result)
  assert.deepEqual([second.verdict, second.item, second.result], ['right', FIXED, first.result])
  const results = [{ score: 1, correct: true, index: 0 }, answered, { score: 1, correct: true, index: 3 }]
  const regraded = regradeResults(results, 2, { score: 1, correct: true, partial: false })
  assert.deepEqual(regraded.map(entry => [entry.index, entry.correct, entry.regraded ?? false]), [[0, true, false], [2, true, true], [3, true, false]])
  assert.equal(regraded[1].confidence, 'sure', 'how the learner answered stays')
  assert.equal(checkNotice(t, { index: 2, verdict: 'wrong', regraded: true }), '第 3 题核对完了：确实有错，已更正。已按核对结果重新判分。')
  assert.equal(checkNotice(t, { index: 0, verdict: 'right' }), '第 1 题核对完了：核对过，没有错。')
  assert.equal(checkNotice(t, { index: 4, message: '模型响应超时，请重试。' }), '第 5 题没核对成功：模型响应超时，请重试。')
  assert.equal(checkNotice(tEn, { index: 2, verdict: 'misgraded', regraded: true }), 'Question 3 checked: It was graded wrongly, now regraded. Your answer was graded again.')
  for (const key of ['itemChallenge', 'itemChallengeTitle', 'itemChecking', 'itemCheck_wrong', 'itemCheck_unclear', 'itemCheck_misgraded', 'itemCheck_right', 'regraded', 'fixedWasItem', 'fixedPart_answer']) {
    assert.ok(zh[key] && en[key], `${key} in both languages`)
  }
})

// ── the card itself ─────────────────────────────────────────────────────────

let bundle
let outDir

// ItemCard is JSX: bundle it for Node, with React shared with the renderer
// (the bundle sits under node_modules so it finds the same React).
before(async () => {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  outDir = await mkdtemp(join(cache, 'aha-item-card-'))
  await build({
    config: false,
    entry: { card: join(root, 'tests', 'fixtures', 'ui', 'item-card.js') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    logLevel: 'silent',
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests', 'fixtures', 'ui', 'primitives.js') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'], alwaysBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
  })
  const file = (await readdir(outDir)).find(name => /^card\.m?js$/u.test(name))
  bundle = await import(pathToFileURL(join(outDir, file)).href)
})

after(() => rm(outDir, { recursive: true, force: true }))

function textOf(node) {
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

function renderCard(props) {
  const calls = []
  const api = { call: async (endpoint, payload) => { calls.push([endpoint, payload]); return endpoint === 'speech/status' ? { state: 'off' } : null } }
  const element = extra => h(bundle.AppContext.Provider, { value: { api, t, language: 'zh' } }, h(bundle.ItemCard, { ...props, ...extra }))
  let renderer
  act(() => { renderer = TestRenderer.create(element()) })
  return { renderer, calls, update: extra => act(() => renderer.update(element(extra))) }
}

const buttons = (renderer, label) => renderer.root.findAll(node => node.type === 'button' && textOf(node).includes(label))
const press = (renderer, label) => act(async () => { buttons(renderer, label)[0].props.onClick() })

async function answerB(renderer) {
  await press(renderer, '23')
  await press(renderer, zh.confSure)
  await act(async () => { buttons(renderer, zh.submit)[0].props.onClick() })
}

test('a graded question offers a check, sends the note and shows what the teacher found', async () => {
  const results = []
  const notes = []
  const { renderer, update } = renderCard({ item: PRIME, language: 'zh-CN', onResult: result => results.push(result), onContinue: () => undefined, onChallenge: note => notes.push(note) })
  assert.equal(buttons(renderer, zh.itemChallenge).length, 0, 'nothing to challenge before the answer is graded')
  await answerB(renderer)
  assert.deepEqual([results.length, results[0].given, results[0].correct], [1, 'b', false])
  assert.match(textOf(renderer.root), /✔ A\. 21/u)

  // The box: an optional note, the microphone, then 请老师核对.
  await press(renderer, zh.itemChallenge)
  assert.equal(buttons(renderer, zh.itemChallenge).length, 0)
  const box = renderer.root.findByType('form')
  assert.match(textOf(box), /这题哪里不对？（可以不填）/u)
  assert.ok(box.findAll(node => node.type === 'button' && /voice|mic/iu.test(String(node.props.className ?? '') + String(node.props['aria-label'] ?? ''))).length, 'the box has the microphone')
  act(() => renderer.root.findByType('textarea').props.onChange({ currentTarget: { value: '  23 才是质数吧？ ' } }))
  act(() => box.props.onSubmit({ preventDefault() {} }))
  assert.deepEqual(notes, ['23 才是质数吧？'])
  assert.equal(renderer.root.findAllByType('form').length, 0, 'the box closes once sent')

  update({ check: { status: 'checking', note: '23 才是质数吧？' } })
  assert.match(textOf(renderer.root), new RegExp(zh.itemChecking, 'u'))
  assert.equal(buttons(renderer, zh.itemChallenge).length, 0, 'one check at a time')
  assert.ok(buttons(renderer, zh.continue).length, 'the learner may go on meanwhile')

  // The question fixed and the answer graded again, on the same card.
  update({ check: { status: 'done', verdict: 'wrong', summary: '21 = 3 × 7，不是质数。', explanation: '23 只有两个因数。', item: FIXED, result: { ...results[0], score: 1, correct: true, partial: false, regraded: true }, note: '' } })
  const shown = textOf(renderer.root)
  assert.match(shown, /答对了（重新判过）/u)
  assert.match(shown, /老师核对确实有错，已更正21 = 3 × 7，不是质数。23 只有两个因数。/u)
  assert.match(shown, /23 只有 1 和它本身两个因数；21 = 3 × 7。/u, 'the fixed explanation')
  assert.doesNotMatch(shown, /✔ A\. 21/u, 'a right answer shows no key')
  const badge = renderer.root.find(node => node.props?.className === 'aha-itemFixed')
  assert.equal(textOf(badge), '✎ 已更正')
  assert.equal(badge.props.title, `原来写的：\n答案：A. 21\n解析：${PRIME.explanation}`)
  assert.equal(buttons(renderer, '23')[0].props.style.borderColor, 'var(--aha-ok)', 'B is the right option now')
  assert.equal(results.length, 1, 'the answer is not graded twice')
  assert.equal(buttons(renderer, zh.itemChallenge).length, 1, 'it can be challenged again')

  // A check that failed can be sent again with the same note.
  update({ check: { status: 'failed', note: '23 才是质数吧？', error: { code: 'aha-tutor/llm-timeout', message: 'timeout' } } })
  assert.match(textOf(renderer.root), new RegExp(zh['err_llm-timeout'], 'u'))
  await press(renderer, zh.retry)
  assert.deepEqual(notes, ['23 才是质数吧？', '23 才是质数吧？'])
})

test('a card without checks offers none, and a question fixed earlier shows its badge', async () => {
  const { renderer } = renderCard({ item: FIXED, language: 'zh-CN', onContinue: () => undefined })
  assert.equal(textOf(renderer.root.find(node => node.props?.className === 'aha-itemFixed')), '✎ 已更正')
  await answerB(renderer)
  assert.match(textOf(renderer.root), /答对了/u)
  assert.equal(buttons(renderer, zh.itemChallenge).length, 0, 'the classroom and the conversation quiz pass no onChallenge')
  // The box can be closed without sending.
  const { renderer: other } = renderCard({ item: PRIME, language: 'zh-CN', onChallenge: () => assert.fail('nothing is sent') })
  await answerB(other)
  await press(other, zh.itemChallenge)
  await press(other, zh.cancel)
  assert.equal(other.root.findAllByType('form').length, 0)
  assert.equal(buttons(other, zh.itemChallenge).length, 1)
})
