import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { answersTo, correctEvidence, EVIDENCE_KEPT, itemKey, logEvidence, stateBefore, takeEvidence } from '../src/core/evidence-log.js'
import { gradeObjective } from '../src/core/grading.js'
import { newId } from '../src/core/ids.js'
import { cleanResponse, correctedItem, earlierGrade, fixItem, itemForCheck, normalizeItemVerdict, regrade, responseText } from '../src/core/item-fix.js'
import { createConceptState } from '../src/core/mastery.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'

const PRIME = {
  id: 'i1',
  kind: 'choice',
  prompt: '下列哪个是质数？',
  explanation: '21 只有 1 和它本身两个因数。',
  hints: ['试试用 3 去除'],
  difficulty: 2,
  conceptIds: ['cpt_aaaaaaaa'],
  svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>',
  options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }],
  answer: 'a',
}
// The question as a checking model writes it back (no ids or figure).
const written = ({ id, conceptIds, difficulty, svg, ...item }) => item

const SHORT = {
  id: 'i2',
  kind: 'short',
  prompt: '为什么单摆的周期与摆球质量无关？',
  explanation: '',
  hints: [],
  difficulty: 2,
  conceptIds: ['cpt_aaaaaaaa'],
  answer: '回复力和惯性都与质量成正比，相互抵消。',
  rubric: ['回复力与质量成正比', '两者抵消'],
}

test('a check of a question keeps only a fix that fits the answer given', () => {
  const fixed = normalizeItemVerdict({ verdict: 'wrong', summary: '21 = 3 × 7，不是质数。', explanation: '23 只有两个因数。', item: { ...written(PRIME), answer: 'b', explanation: '23 只有 1 和它本身两个因数。' } }, PRIME)
  assert.equal(fixed.verdict, 'wrong')
  assert.deepEqual([fixed.item.id, fixed.item.answer, fixed.item.conceptIds, fixed.item.difficulty], ['i1', 'b', ['cpt_aaaaaaaa'], 2])
  assert.equal(fixed.item.svg, PRIME.svg, 'the figure stays unless the model drew a new one')
  assert.equal(normalizeItemVerdict({ verdict: 'wrong', item: { ...written(PRIME), answer: 1 } }, PRIME).item.answer, 'b', 'an answer may name its option by index')
  assert.equal(correctedItem(PRIME, { ...written(PRIME), answer: 'b', svg: null }).svg, undefined, 'a figure the model removes is gone')
  // A fix that does not fit goes back to the model (generateJson asks once more).
  assert.throws(() => normalizeItemVerdict({ verdict: 'wrong', item: { ...written(PRIME), kind: 'multi', answer: ['b'] } }, PRIME), /same kind/u)
  assert.throws(() => normalizeItemVerdict({ verdict: 'wrong', item: { ...written(PRIME), options: ['21', '23'], answer: 1 } }, PRIME), /number of options/u)
  assert.throws(() => normalizeItemVerdict({ verdict: 'wrong', item: written(PRIME) }, PRIME), /changes nothing/u)
  assert.throws(() => normalizeItemVerdict({ verdict: 'misgraded', summary: '判错了' }, PRIME), /answer key/u, 'a choice is graded by its key')
  assert.throws(() => normalizeItemVerdict({ summary: '?' }, PRIME), /no verdict/u)
  const right = normalizeItemVerdict({ verdict: 'right', summary: '没错。', item: { ...written(PRIME), answer: 'c' } }, PRIME)
  assert.deepEqual([right.item, right.grade, right.credit, right.summary], [null, null, false, '没错。'])
  // Graded again against the fix.
  assert.deepEqual(regrade(fixed.item, 'b', fixed), { score: 1, correct: true, partial: false })
  assert.equal(regrade(PRIME, 'b', right), null, 'a right question keeps its grade')
})

test('an open answer is graded again, and an unclear question gives the credit', () => {
  const misgraded = normalizeItemVerdict({ verdict: 'misgraded', summary: '你的答案是对的。', grade: { score: 0.9, verdict: 'correct', feedback: '说到了抵消。' } }, SHORT)
  assert.equal(misgraded.item, null)
  assert.deepEqual(regrade(SHORT, '质量约掉了', misgraded), { score: 0.9, correct: true, partial: false, feedback: '说到了抵消。', errorTag: '' })
  assert.throws(() => normalizeItemVerdict({ verdict: 'misgraded', summary: '判错了' }, SHORT), /grade/u)
  assert.throws(() => normalizeItemVerdict({ verdict: 'wrong', item: { ...written(SHORT), answer: '重力和惯性都与质量成正比。' } }, SHORT), /grade/u, 'a fixed open question grades the answer again')
  const unclear = normalizeItemVerdict({ verdict: 'unclear', credit: true, summary: '要看是否忽略空气阻力。', item: { ...written(SHORT), prompt: '忽略空气阻力时，为什么单摆的周期与摆球质量无关？' } }, SHORT)
  assert.equal(unclear.grade, null)
  assert.deepEqual(regrade(unclear.item, '…', unclear), { score: 1, correct: true, partial: false, errorTag: '' })
  const work = normalizeItemVerdict({ verdict: 'misgraded', grade: { score: 0.4, verdict: 'partial', wrongStep: '$x=2$', why: '漏了负根', fix: '$x=\\pm 2$' } }, { ...SHORT, kind: 'work' })
  assert.deepEqual([work.grade.wrongStep, work.grade.fix], ['$x=2$', '$x=\\pm 2$'])
  assert.equal(normalizeItemVerdict({ verdict: 'right', grade: { score: 0 } }, SHORT).grade, null)
})

test('a fixed question remembers what it first said, even when fixed again', () => {
  const first = fixItem(PRIME, correctedItem(PRIME, { ...written(PRIME), answer: 'b', explanation: '23 是质数。' }), { at: '2026-10-22T08:00:00.000Z' })
  assert.deepEqual(first.fixed, { was: { answer: 'a', explanation: '21 只有 1 和它本身两个因数。' }, at: '2026-10-22T08:00:00.000Z' })
  assert.deepEqual([first.id, first.conceptIds, first.svg], ['i1', ['cpt_aaaaaaaa'], PRIME.svg])
  const second = fixItem(first, correctedItem(first, { ...written(first), options: ['21', '23', '27'] }), { at: '2026-10-22T09:00:00.000Z' })
  assert.deepEqual(second.fixed, { was: { answer: 'a', explanation: '21 只有 1 和它本身两个因数。', options: { c: '25' } }, at: '2026-10-22T08:00:00.000Z' })
  assert.equal(second.options[2].text, '27')
  const third = fixItem(second, correctedItem(second, { ...written(second), options: ['21', '29', '27'] }), { at: '2026-10-22T10:00:00.000Z' })
  assert.deepEqual(third.fixed.was.options, { b: '23', c: '25' }, 'each option keeps its first wording')
})

test('the learner answer reaches the check in words, the question without bookkeeping', () => {
  const multi = { kind: 'multi', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], answer: ['a'] }
  assert.equal(cleanResponse(PRIME, 'b'), 'b')
  assert.equal(cleanResponse(PRIME, 'z'), '')
  assert.deepEqual(cleanResponse(multi, ['c', 'a', 'c', 'q']), ['c', 'a'])
  assert.equal(responseText(PRIME, 'b'), 'B. 23')
  assert.equal(responseText(multi, ['a', 'c']), 'A. 2; C. 4')
  assert.equal(responseText({ ...multi, kind: 'order' }, ['c', 'a', 'b']), 'C. 4 → A. 2 → B. 3')
  assert.equal(responseText({ kind: 'number', unit: 'N' }, '40'), '40 N')
  assert.equal(cleanResponse(SHORT, { evil: true }), '')
  const shown = JSON.parse(itemForCheck({ ...PRIME, fixed: { was: {}, at: '' } }))
  assert.deepEqual(Object.keys(shown).sort(), ['answer', 'explanation', 'hints', 'kind', 'options', 'prompt', 'svg'])
})

// ── the evidence behind mastery ─────────────────────────────────────────────

const CONCEPT = 'cpt_aaaaaaaa'
const T0 = Date.parse('2026-10-22T08:00:00.000Z')

// Answers kept the way lessons.record() keeps them, a minute apart.
function keep(answers) {
  const progress = { concepts: {}, reviews: {} }
  answers.forEach(({ id, evidence }, index) => {
    const at = T0 + index * 60_000
    const before = { [CONCEPT]: stateBefore(progress.concepts[CONCEPT], progress.reviews[CONCEPT]) }
    const taken = takeEvidence(progress.concepts[CONCEPT] ?? createConceptState(CONCEPT, '质数'), progress.reviews[CONCEPT], evidence, at)
    progress.concepts[CONCEPT] = taken.state
    if (taken.card) progress.reviews[CONCEPT] = taken.card
    logEvidence(progress, { id, at: new Date(at).toISOString(), lessonId: null, conceptIds: [CONCEPT], evidence, before })
  })
  return progress
}

const ANSWERS = [
  { id: 'evd_aaaaaa01', evidence: { kind: 'practice', score: 1, confidence: 'unsure', hintsUsed: 0, timeMs: 20_000, expectedMs: 60_000 } },
  { id: 'evd_aaaaaa02', evidence: { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'chose B: 23', hintsUsed: 1, timeMs: 30_000, expectedMs: 60_000 } },
  { id: 'evd_aaaaaa03', evidence: { kind: 'reexplain' } },
  { id: 'evd_aaaaaa04', evidence: { kind: 'quiz', score: 0.5, confidence: 'guess' } },
]
const graded = (answers, id, patch) => answers.map(answer => (answer.id === id ? { ...answer, evidence: { ...answer.evidence, ...patch } } : answer))

test('an answer graded again is replayed exactly, with every later answer', () => {
  const progress = keep(ANSWERS)
  assert.deepEqual(progress.concepts[CONCEPT].misconceptions, ['chose B: 23'])
  assert.deepEqual(correctEvidence(progress, 'evd_aaaaaa02', { score: 1, errorTag: '' }, { known: () => '质数', at: '2026-10-22T09:00:00.000Z' }), { conceptIds: [CONCEPT] })
  // As if it had been graded right the first time: mastery, history and the
  // review schedule alike, and the misconception it left is gone.
  const truth = keep(graded(ANSWERS, 'evd_aaaaaa02', { score: 1, errorTag: '' }))
  assert.deepEqual(progress.concepts[CONCEPT], truth.concepts[CONCEPT])
  assert.deepEqual(progress.reviews[CONCEPT], truth.reviews[CONCEPT])
  assert.deepEqual(progress.concepts[CONCEPT].misconceptions, [])
  assert.equal(progress.evidenceLog[1].corrected.score, 0)
  // Graded back, it is as it was.
  correctEvidence(progress, 'evd_aaaaaa02', { score: 0, errorTag: 'chose B: 23' }, { known: () => '质数' })
  assert.deepEqual(progress.concepts[CONCEPT], keep(ANSWERS).concepts[CONCEPT])
  assert.deepEqual(progress.reviews[CONCEPT], keep(ANSWERS).reviews[CONCEPT])
  assert.equal(progress.evidenceLog[1].corrected.score, 0, 'it remembers the first score')
  // Nothing to grade again: unknown, or without a score.
  assert.equal(correctEvidence(progress, 'evd_zzzzzz99', { score: 1 }), null)
  assert.equal(correctEvidence(progress, 'evd_aaaaaa03', { score: 1 }), null)
  // A concept the course no longer has is left alone.
  assert.deepEqual(correctEvidence(keep(ANSWERS), 'evd_aaaaaa02', { score: 1 }, { known: () => null }), { conceptIds: [] })
})

test('the log keeps the latest answers, and history past its limit is replayed too', () => {
  const answers = Array.from({ length: 56 }, (_, index) => ({ id: `evd_bbbbbb${String(index).padStart(2, '0')}`, evidence: { kind: 'practice', score: index % 3 ? 1 : 0, confidence: index % 2 ? 'sure' : 'unsure', errorTag: index % 3 ? undefined : `slip ${index}` } }))
  const progress = keep(answers)
  assert.equal(progress.evidenceLog.length, EVIDENCE_KEPT)
  assert.equal(progress.evidenceLog[0].id, 'evd_bbbbbb06')
  assert.equal(progress.concepts[CONCEPT].history.length, 50)
  correctEvidence(progress, 'evd_bbbbbb51', { score: 1, errorTag: '' }, { known: () => '质数' })
  const truth = keep(graded(answers, 'evd_bbbbbb51', { score: 1, errorTag: '' }))
  assert.deepEqual(progress.concepts[CONCEPT], truth.concepts[CONCEPT])
  assert.deepEqual(progress.reviews[CONCEPT], truth.reviews[CONCEPT])
  assert.equal(correctEvidence(progress, 'evd_bbbbbb02', { score: 1 }), null, 'an answer older than the log cannot be graded again')
})

test('earlier answers to a fixed question are found by where it is kept and graded against the fix', () => {
  assert.equal(itemKey({ kind: 'practice', courseId: 'crs_aaaaaaaa', lessonId: 'les_aaaaaaaa', itemId: 'i1' }), 'practice:les_aaaaaaaa:i1')
  assert.equal(itemKey({ kind: 'quiz', courseId: 'crs_aaaaaaaa', unitId: 'unt_aaaaaaaa', itemId: 'i2' }), 'quiz:unt_aaaaaaaa:i2')
  assert.equal(itemKey({ kind: 'check', courseId: 'crs_aaaaaaaa', lessonId: 'les_aaaaaaaa', stepId: 's3' }), 'check:les_aaaaaaaa:s3')
  assert.equal(itemKey({ kind: 'deck', deckId: 'dck_aaaaaaaa', itemId: 'i1' }), null, 'a library quiz is not evidence')
  const key = 'practice:les_aaaaaaaa:i1'
  const progress = { evidenceLog: [
    { id: 'evd_aaaaaa01', evidence: { kind: 'practice', score: 0 }, item: { key, response: 'b' } },
    { id: 'evd_aaaaaa02', evidence: { kind: 'reexplain' }, item: { key, response: '' } },
    { id: 'evd_aaaaaa03', evidence: { kind: 'practice', score: 1 }, item: { key: 'practice:les_aaaaaaaa:i2', response: 'a' } },
    { id: 'evd_aaaaaa04', evidence: { kind: 'practice', score: 1 } },
    { id: 'evd_aaaaaa05', evidence: { kind: 'check', score: 1 }, item: { key, response: 'a' } },
  ] }
  assert.deepEqual(answersTo(progress, key).map(entry => entry.id), ['evd_aaaaaa01', 'evd_aaaaaa05'])
  assert.deepEqual(answersTo(progress, key, 'evd_aaaaaa05').map(entry => entry.id), ['evd_aaaaaa01'], 'but the one being checked')
  assert.deepEqual([answersTo(progress, null), answersTo({}, key), answersTo(null, key)], [[], [], []])

  const fixed = { ...PRIME, answer: 'b' }
  // A wrong question: its answers take the fixed key's grade either way.
  assert.deepEqual(earlierGrade(fixed, 'b', { verdict: 'wrong', score: 0 }), { score: 1, correct: true, errorTag: '' })
  assert.deepEqual(earlierGrade(fixed, 'a', { verdict: 'wrong', score: 1 }), { score: 0, correct: false, errorTag: 'chose A: 21' })
  assert.equal(earlierGrade(fixed, 'b', { verdict: 'wrong', score: 1 }), null, 'a grade that stays')
  assert.deepEqual(earlierGrade(fixed, 'z', { verdict: 'wrong', score: 1 }), { score: 0, correct: false, errorTag: 'chose : ' }, 'an option the question no longer has')
  // An unclear one: answers only gain.
  assert.deepEqual(earlierGrade(fixed, 'b', { verdict: 'unclear', score: 0 }), { score: 1, correct: true, errorTag: '' })
  assert.equal(earlierGrade(fixed, 'a', { verdict: 'unclear', score: 1 }), null)
  // Neither of the others changed the question.
  assert.equal(earlierGrade(fixed, 'b', { verdict: 'misgraded', score: 0 }), null)
  assert.equal(earlierGrade(fixed, 'b', { verdict: 'right', score: 0 }), null)
  const multi = { kind: 'multi', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], answer: ['a', 'c'] }
  assert.deepEqual(earlierGrade(multi, ['a'], { verdict: 'wrong', score: 1 }), { score: 0.5, correct: false, errorTag: 'wrong' })
  assert.equal(earlierGrade({ ...multi, answer: [] }, ['a'], { verdict: 'wrong', score: 1 }), null, 'a key it cannot grade by')
  // Open answers take the grader's new grade, when there is one.
  assert.deepEqual(earlierGrade(SHORT, '质量约掉了', { verdict: 'wrong', score: 0.2, grade: { score: 0.9, verdict: 'correct', errorTag: '' } }), { score: 0.9, correct: true, errorTag: '' })
  assert.deepEqual(earlierGrade(SHORT, '不知道', { verdict: 'wrong', score: 0.9, grade: { score: 0.1, verdict: 'incorrect', errorTag: '没说抵消' } }), { score: 0.1, correct: false, errorTag: '没说抵消' })
  assert.equal(earlierGrade(SHORT, '不知道', { verdict: 'unclear', score: 0.9, grade: { score: 0.1, verdict: 'incorrect' } }), null)
  assert.equal(earlierGrade(SHORT, '质量约掉了', { verdict: 'wrong', score: 0.2 }), null, 'not graded again')
})

// ── on the host ─────────────────────────────────────────────────────────────

const blueprint = {
  title: '数的性质',
  emoji: '🔢',
  summary: '质数与运算顺序。',
  level: 'beginner',
  units: [{ title: '整数', lectures: [{ title: '质数', lessons: [{ title: '认识质数', objectives: ['判断质数'], concepts: ['质数'], estMinutes: 12 }, { title: '运算顺序', concepts: ['运算顺序'], estMinutes: 10 }] }] }],
  projects: [],
}

// A model for the course flow whose checks of a question answer what the
// test sets.
function checkingLlm() {
  const calls = []
  let verdict = () => ({ verdict: 'right', summary: '没错。', explanation: '这题是对的。' })
  let grader = () => ({ score: 0, verdict: 'incorrect', feedback: '', errorTag: '' })
  const answer = ({ system, user }) => {
    if (system.includes('You grade open answers')) return JSON.stringify(grader(user))
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零基础', '学过'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [
        { kind: 'choice', prompt: PRIME.prompt, options: ['21', '23', '25'], answer: 0, explanation: PRIME.explanation, hints: PRIME.hints, conceptIds: [concept] },
        { kind: 'short', prompt: SHORT.prompt, answer: SHORT.answer, rubric: SHORT.rubric, conceptIds: [concept] },
      ] }])) })
    }
    if (user.includes('Teach this lesson')) {
      const concept = /Concepts \(id=name\): (cpt_[a-z0-9]+)/u.exec(user)?.[1]
      return [
        { say: '先看定义。', ops: [{ t: 'title', text: '运算顺序' }] },
        { say: '先乘除后加减。', ops: [{ t: 'math', tex: '2 + 3 \\times 4' }] },
        { say: '算一算。', ops: [{ t: 'p', text: '试试看' }], check: { kind: 'number', prompt: '$2 + 3 \\times 4$ 等于多少？', answer: 20, conceptIds: [concept] } },
      ].map(line => JSON.stringify(line)).join('\n')
    }
    if (user.includes('quiz across the whole scope')) {
      const concept = /(cpt_[a-z0-9]+)=/u.exec(user)?.[1]
      // As many questions as the prompt asks for at least.
      const wanted = Number(/at least (\d+) and at most/u.exec(user)?.[1] ?? 3)
      return JSON.stringify({ items: [
        { kind: 'number', prompt: '$2 + 2 \\times 3$ 等于多少？', answer: 12, explanation: '先乘后加。', conceptIds: [concept] },
        { kind: 'choice', prompt: '哪个是质数？', options: ['9', '11'], answer: 1, conceptIds: [concept] },
        { kind: 'blank', prompt: '最小的质数是 __', answer: ['2'], conceptIds: [concept] },
        ...Array.from({ length: Math.max(0, wanted - 3) }, (_, index) => ({ kind: 'number', prompt: `$${index + 2} \\times 3$ 等于多少？`, answer: (index + 2) * 3, conceptIds: [concept] })),
      ] })
    }
    if (user.includes('Decide which is true')) return JSON.stringify(verdict(user))
    return '{}'
  }
  return {
    calls,
    supportsImages: () => false,
    setVerdict(next) { verdict = typeof next === 'function' ? next : () => next },
    setGrader(next) { grader = next },
    async complete(request) {
      calls.push(request)
      return answer(request)
    },
    async stream(request) {
      calls.push(request)
      const full = answer(request)
      for (const piece of full.match(/[\s\S]{1,23}/gu) ?? []) request.onText(piece)
      return full
    },
  }
}

async function finish(jobs, started) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = jobs.get(started.id)
    if (job.status !== 'running') {
      if (job.status !== 'done') throw new Error(`job ${job.kind} ${job.status}: ${job.error?.message}`)
      return job.result
    }
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('job timed out')
}

async function setup(root) {
  const clock = { at: T0 }
  const now = () => new Date(clock.at)
  const store = createStore({ root: join(root, 'data') })
  const llm = checkingLlm()
  const jobs = createJobs()
  const learner = createLearner({ store, llm, now })
  const courses = createCourses({ store, llm, jobs, now })
  const lessons = createLessons({ store, llm, jobs, courses, learner, now })
  const { courseId } = await finish(jobs, courses.startCraft({ goal: '质数' }))
  await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
  const { course } = await finish(jobs, courses.confirm({ courseId }))
  const unit = course.units[0]
  const [first, second] = unit.lectures[0].lessons
  return { clock, store, llm, jobs, learner, lessons, courseId, unit, first, second }
}

// An answer recorded as the practice screen records it, a minute after the last.
async function answer(context, { lessonId, conceptIds, evidence, item }) {
  context.clock.at += 60_000
  return context.lessons.record({ courseId: context.courseId, lessonId, conceptIds, evidence, item })
}

// What a concept's mastery would be had these answers been recorded as given.
function masteryOf(answers) {
  let state = null
  let card = null
  for (const { evidence, at } of answers) ({ state, card } = takeEvidence(state ?? createConceptState(CONCEPT, ''), card, evidence, at))
  return { state, card }
}

test('a wrong practice question is fixed where it is kept, the answer graded again and mastery corrected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-item-'))
  try {
    const context = await setup(root)
    const { store, llm, jobs, lessons, courseId, first } = context
    const practicePath = store.paths.practice(courseId, first.id)
    const [prime, short] = (await store.readJson(practicePath, null)).items
    assert.equal(prime.answer, 'a', 'the stored key is wrong: 21 is not prime')
    const concept = first.concepts[0].id

    // The learner picks 23, sure of it, and is told it is wrong; then
    // answers the next question.
    const told = gradeObjective(prime, 'b')
    const wrongly = { kind: 'practice', score: told.score, confidence: 'sure', hintsUsed: 0, timeMs: 20_000, expectedMs: 60_000, errorTag: 'chose B: 23' }
    const { evidenceId } = await answer(context, { lessonId: first.id, conceptIds: prime.conceptIds, evidence: wrongly })
    assert.match(evidenceId, /^evd_/u)
    const later = { kind: 'practice', score: 0.5, confidence: 'unsure', hintsUsed: 1, timeMs: 50_000, expectedMs: 60_000 }
    await answer(context, { lessonId: first.id, conceptIds: short.conceptIds, evidence: later })
    assert.deepEqual((await store.readJson(store.paths.progress(courseId), null)).concepts[concept].misconceptions, ['chose B: 23'])

    llm.setVerdict({ verdict: 'wrong', summary: '21 = 3 × 7，不是质数；23 才是。', explanation: '23 只有 1 和 23 两个因数。', item: { kind: 'choice', prompt: PRIME.prompt, options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }], answer: 'b', explanation: '23 只有 1 和它本身两个因数；21 = 3 × 7。', hints: PRIME.hints } })
    context.clock.at += 60_000
    const result = await finish(jobs, lessons.challengeItem({ source: { kind: 'practice', courseId, lessonId: first.id, itemId: prime.id }, response: 'b', shown: { score: 0, correct: false }, evidenceId, note: '23 才是质数吧？' }))
    assert.equal(result.verdict, 'wrong')
    assert.deepEqual(result.result, { score: 1, correct: true, partial: false })
    assert.equal(result.summary, '21 = 3 × 7，不是质数；23 才是。')
    assert.equal(result.explanation, '23 只有 1 和 23 两个因数。')

    // Checked by the teach model, thinking first, with the learner's answer in words.
    const check = llm.calls.find(call => call.user.includes('Decide which is true'))
    assert.deepEqual([check.purpose, check.effort], ['teach', 'low'])
    assert.match(check.user, /<learner_answer>\nB\. 23\n/u)
    assert.match(check.user, /<learner_says>\n23 才是质数吧？/u)
    assert.match(check.user, /<grading>\nThe answer key marked this answer incorrect\./u)
    assert.match(check.user, /<question>\n\{"kind":"choice","prompt":"下列哪个是质数？"/u)
    assert.doesNotMatch(check.user, /conceptIds|"misgraded/u, 'a choice is graded by its key')

    // The stored question is fixed, ids and all; the other one is untouched.
    const [fixedPrime, sameShort] = (await store.readJson(practicePath, null)).items
    assert.deepEqual([fixedPrime.id, fixedPrime.answer, fixedPrime.conceptIds], ['i1', 'b', prime.conceptIds])
    assert.deepEqual(fixedPrime.fixed, { was: { answer: 'a', explanation: PRIME.explanation }, at: '2026-10-22T08:03:00.000Z' })
    assert.deepEqual(result.item, fixedPrime)
    assert.deepEqual(sameShort, short)

    // Mastery and the review schedule are as if the answer had been graded
    // right the first time, the later answer replayed after it.
    const progress = await store.readJson(store.paths.progress(courseId), null)
    const truth = masteryOf([{ evidence: { ...wrongly, score: 1, errorTag: '' }, at: T0 + 60_000 }, { evidence: later, at: T0 + 120_000 }])
    assert.deepEqual({ ...progress.concepts[concept], name: '' }, { ...truth.state, id: concept, name: '' })
    assert.deepEqual(progress.reviews[concept], { ...truth.card, id: concept })
    assert.deepEqual(progress.concepts[concept].misconceptions, [])
    assert.deepEqual(result.mastery, { [concept]: Math.round(truth.state.pKnown * 100) })
    assert.equal(typeof result.recommendation.action, 'string')
    assert.equal(progress.events.at(-1).type, 'item-challenge')
    assert.ok(progress.events.some(event => event.type === 'regrade' && event.evidenceId === evidenceId))

    // A question that is right is explained, and nothing changes.
    const kept = async () => {
      const { concepts, reviews, evidenceLog } = await store.readJson(store.paths.progress(courseId), null)
      return JSON.stringify([await store.readJson(practicePath, null), concepts, reviews, evidenceLog])
    }
    const before = await kept()
    llm.setVerdict({ verdict: 'right', summary: '没错，23 是质数。', explanation: '…', item: { ...written(fixedPrime), answer: 'c' } })
    const right = await finish(jobs, lessons.challengeItem({ source: { kind: 'practice', courseId, lessonId: first.id, itemId: prime.id }, response: 'b', shown: { score: 1, correct: true }, evidenceId }))
    assert.deepEqual([right.verdict, right.item, right.result, right.mastery], ['right', null, null, null])
    assert.match(llm.calls.findLast(call => call.user.includes('Decide which is true')).user, /<learner_says>\n\(no reason given\)/u)
    assert.equal(await kept(), before)

    // An open answer graded too harshly is graded again; the question stays.
    const { evidenceId: shortEvidence } = await answer(context, { lessonId: first.id, conceptIds: short.conceptIds, evidence: { kind: 'practice', score: 0.2, confidence: 'sure', errorTag: '没说抵消' } })
    llm.setVerdict({ verdict: 'misgraded', summary: '你说到了抵消，应该算对。', explanation: '…', grade: { score: 0.9, verdict: 'correct', feedback: '答到了要点。' } })
    const regraded = await finish(jobs, lessons.challengeItem({ source: { kind: 'practice', courseId, lessonId: first.id, itemId: short.id }, response: '质量在两边约掉了', shown: { score: 0.2, correct: false, feedback: '没有提到抵消。' }, evidenceId: shortEvidence }))
    assert.deepEqual(regraded.result, { score: 0.9, correct: true, partial: false, feedback: '答到了要点。', errorTag: '' })
    assert.equal(regraded.item, null)
    const shortCheck = llm.calls.findLast(call => call.user.includes('Decide which is true')).user
    assert.match(shortCheck, /A grader gave this answer a score of 0\.2 \(incorrect\)\.\nFeedback shown: 没有提到抵消。/u)
    assert.match(shortCheck, /"misgraded": the question is right/u)
    assert.deepEqual((await store.readJson(practicePath, null)).items[1], short)
    const entry = (await store.readJson(store.paths.progress(courseId), null)).evidenceLog.find(item => item.id === shortEvidence)
    assert.deepEqual([entry.evidence.score, entry.evidence.errorTag, entry.corrected.score], [0.9, '', 0.2])
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a fixed question grades the earlier answers to it again, and only those', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-item-'))
  try {
    const context = await setup(root)
    const { store, llm, jobs, lessons, courseId, first } = context
    const [prime, short] = (await store.readJson(store.paths.practice(courseId, first.id), null)).items
    const concept = first.concepts[0].id
    const source = item => ({ kind: 'practice', courseId, lessonId: first.id, itemId: item.id })
    const given = (item, response) => ({ source: source(item), response })

    // Round one: 23, marked wrong by the wrong key. Round two: 21, marked
    // right by it; an open question in between. Then 23 again, challenged.
    const roundOne = { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'chose B: 23' }
    const { evidenceId: one } = await answer(context, { lessonId: first.id, conceptIds: prime.conceptIds, evidence: roundOne, item: given(prime, 'b') })
    const roundTwo = { kind: 'practice', score: 1, confidence: 'unsure' }
    const { evidenceId: two } = await answer(context, { lessonId: first.id, conceptIds: prime.conceptIds, evidence: roundTwo, item: given(prime, 'a') })
    const between = { kind: 'practice', score: 0.5, confidence: 'unsure' }
    const { evidenceId: other } = await answer(context, { lessonId: first.id, conceptIds: short.conceptIds, evidence: between, item: given(short, '质量约掉了') })
    const unknown = { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'chose B: 23' }
    await answer(context, { lessonId: first.id, conceptIds: prime.conceptIds, evidence: unknown })
    const challenged = { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'chose B: 23' }
    const { evidenceId: three } = await answer(context, { lessonId: first.id, conceptIds: prime.conceptIds, evidence: challenged, item: given(prime, 'b') })
    assert.deepEqual((await store.readJson(store.paths.progress(courseId), null)).evidenceLog.find(entry => entry.id === one).item, { key: `practice:${first.id}:${prime.id}`, response: 'b' })

    llm.setVerdict({ verdict: 'wrong', summary: '23 才是质数。', explanation: '…', item: { kind: 'choice', prompt: PRIME.prompt, options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }], answer: 'b', explanation: '21 = 3 × 7。', hints: PRIME.hints } })
    const result = await finish(jobs, lessons.challengeItem({ source: source(prime), response: 'b', shown: { score: 0, correct: false }, evidenceId: three }))
    assert.deepEqual([result.result?.correct, result.earlier], [true, 2])

    // Every answer to it as if graded against the fixed question the first
    // time; the open answer and the one recorded without its question stay.
    const progress = await store.readJson(store.paths.progress(courseId), null)
    const truth = masteryOf([
      { evidence: { ...roundOne, score: 1, errorTag: '' }, at: T0 + 60_000 },
      { evidence: { ...roundTwo, score: 0, errorTag: 'chose A: 21' }, at: T0 + 120_000 },
      { evidence: between, at: T0 + 180_000 },
      { evidence: unknown, at: T0 + 240_000 },
      { evidence: { ...challenged, score: 1, errorTag: '' }, at: T0 + 300_000 },
    ])
    assert.deepEqual({ ...progress.concepts[concept], name: '' }, { ...truth.state, id: concept, name: '' })
    assert.deepEqual(progress.reviews[concept], { ...truth.card, id: concept })
    assert.deepEqual(result.mastery, { [concept]: Math.round(truth.state.pKnown * 100) })
    const log = Object.fromEntries(progress.evidenceLog.map(entry => [entry.id, entry]))
    assert.deepEqual([log[one].corrected.score, log[two].corrected.score, log[three].corrected.score, log[other].corrected], [0, 1, 0, undefined])
    assert.equal(progress.evidenceLog.filter(entry => entry.corrected).length, 3)
    assert.equal(progress.events.at(-1).earlier, 2)
    assert.equal(llm.calls.filter(call => call.system.includes('You grade open answers')).length, 0, 'a question with a key needs no grader')

    // An open question fixed: the grader looks again at the latest three
    // earlier answers, against the fixed question.
    const openAnswers = [['两边抵消', 0.2], ['质量抵消了', 0.2], ['不知道', 0.6], ['重力抵消', 0.9]]
    const ids = []
    for (const [response, score] of openAnswers) ids.push((await answer(context, { lessonId: first.id, conceptIds: short.conceptIds, evidence: { kind: 'practice', score, confidence: 'unsure' }, item: given(short, response) })).evidenceId)
    const { evidenceId: last } = await answer(context, { lessonId: first.id, conceptIds: short.conceptIds, evidence: { kind: 'practice', score: 0.2, confidence: 'sure' }, item: given(short, '回复力与惯性抵消') })
    llm.setGrader(user => (/<learner_answer>\n[^<]*抵消/u.test(user) ? { score: 0.9, verdict: 'correct', feedback: '对。', errorTag: '' } : { score: 0.1, verdict: 'incorrect', feedback: '没说到抵消。', errorTag: '没说抵消' }))
    llm.setVerdict({ verdict: 'wrong', summary: '标准答案写错了。', explanation: '…', item: { ...written(short), answer: '回复力和惯性都与质量成正比，比值与质量无关。' }, grade: { score: 0.9, verdict: 'correct', feedback: '对。' } })
    const open = await finish(jobs, lessons.challengeItem({ source: source(short), response: '回复力与惯性抵消', shown: { score: 0.2, correct: false }, evidenceId: last }))
    assert.equal(open.earlier, 2)
    const grades = llm.calls.filter(call => call.system.includes('You grade open answers'))
    assert.equal(grades.length, 3, 'the three latest earlier answers only')
    assert.ok(grades.every(call => call.purpose === 'quick' && call.user.includes('比值与质量无关')), 'graded quickly, against the fixed question')
    const after = Object.fromEntries((await store.readJson(store.paths.progress(courseId), null)).evidenceLog.map(entry => [entry.id, entry]))
    assert.deepEqual(ids.map(id => after[id].evidence.score), [0.2, 0.9, 0.1, 0.9], 'the oldest is past the three; one stays')
    assert.deepEqual([after[ids[2]].evidence.errorTag, after[other].evidence.score, after[other].corrected], ['没说抵消', 0.5, undefined])
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unit quizzes, library quizzes and review questions are fixed where they are kept', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-item-'))
  try {
    const context = await setup(root)
    const { clock, store, llm, jobs, learner, lessons, courseId, unit, first, second } = context

    // A unit quiz: the key says 2 + 2 × 3 = 12.
    const { job: quizJob } = await lessons.unitQuiz({ courseId, unitId: unit.id })
    const quiz = (await finish(jobs, quizJob)).quiz
    const sum = quiz.items[0]
    const { evidenceId } = await answer(context, { conceptIds: sum.conceptIds, evidence: { kind: 'quiz', score: 0, confidence: 'sure', errorTag: 'answered 8' } })
    llm.setVerdict({ verdict: 'wrong', summary: '先乘后加，是 8。', explanation: '$2 + 2 \\times 3 = 2 + 6 = 8$。', item: { ...written(sum), answer: 8, explanation: '先乘后加：$2 + 6 = 8$。' } })
    const fixedQuiz = await finish(jobs, lessons.challengeItem({ source: { kind: 'quiz', courseId, unitId: unit.id, itemId: sum.id }, response: '8', shown: { score: 0, correct: false }, evidenceId }))
    assert.deepEqual(fixedQuiz.result, { score: 1, correct: true, partial: false })
    const storedQuiz = await store.readJson(store.paths.unitQuiz(courseId, unit.id), null)
    assert.deepEqual([storedQuiz.items[0].answer, storedQuiz.items[0].fixed.was.answer], [8, 12])
    assert.ok(fixedQuiz.mastery, 'a quiz answer is evidence too')

    // A quiz from the library: fixed in its deck; it was never evidence.
    const deck = { id: newId('dck'), kind: 'quiz', title: '偶数速测', language: 'zh-CN', items: [{ id: 'i1', kind: 'multi', prompt: '哪些是偶数？', explanation: '', hints: [], difficulty: 1, conceptIds: [], options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], answer: ['a'] }], createdAt: new Date(T0).toISOString() }
    await store.writeJson(store.paths.item('decks', deck.id), deck)
    llm.setVerdict({ verdict: 'wrong', summary: '4 也是偶数。', explanation: '…', item: { ...written(deck.items[0]), answer: ['a', 'c'] } })
    const fixedDeck = await finish(jobs, lessons.challengeItem({ source: { kind: 'deck', deckId: deck.id, itemId: 'i1' }, response: ['a', 'c'], shown: { score: 0, correct: false } }))
    assert.deepEqual([fixedDeck.result.correct, fixedDeck.mastery], [true, null])
    assert.match(llm.calls.findLast(call => call.user.includes('Decide which is true')).user, /<scope>\n偶数速测\n/u)
    assert.deepEqual((await store.readJson(store.paths.item('decks', deck.id), null)).items[0].answer, ['a', 'c'])

    // A review question: each comes with where it is kept, and a check of a
    // lesson step is fixed in the board.
    const { job: boardJob } = await lessons.prepare({ courseId, lessonId: second.id })
    await finish(jobs, boardJob)
    const board = await store.readJson(store.paths.board(courseId, second.id), null)
    const check = board.steps[2].check
    const { evidenceId: reviewEvidence } = await answer(context, { lessonId: second.id, conceptIds: check.conceptIds, evidence: { kind: 'check', score: 0, confidence: 'sure', errorTag: 'answered 14' } })
    clock.at += 3_600_000
    const session = await learner.reviewSession({ courseId })
    assert.ok(session.items.length)
    for (const entry of session.items) {
      const kept = entry.source.kind === 'check'
        ? (await store.readJson(store.paths.board(courseId, entry.source.lessonId), null)).steps.find(step => step.id === entry.source.stepId).check
        : (await store.readJson(store.paths.practice(courseId, entry.source.lessonId), null)).items.find(item => item.id === entry.source.itemId)
      assert.deepEqual(kept, entry.item, `${entry.source.kind} names where its question is kept`)
    }
    llm.setVerdict({ verdict: 'wrong', summary: '先乘后加，是 14。', explanation: '…', item: { ...written(check), answer: 14 } })
    const fixedCheck = await finish(jobs, lessons.challengeItem({ source: { kind: 'check', courseId, lessonId: second.id, stepId: 's3' }, response: '14', shown: { score: 0, correct: false }, evidenceId: reviewEvidence }))
    assert.equal(fixedCheck.result.correct, true)
    const fixedBoard = await store.readJson(store.paths.board(courseId, second.id), null)
    assert.deepEqual([fixedBoard.steps[2].check.id, fixedBoard.steps[2].check.answer, fixedBoard.steps[2].check.fixed.was.answer], ['k3', 14, 20])
    assert.deepEqual(fixedBoard.steps.slice(0, 2), board.steps.slice(0, 2), 'the rest of the board is untouched')

    // Questions that are not there.
    await assert.rejects(finish(jobs, lessons.challengeItem({ source: { kind: 'practice', courseId, lessonId: first.id, itemId: 'i9' }, response: 'a' })), /not-found|Not found/u)
    await assert.rejects(finish(jobs, lessons.challengeItem({ source: { kind: 'check', courseId, lessonId: first.id, stepId: 's3' }, response: '1' })), /Not found/u)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a recorded answer names its question only when its course keeps it', async () => {
  const seen = []
  const routes = createRoutes({ lessons: { record: request => { seen.push(request); return {} } } })
  const courseId = newId('crs')
  const lessonId = newId('les')
  const evidence = { kind: 'practice', score: 1 }
  await routes['lesson/record']({ courseId, lessonId, evidence, source: { kind: 'practice', courseId, lessonId, itemId: 'i1', extra: 1 }, response: ['b', '../x', 4] })
  await routes['lesson/record']({ courseId, lessonId, evidence, source: { kind: 'check', courseId, lessonId, stepId: 's3' }, response: 12 })
  await routes['lesson/record']({ courseId, evidence, source: { kind: 'deck', deckId: newId('dck'), itemId: 'i1' }, response: 'a' })
  await routes['lesson/record']({ courseId, evidence, source: { kind: 'practice', courseId: newId('crs'), lessonId, itemId: 'i1' }, response: 'a' })
  await routes['lesson/record']({ courseId, evidence, source: { kind: 'check', courseId, lessonId, stepId: 'a1_s2' }, response: '3' })
  await routes['lesson/record']({ courseId, evidence, source: 'practice', response: 'a' })
  await routes['lesson/record']({ courseId, evidence })
  assert.deepEqual(seen[0].item, { source: { kind: 'practice', courseId, lessonId, itemId: 'i1' }, response: ['b'] })
  assert.deepEqual(seen[1].item, { source: { kind: 'check', courseId, lessonId, stepId: 's3' }, response: '12' })
  assert.deepEqual(seen.slice(2).map(request => request.item), [null, null, null, null, null], 'recorded without it')
})

test('the item challenge endpoint checks what it is given', async () => {
  const seen = []
  const routes = createRoutes({ lessons: { challengeItem: request => { seen.push(request); return { id: 'job_x' } } } })
  const courseId = newId('crs')
  const lessonId = newId('les')
  const evidenceId = newId('evd')
  await routes['item/challenge']({ source: { kind: 'practice', courseId, lessonId, itemId: 'i2', extra: 1 }, response: 'b', shown: { score: 7, correct: 'yes', feedback: 3 }, evidenceId, note: '不对' })
  await routes['item/challenge']({ source: { kind: 'quiz', courseId, unitId: newId('unt'), itemId: 'i1' }, response: ['a', 'c', '../x', 5] })
  await routes['item/challenge']({ source: { kind: 'deck', deckId: newId('dck'), itemId: 'i1' }, response: 12, note: 5 })
  await routes['item/challenge']({ source: { kind: 'check', courseId, lessonId, stepId: 's3' }, response: { evil: true } })
  assert.deepEqual(seen[0], { source: { kind: 'practice', courseId, lessonId, itemId: 'i2' }, response: 'b', shown: { score: 1, correct: false, partial: false, feedback: '', wrongStep: '', fix: '' }, evidenceId, note: '不对' })
  assert.deepEqual(seen.slice(1).map(request => [request.source.kind, request.response, request.note, request.evidenceId]), [['quiz', ['a', 'c'], '', undefined], ['deck', '12', '', undefined], ['check', '', '', undefined]])
  const invalid = error => error.code === 'invalid'
  assert.throws(() => routes['item/challenge']({ source: { kind: 'practice', courseId, lessonId, itemId: '../i1' } }), invalid)
  assert.throws(() => routes['item/challenge']({ source: { kind: 'check', courseId, lessonId, stepId: 'k3' } }), invalid)
  assert.throws(() => routes['item/challenge']({ source: { kind: 'deck', deckId: 'dck_../x', itemId: 'i1' } }), invalid)
  assert.throws(() => routes['item/challenge']({ source: { kind: 'practice', courseId, lessonId, itemId: 'i1' }, evidenceId: 'evd_../x' }), invalid)
  assert.throws(() => routes['item/challenge']({ source: { kind: 'board' } }), invalid)
})
