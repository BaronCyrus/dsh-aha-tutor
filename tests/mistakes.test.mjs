import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { newId } from '../src/core/ids.js'
import { answeredRight, ATTEMPTS_KEPT, dueMistakes, fixMistakes, itemSig, listMistakes, MISTAKE_ROUND, MISTAKES_KEPT, mistakeState, noteAnswer } from '../src/core/mistakes.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { courseNextStep, dayName, mistakesDue, mistakeWhen } from '../src/ui/practice.js'

// Times on the learner's own calendar (November 2026), whatever the zone the
// tests run in.
const on = (day, hour = 10, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
const iso = value => new Date(value).toISOString()
const dayStart = day => iso(new Date(2026, 10, day))

const LESSON = 'les_aaaaaaaa'
const PRIME = {
  id: 'i1',
  kind: 'choice',
  prompt: '下列哪个是质数？',
  explanation: '23 只有 1 和它本身两个因数。',
  hints: [],
  difficulty: 2,
  conceptIds: ['cpt_aaaaaaaa'],
  options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }],
  answer: 'b',
}
const EVEN = { id: 'i2', kind: 'multi', prompt: '哪些是偶数？', explanation: '', hints: [], difficulty: 1, conceptIds: ['cpt_aaaaaaaa'], options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], answer: ['a', 'c'], svg: '<svg viewBox="0 0 4 4"></svg>' }
const SHORT = { id: 'i3', kind: 'short', prompt: '为什么单摆的周期与摆球质量无关？', explanation: '', hints: [], difficulty: 2, conceptIds: ['cpt_aaaaaaaa'], answer: '回复力和惯性都与质量成正比，相互抵消。', rubric: [] }

const placeOf = item => ({ kind: 'practice', lessonId: LESSON, itemId: item.id })
const keyOf = item => `practice:${LESSON}:${item.id}`
// An answer to a practice question as the host notes it.
const answerTo = (item, { id = null, at, score, correct, response }) => ({ key: keyOf(item), sig: itemSig(item), source: placeOf(item), lessonId: LESSON, unitId: null, conceptIds: item.conceptIds, id, at: iso(at), score, correct, response })

test('a question is told apart by what it asks and accepts', () => {
  assert.equal(itemSig(PRIME), itemSig({ ...PRIME, id: 'i9', conceptIds: [], explanation: '另写', svg: '<svg/>', context: { courseId: 'crs_x' } }), 'bookkeeping, the figure and the explanation do not count')
  assert.notEqual(itemSig(PRIME), itemSig({ ...PRIME, answer: 'a' }))
  assert.notEqual(itemSig(PRIME), itemSig({ ...PRIME, prompt: '下列哪个是合数？' }))
  assert.notEqual(itemSig(PRIME), itemSig({ ...PRIME, options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '27' }] }))
  assert.notEqual(itemSig({ kind: 'number', prompt: 'x?', answer: 2 }), itemSig({ kind: 'number', prompt: 'x?', answer: 2, tolerance: 0.5 }))
  assert.match(itemSig(PRIME), /^[0-9a-z]{1,7}$/u)
  // Right as the learner was told, else by the score.
  assert.deepEqual([answeredRight({ correct: false, score: 1 }), answeredRight({ correct: true, score: 0 }), answeredRight({ score: 0.83 }), answeredRight({ score: 0.5 })], [false, true, true, false])
})

test('an answer that is not fully right makes its question a mistake, due from the next day', () => {
  const book = noteAnswer([], answerTo(PRIME, { id: 'evd_aaaaaa01', at: on(3, 22, 30), score: 0, correct: false, response: 'a' }), PRIME)
  assert.equal(book.length, 1)
  assert.deepEqual(book[0].item, PRIME, 'with the question as it was answered')
  assert.deepEqual([book[0].key, book[0].sig, book[0].source, book[0].lessonId, book[0].firstAt], [keyOf(PRIME), itemSig(PRIME), placeOf(PRIME), LESSON, iso(on(3, 22, 30))])
  assert.deepEqual(mistakeState(book[0]), { wrong: 1, lastWrongAt: iso(on(3, 22, 30)), response: 'a', score: 0, dueAt: dayStart(4), resolvedAt: null })
  assert.deepEqual(dueMistakes(book, on(3, 23, 59)), [], 'not again the same day')
  assert.deepEqual(dueMistakes(book, new Date(2026, 10, 4).getTime()), book, 'due from the start of the next day')

  // Partly right counts as not right; a right answer to a question not in
  // the book, or a wrong one without the question, changes nothing.
  const partly = noteAnswer(book, answerTo(EVEN, { id: 'evd_aaaaaa02', at: on(3, 22, 31), score: 0.5, correct: false, response: ['a'] }), EVEN)
  assert.deepEqual(partly.map(entry => entry.key), [keyOf(PRIME), keyOf(EVEN)])
  assert.equal(noteAnswer(book, answerTo(EVEN, { at: on(3, 22, 32), score: 1, correct: true, response: ['a', 'c'] }), EVEN), null)
  assert.equal(noteAnswer(book, answerTo(SHORT, { at: on(3, 22, 33), score: 0.2, correct: false, response: '不知道' })), null)
  // A question written anew in the same place is another question.
  const anew = { ...PRIME, prompt: '下列哪个是合数？', answer: 'a' }
  const both = noteAnswer(book, { ...answerTo(anew, { at: on(3, 22, 34), score: 0, correct: false, response: 'b' }) }, anew)
  assert.deepEqual(both.map(entry => [entry.key, entry.sig]), [[keyOf(PRIME), itemSig(PRIME)], [keyOf(PRIME), itemSig(anew)]])
})

test('only a right answer on a later day resolves a mistake, and a wrong one opens it again', () => {
  let book = noteAnswer([], answerTo(PRIME, { id: 'evd_aaaaaa01', at: on(3, 10), score: 0, correct: false, response: 'a' }), PRIME)
  // Right again the same day, just after seeing the answer: still open.
  book = noteAnswer(book, answerTo(PRIME, { id: 'evd_aaaaaa02', at: on(3, 10, 5), score: 1, correct: true, response: 'b' }))
  assert.equal(book[0].attempts.length, 2)
  assert.deepEqual([mistakeState(book[0]).resolvedAt, mistakeState(book[0]).dueAt], [null, dayStart(4)])
  // Right the next day: resolved.
  book = noteAnswer(book, answerTo(PRIME, { id: 'evd_aaaaaa03', at: on(4, 9), score: 1, correct: true, response: 'b' }))
  assert.equal(mistakeState(book[0]).resolvedAt, iso(on(4, 9)))
  assert.deepEqual(dueMistakes(book, on(9)), [])
  // Later right answers change nothing; neither does the same answer twice.
  assert.equal(noteAnswer(book, answerTo(PRIME, { id: 'evd_aaaaaa04', at: on(6), score: 1, correct: true, response: 'b' })), null)
  assert.equal(noteAnswer(book, answerTo(PRIME, { id: 'evd_aaaaaa03', at: on(4, 9), score: 1, correct: true, response: 'b' })), null)
  // Wrong again a few days later: open again, due the day after.
  book = noteAnswer(book, answerTo(PRIME, { id: 'evd_aaaaaa05', at: on(8, 20), score: 0, correct: false, response: 'c' }))
  assert.deepEqual(mistakeState(book[0]), { wrong: 2, lastWrongAt: iso(on(8, 20)), response: 'c', score: 0, dueAt: dayStart(9), resolvedAt: null })
  assert.equal(book[0].firstAt, iso(on(3, 10)))
})

test('a mistake keeps its latest answers and its last wrong one; the book keeps the open ones first', () => {
  // One wrong answer, then right ones the same day: the wrong one stays.
  let book = noteAnswer([], answerTo(PRIME, { id: 'evd_w', at: on(3, 8), score: 0, correct: false, response: 'a' }), PRIME)
  for (let minute = 1; minute <= ATTEMPTS_KEPT + 1; minute += 1) book = noteAnswer(book, answerTo(PRIME, { id: `evd_r${minute}`, at: on(3, 8, minute), score: 1, correct: true, response: 'b' }))
  assert.equal(book[0].attempts.length, ATTEMPTS_KEPT)
  assert.deepEqual([book[0].attempts[0].id, book[0].attempts[1].id], ['evd_w', 'evd_r3'])
  assert.deepEqual([mistakeState(book[0]).wrong, mistakeState(book[0]).resolvedAt], [1, null])
  // Wrong answers past the limit are still counted.
  let wrong = []
  for (let minute = 0; minute < ATTEMPTS_KEPT + 2; minute += 1) wrong = noteAnswer(wrong, answerTo(PRIME, { id: `evd_${minute}`, at: on(3, 9, minute), score: 0, correct: false, response: 'a' }), PRIME)
  assert.deepEqual([wrong[0].attempts.length, wrong[0].wrongBefore, mistakeState(wrong[0]).wrong], [ATTEMPTS_KEPT, 2, ATTEMPTS_KEPT + 2])

  // Past the book's limit the oldest resolved ones go first.
  let full = []
  const question = n => ({ ...PRIME, id: `q${n}`, prompt: `第 ${n} 题` })
  for (let n = 0; n < 55; n += 1) {
    full = noteAnswer(full, answerTo(question(n), { at: on(3, 10, n), score: 0, correct: false, response: 'a' }), question(n))
    full = noteAnswer(full, answerTo(question(n), { at: on(4, 10, n), score: 1, correct: true, response: 'b' }))
  }
  for (let n = 55; n < MISTAKES_KEPT + 5; n += 1) full = noteAnswer(full, answerTo(question(n), { at: on(5, 10, n % 60), score: 0, correct: false, response: 'a' }), question(n))
  assert.equal(full.length, MISTAKES_KEPT)
  assert.equal(full.filter(entry => !mistakeState(entry).resolvedAt).length, MISTAKES_KEPT - 50)
  assert.deepEqual(['q0', 'q4', 'q5'].map(id => full.some(entry => entry.item.id === id)), [false, false, true], 'the five resolved longest ago went')
})

test('a fixed question fixes its mistakes, and an answer right under the fix leaves the book', () => {
  // The stored key was wrong: 23 marked wrong, 25 too.
  const broken = { ...PRIME, answer: 'a', explanation: '21 是质数。' }
  const fixed = { ...PRIME, fixed: { was: { answer: 'a', explanation: '21 是质数。' }, at: iso(on(3, 12)) } }
  let book = noteAnswer([], answerTo(broken, { id: 'evd_aaaaaa01', at: on(3, 10), score: 0, correct: false, response: 'b' }), broken)
  const fix = { key: keyOf(PRIME), before: broken, item: fixed, fixed: true, verdict: 'wrong' }
  assert.deepEqual(fixMistakes(book, fix), [], 'right under the fixed key: no mistake at all')
  book = noteAnswer(book, answerTo(broken, { id: 'evd_aaaaaa02', at: on(3, 10, 1), score: 0, correct: false, response: 'c' }))
  const after = fixMistakes(book, fix)
  assert.equal(after.length, 1)
  assert.deepEqual([after[0].item, after[0].sig, after[0].attempts.map(attempt => attempt.correct)], [fixed, itemSig(fixed), [true, false]])
  assert.deepEqual([mistakeState(after[0]).wrong, mistakeState(after[0]).response], [1, 'c'])
  assert.equal(fixMistakes(after, fix), null, 'fixed once')
  // Other questions, and another version of this one, are left alone.
  const other = noteAnswer([], answerTo(EVEN, { at: on(3, 10), score: 0.5, correct: false, response: ['a'] }), EVEN)
  assert.equal(fixMistakes(other, fix), null)

  // An open answer the check graded again, by its evidence id.
  const open = noteAnswer([], answerTo(SHORT, { id: 'evd_aaaaaa09', at: on(3, 11), score: 0.2, correct: false, response: '质量约掉了' }), SHORT)
  assert.deepEqual(fixMistakes(open, { key: keyOf(SHORT), before: SHORT, item: SHORT, fixed: false, verdict: 'misgraded', answers: [{ id: 'evd_aaaaaa09', score: 0.9, correct: true }] }), [])
  assert.equal(fixMistakes(open, { key: keyOf(SHORT), before: SHORT, item: SHORT, fixed: true, verdict: 'wrong' }), null, 'an open answer only takes a grade it is given')

  // An answer the fix turned wrong makes the question a mistake.
  const made = fixMistakes([], { ...fix, answers: [{ id: 'evd_aaaaaa07', at: iso(on(3, 9)), response: 'a', score: 0, correct: false }], place: { source: placeOf(PRIME), lessonId: LESSON } })
  assert.deepEqual([made[0].key, made[0].sig, made[0].item, made[0].source, made[0].conceptIds, mistakeState(made[0]).response], [keyOf(PRIME), itemSig(fixed), fixed, placeOf(PRIME), PRIME.conceptIds, 'a'])
})

test('the book is listed with each mistake\'s state and its last wrong answer in words', () => {
  let book = noteAnswer([], answerTo(PRIME, { at: on(3, 10), score: 0, correct: false, response: 'c' }), PRIME)
  book = noteAnswer(book, answerTo(EVEN, { at: on(2, 10), score: 0.5, correct: false, response: ['a'] }), EVEN)
  book = noteAnswer(book, answerTo(SHORT, { at: on(1, 10), score: 0.2, correct: false, response: `  回复力\n  抵消了${'很长'.repeat(80)}` }), SHORT)
  book = noteAnswer(book, answerTo(SHORT, { at: on(2, 9), score: 1, correct: true, response: '抵消' }))
  const rows = listMistakes(book)
  assert.deepEqual(rows.map(row => [row.prompt, row.answer.slice(0, 8), row.figure, row.wrong, row.dueAt, row.resolvedAt]), [
    [EVEN.prompt, 'A. 2', true, 1, dayStart(3), null],
    [PRIME.prompt, 'C. 25', false, 1, dayStart(4), null],
    [SHORT.prompt, '回复力 抵消了很', false, 1, dayStart(2), iso(on(2, 9))],
  ], 'open ones the longest due first, then the resolved ones')
  assert.equal([...rows[2].answer].length, 121, 'a long answer is clipped')
  assert.ok(rows.every(row => !('item' in row) && !('attempts' in row)), 'without the question\'s figure or the answers')
})

test('the course page counts due mistakes as reviews and names the days', () => {
  const t = (key, values = {}) => `${key}${Object.keys(values).length ? JSON.stringify(values) : ''}`
  const now = on(5, 10)
  const rows = [{ dueAt: dayStart(5), resolvedAt: null }, { dueAt: dayStart(6), resolvedAt: null }, { dueAt: dayStart(4), resolvedAt: iso(on(4, 9)) }]
  assert.equal(mistakesDue(rows, now), 1)
  assert.deepEqual(rows.map(row => mistakeWhen(t, row, now)), ['mistakeDueNow', 'mistakeDueOn{"day":"dayTomorrow"}', 'mistakeResolvedOn{"day":"monthDay{\\"month\\":11,\\"day\\":4}"}'])
  assert.equal(dayName(t, on(5, 23), now), 'dayToday')
  const course = { units: [{ id: 'unt_a', lectures: [{ id: 'lec_a', lessons: [{ id: 'les_a', title: '配方', concepts: [{ id: 'cpt_a', name: '开方' }] }] }] }] }
  assert.deepEqual(courseNextStep(course, { lessons: {}, concepts: {}, reviews: {} }, { now, mistakes: 2 }), { kind: 'review', count: 0, mistakes: 2 })
  assert.deepEqual(courseNextStep(course, { lessons: {}, concepts: {}, reviews: { cpt_a: { dueAt: dayStart(5) } } }, { now }), { kind: 'review', count: 1 })
})

test('the browser says which question was answered and whether it was right', async () => {
  const seen = []
  const keep = name => request => { seen.push([name, request]); return name === 'review' ? { items: [] } : {} }
  const routes = createRoutes({ lessons: { record: keep('record'), challengeItem: keep('challenge') }, learner: { reviewSession: keep('review') } })
  const courseId = newId('crs')
  const lessonId = newId('les')
  const source = { kind: 'practice', courseId, lessonId, itemId: 'i1' }
  await routes['lesson/record']({ courseId, lessonId, evidence: { kind: 'practice', score: 0.5, correct: false }, source, response: 'b', sig: '1x2y3z' })
  await routes['lesson/record']({ courseId, lessonId, evidence: { kind: 'practice', score: 1, correct: 'yes' }, source, response: 'b', sig: '../x' })
  await routes['item/challenge']({ source, response: 'b', sig: 'k9' })
  await routes['item/challenge']({ source, response: 'b', sig: 7 })
  await routes['review/session']({ courseId, mistakes: true })
  await routes['review/session']({ mistakes: 'yes' })
  assert.deepEqual([seen[0][1].item, seen[0][1].evidence.correct], [{ source, response: 'b', sig: '1x2y3z' }, false])
  assert.deepEqual([seen[1][1].item, seen[1][1].evidence.correct], [{ source, response: 'b' }, undefined], 'a sig or a verdict it cannot read is left out')
  assert.deepEqual([seen[2][1].sig, 'sig' in seen[3][1]], ['k9', false])
  assert.deepEqual(seen.slice(4).map(([, request]) => request), [{ courseId, mistakes: true }, { courseId: undefined, mistakes: false }])
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

// A model for the course flow whose checks of a question or a step answer
// what the test sets. The stored key of the prime question is wrong (21),
// and so is the board check's (2 + 3 × 4 = 20).
function courseLlm() {
  let itemVerdict = () => ({ verdict: 'right', summary: '没错。', explanation: '…' })
  let stepVerdict = () => ({ verdict: 'right', summary: '没错。', fixes: [] })
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零基础', '学过'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [
        { kind: 'choice', prompt: PRIME.prompt, options: ['21', '23', '25'], answer: 0, explanation: '21 是质数。', conceptIds: [concept] },
        { kind: 'short', prompt: SHORT.prompt, answer: SHORT.answer, conceptIds: [concept] },
        { kind: 'number', prompt: '$3 \\times 7$ 等于多少？', answer: 21, conceptIds: [concept] },
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
      const wanted = Number(/at least (\d+) and at most/u.exec(user)?.[1] ?? 3)
      return JSON.stringify({ items: Array.from({ length: wanted + 2 }, (_, index) => ({ kind: 'number', prompt: `$${index + 2} \\times 3$ 等于多少？`, answer: (index + 2) * 3, conceptIds: [concept] })) })
    }
    if (user.includes('Decide which is true')) return JSON.stringify(itemVerdict(user))
    if (user.includes('Decide whether step')) return JSON.stringify(stepVerdict(user))
    if (user.includes('<check_result>')) return JSON.stringify({ say: '核对过了。', ops: [{ t: 'p', text: '核对' }] })
    return '{}'
  }
  return {
    supportsImages: () => false,
    setItemVerdict(next) { itemVerdict = () => next },
    setStepVerdict(next) { stepVerdict = () => next },
    async complete(request) { return answer(request) },
    async stream(request) {
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

async function withCourse(run) {
  const root = await mkdtemp(join(tmpdir(), 'aha-mistakes-'))
  const jobs = createJobs()
  try {
    const clock = { at: on(3, 9) }
    const now = () => new Date(clock.at)
    const store = createStore({ root: join(root, 'data') })
    const llm = courseLlm()
    const learner = createLearner({ store, llm, now })
    const courses = createCourses({ store, llm, jobs, now })
    const lessons = createLessons({ store, llm, jobs, courses, learner, now })
    const { courseId } = await finish(jobs, courses.startCraft({ goal: '质数' }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const unit = course.units[0]
    const [first, second] = unit.lectures[0].lessons
    const practice = (await store.readJson(store.paths.practice(courseId, first.id), null)).items
    await finish(jobs, (await lessons.prepare({ courseId, lessonId: second.id })).job)
    const board = await store.readJson(store.paths.board(courseId, second.id), null)
    // An answer as the practice screen or the classroom records it, a
    // minute after the last.
    const answer = async (item, source, response, grade, kind = source.kind === 'check' ? 'check' : source.kind) => {
      clock.at += 60_000
      return lessons.record({ courseId, lessonId: source.lessonId, conceptIds: item.conceptIds, evidence: { kind, ...grade }, item: { source: { ...source, courseId }, response, sig: itemSig(item) } })
    }
    const book = async () => (await store.readJson(store.paths.mistakes(courseId), null))?.items ?? []
    await run({ clock, store, llm, jobs, courses, learner, lessons, courseId, unit, first, second, practice, check: board.steps[2].check, answer, book })
  } finally {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

const WRONG = { score: 0, correct: false, confidence: 'sure' }
const RIGHT = { score: 1, correct: true, confidence: 'sure' }

test('answers anywhere in a course go to its book, come back in reviews from the next day and are resolved there', () => withCourse(async ({ clock, store, jobs, courses, learner, lessons, courseId, unit, first, second, practice, check, answer, book }) => {
  const [prime, short] = practice
  const primeAt = { kind: 'practice', lessonId: first.id, itemId: prime.id }
  const checkAt = { kind: 'check', lessonId: second.id, stepId: 's3' }
  const quiz = (await finish(jobs, (await lessons.unitQuiz({ courseId, unitId: unit.id })).job)).quiz.items
  const quizAt = { kind: 'quiz', unitId: unit.id, itemId: quiz[0].id }

  // Practice, the classroom check and the unit quiz, wrong; an open answer
  // only partly right; and a right answer, which changes nothing.
  const recorded = await answer(prime, primeAt, 'c', WRONG)
  assert.match(recorded.evidenceId, /^evd_/u)
  await answer(check, checkAt, '14', WRONG)
  await answer(quiz[0], quizAt, '5', WRONG)
  await answer(short, { kind: 'practice', lessonId: first.id, itemId: short.id }, '质量约掉了', { score: 0.5, correct: false, confidence: 'unsure' })
  const before = JSON.stringify(await book())
  await answer(practice[2], { kind: 'practice', lessonId: first.id, itemId: practice[2].id }, '21', RIGHT)
  assert.equal(JSON.stringify(await book()), before)

  const kept = await book()
  assert.deepEqual(kept.map(entry => entry.key), [`practice:${first.id}:${prime.id}`, `check:${second.id}:s3`, `quiz:${unit.id}:${quiz[0].id}`, `practice:${first.id}:${short.id}`])
  assert.deepEqual(kept.map(entry => entry.item), [prime, check, quiz[0], short], 'each with its question')
  assert.deepEqual([kept[0].source, kept[0].attempts[0].id, kept[2].unitId, kept[2].lessonId], [primeAt, recorded.evidenceId, unit.id, null])
  const progress = await store.readJson(store.paths.progress(courseId), null)
  assert.equal(progress.evidenceLog.find(entry => entry.id === recorded.evidenceId).item.sig, itemSig(prime), 'the log says which question was answered')

  // The course page lists them; none is due the same day.
  const listed = (await courses.get({ courseId })).mistakes
  assert.deepEqual(listed.map(row => [row.kind, row.answer, row.wrong, row.dueAt, row.resolvedAt]), [
    ['choice', 'C. 25', 1, dayStart(4), null],
    ['number', '14', 1, dayStart(4), null],
    ['number', '5', 1, dayStart(4), null],
    ['short', '质量约掉了', 1, dayStart(4), null],
  ], 'in the order a round takes them')
  assert.deepEqual(await learner.reviewSession({ courseId, mistakes: true }), { items: [], more: 0 })

  // The next morning a round holds all four, each with where it is kept.
  clock.at = on(4, 8)
  const round = await learner.reviewSession({ courseId, mistakes: true })
  assert.deepEqual(round.items.map(entry => entry.item), [prime, check, quiz[0], short])
  assert.deepEqual(round.items[0].source, { ...primeAt, courseId })
  assert.deepEqual([round.items[0].mistake.wrong, round.items[0].conceptName, round.items[1].lessonTitle, round.more], [1, first.concepts[0].name, second.title, 0])
  // A review session draws them first.
  const review = await learner.reviewSession({ courseId })
  assert.deepEqual(review.items.slice(0, 4).map(entry => entry.item), [prime, check, quiz[0], short])

  // Right again: resolved. Wrong again: open, due the day after.
  await answer(prime, primeAt, 'b', RIGHT)
  await answer(check, checkAt, '15', WRONG)
  const after = await book()
  assert.equal(mistakeState(after[0]).resolvedAt, iso(clock.at - 60_000))
  assert.deepEqual([mistakeState(after[1]).wrong, mistakeState(after[1]).dueAt], [2, dayStart(5)])
  assert.deepEqual((await learner.reviewSession({ courseId, mistakes: true })).items.map(entry => entry.item), [quiz[0], short])
  const rows = (await courses.get({ courseId })).mistakes
  assert.deepEqual([rows.at(-1).key, rows.at(-1).resolvedAt !== null], [`practice:${first.id}:${prime.id}`, true], 'the resolved one is listed last')
}))

test('a round holds at most ten due mistakes, and says how many more are due', () => withCourse(async ({ clock, jobs, learner, lessons, courseId, unit, answer }) => {
  const quiz = (await finish(jobs, (await lessons.unitQuiz({ courseId, unitId: unit.id })).job)).quiz.items
  assert.ok(quiz.length > MISTAKE_ROUND, 'the quiz has enough questions')
  for (const item of quiz) await answer(item, { kind: 'quiz', unitId: unit.id, itemId: item.id }, '0', WRONG)
  clock.at = on(4, 8)
  const round = await learner.reviewSession({ courseId, mistakes: true })
  assert.deepEqual([round.items.length, round.more], [MISTAKE_ROUND, quiz.length - MISTAKE_ROUND])
  assert.deepEqual(round.items.map(entry => entry.item.id), quiz.slice(0, MISTAKE_ROUND).map(item => item.id), 'the longest due first')
  assert.equal((await learner.reviewSession({ courseId })).items.length, 8, 'a review session stays at eight')
}))

test('a review session gives a due concept its question answered longest ago, never an open mistake', () => withCourse(async ({ clock, store, learner, courseId, first, practice, answer }) => {
  const [prime, , times] = practice
  const at = item => ({ kind: 'practice', lessonId: first.id, itemId: item.id })
  const concept = first.concepts[0].id
  // The concept's review brought forward to now.
  const due = () => store.updateJson(store.paths.progress(courseId), null, progress => {
    progress.reviews[concept].dueAt = iso(clock.at - 1000)
    return progress
  })
  const pick = async () => (await learner.reviewSession({ courseId })).items.filter(entry => entry.conceptId === concept).map(entry => entry.item.id)
  await answer(times, at(times), '21', RIGHT)
  await answer(prime, at(prime), 'a', RIGHT)
  await due()
  assert.deepEqual(await pick(), [times.id], 'answered longest ago')
  await answer(times, at(times), '21', RIGHT)
  await due()
  assert.deepEqual(await pick(), [prime.id])
  // Wrong now, the prime question is an open mistake, not asked again today.
  await answer(prime, at(prime), 'b', WRONG)
  await due()
  assert.deepEqual(await pick(), [times.id])
}))

test('a check that fixes a question fixes its mistakes; an answer right under the fix leaves the book', () => withCourse(async ({ jobs, llm, lessons, courseId, first, second, practice, check, answer, book }) => {
  const [prime] = practice
  const primeAt = { kind: 'practice', lessonId: first.id, itemId: prime.id }
  // 23 and 25 against the wrong key (21), then 23 is challenged.
  await answer(prime, primeAt, 'c', WRONG)
  const { evidenceId } = await answer(prime, primeAt, 'b', WRONG)
  const written = { kind: 'choice', prompt: PRIME.prompt, options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }], answer: 'b', explanation: '21 = 3 × 7。' }
  llm.setItemVerdict({ verdict: 'wrong', summary: '23 才是质数。', explanation: '…', item: written })
  const result = await finish(jobs, lessons.challengeItem({ source: { ...primeAt, courseId }, response: 'b', shown: { score: 0, correct: false }, evidenceId, sig: itemSig(prime) }))
  assert.equal(result.result.correct, true)
  const [entry] = await book()
  // 23 is right now; 25 is still wrong, against the fixed question.
  assert.deepEqual([entry.item.answer, entry.item.fixed.was.answer, entry.sig], ['b', 'a', itemSig(result.item)])
  assert.deepEqual(entry.attempts.map(attempt => [attempt.response, attempt.correct]), [['c', false], ['b', true]])
  assert.deepEqual([mistakeState(entry).wrong, mistakeState(entry).response], [1, 'c'])

  // A fix of the board's check from the classroom ("这一步不对？"): the
  // answer 14 was right all along, so the mistake goes.
  await answer(check, { kind: 'check', lessonId: second.id, stepId: 's3' }, '14', WRONG)
  assert.equal((await book()).length, 2)
  llm.setStepVerdict({ verdict: 'wrong', summary: '先乘后加，是 14。', fixes: [{ step: 's3', check: { kind: 'number', prompt: check.prompt, answer: 14 } }] })
  await finish(jobs, lessons.challenge({ scope: { kind: 'lesson', courseId, lessonId: second.id }, stepIndex: 2, target: { stepId: 's3' } }))
  assert.deepEqual((await book()).map(item => item.key), [`practice:${first.id}:${prime.id}`])
}))

test('a question written anew in the same place is another question, and its old mistake is fixed in the book', () => withCourse(async ({ clock, jobs, llm, store, learner, lessons, courseId, second, check, answer, book }) => {
  const checkAt = { kind: 'check', lessonId: second.id, stepId: 's3' }
  await answer(check, checkAt, '14', WRONG)
  // The board is written again; step s3 now asks something else.
  const path = store.paths.board(courseId, second.id)
  const anew = { ...check, prompt: '$(2 + 3) \\times 4$ 等于多少？', answer: 20 }
  const board = await store.readJson(path, null)
  board.steps[2].check = anew
  await store.writeJson(path, board)
  await answer(anew, checkAt, '20', RIGHT)
  assert.deepEqual((await book()).map(entry => [entry.sig, entry.attempts.length]), [[itemSig(check), 1]], 'a right answer to the new question is not one to the old')
  await answer(anew, checkAt, '14', WRONG)
  assert.deepEqual((await book()).map(entry => entry.sig), [itemSig(check), itemSig(anew)])

  // The next day both come back, the old one as it was asked.
  clock.at = on(4, 8)
  const round = await learner.reviewSession({ courseId, mistakes: true })
  assert.deepEqual(round.items.map(entry => entry.item.prompt), [check.prompt, anew.prompt])
  // Challenged from the round, the old question is fixed in the book only.
  llm.setItemVerdict({ verdict: 'wrong', summary: '先乘后加，是 14。', explanation: '…', item: { kind: 'number', prompt: check.prompt, answer: 14 } })
  const result = await finish(jobs, lessons.challengeItem({ source: { ...checkAt, courseId }, response: '14', shown: { score: 0, correct: false }, sig: itemSig(check) }))
  assert.deepEqual([result.verdict, result.item.answer, result.result.correct], ['wrong', 14, true])
  assert.deepEqual((await store.readJson(path, null)).steps[2].check, anew, 'the board keeps its new question')
  assert.deepEqual((await book()).map(entry => entry.sig), [itemSig(anew)], 'the old mistake was right all along')
}))

test('a question fixed twice still grades the answers given before the first fix', () => withCourse(async ({ jobs, llm, store, lessons, courseId, first, practice, answer, book }) => {
  const [prime] = practice
  const at = { kind: 'practice', lessonId: first.id, itemId: prime.id }
  const options = [{ id: 'a', text: '21' }, { id: 'b', text: '23' }, { id: 'c', text: '25' }]
  const { evidenceId: before } = await answer(prime, at, 'b', WRONG)
  // First the wording is fixed (the key still says 21)…
  llm.setItemVerdict({ verdict: 'unclear', summary: '题目没说清。', explanation: '…', item: { kind: 'choice', prompt: '下列哪个数是质数？', options, answer: 'a', explanation: '21 是质数。' } })
  const once = await finish(jobs, lessons.challengeItem({ source: { ...at, courseId }, response: 'b', shown: { score: 0, correct: false }, evidenceId: before, sig: itemSig(prime) }))
  assert.equal(once.result, null, 'still wrong under that key')
  const reworded = once.item
  const log = async () => (await store.readJson(store.paths.progress(courseId), null)).evidenceLog
  assert.equal((await log()).find(entry => entry.id === before).item.sig, itemSig(reworded), 'the answer counts as one to the fixed question')
  assert.deepEqual((await book()).map(entry => entry.sig), [itemSig(reworded)])
  // …then, answered again, the key.
  const { evidenceId: after } = await answer(reworded, at, 'b', WRONG)
  llm.setItemVerdict({ verdict: 'wrong', summary: '23 才是质数。', explanation: '…', item: { kind: 'choice', prompt: '下列哪个数是质数？', options, answer: 'b', explanation: '21 = 3 × 7。' } })
  const twice = await finish(jobs, lessons.challengeItem({ source: { ...at, courseId }, response: 'b', shown: { score: 0, correct: false }, evidenceId: after, sig: itemSig(reworded) }))
  assert.deepEqual([twice.result.correct, twice.earlier], [true, 1], 'the answer from before the first fix too')
  assert.deepEqual((await log()).filter(entry => entry.item?.key === `practice:${first.id}:${prime.id}`).map(entry => [entry.evidence.score, entry.item.sig]), [[1, itemSig(twice.item)], [1, itemSig(twice.item)]])
  assert.deepEqual(await book(), [], 'both answers were right')
}))
