import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { newId } from '../src/core/ids.js'
import { itemSig } from '../src/core/mistakes.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons, DRILL_SIZE } from '../src/host/lessons.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { explainRequest, itemSource } from '../src/ui/item-check.js'

// Times on the learner's own calendar (November 2026), whatever the zone the
// tests run in.
const on = (day, hour = 10, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

const blueprint = {
  title: '数的性质',
  emoji: '🔢',
  summary: '质数与运算顺序。',
  level: 'beginner',
  units: [{ title: '整数', lectures: [{ title: '质数', lessons: [{ title: '认识质数', objectives: ['判断质数'], concepts: ['质数'], estMinutes: 12 }, { title: '运算顺序', concepts: ['运算顺序'], estMinutes: 10 }] }] }],
  projects: [],
}

// A model for the course flow that writes sets on one concept and boards
// for 「讲这题」, and keeps every prompt it was given.
function courseLlm() {
  const prompts = []
  let drills = 0
  const answer = ({ user }) => {
    prompts.push(user)
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零基础', '学过'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [
        { kind: 'choice', prompt: '下列哪个是质数？', options: ['21', '23', '25'], answer: 1, explanation: '23 只有两个因数。', conceptIds: [concept] },
        { kind: 'number', prompt: '$3 \\times 7$ 等于多少？', answer: 21, conceptIds: [concept] },
      ] }])) })
    }
    if (user.includes('Write exactly')) {
      drills += 1
      const concept = /<concept>\n(cpt_[a-z0-9]+)=/u.exec(user)?.[1]
      // Two more than asked for: the set keeps DRILL_SIZE, spread evenly.
      return JSON.stringify({ items: Array.from({ length: DRILL_SIZE + 2 }, (_, index) => ({ kind: 'number', prompt: `第 ${drills} 组第 ${index + 1} 题：$${index + 2} \\times ${drills + 2}$ 等于多少？`, answer: (index + 2) * (drills + 2), explanation: '乘一乘。', conceptIds: [concept, 'cpt_unknown'] })) })
    }
    if (user.includes('Explain this one question')) {
      const concept = /<concepts>\n(cpt_[a-z0-9]+)=/u.exec(user)?.[1]
      return [
        { say: '我们来看这道题。', ops: [{ t: 'title', text: '判断质数' }] },
        { say: '你选了 25，它能被 5 整除。', ops: [{ t: 'p', text: '25 = 5 × 5' }] },
        { say: '试一道同类题。', ops: [{ t: 'p', text: '同类题' }], check: { kind: 'choice', prompt: '下列哪个是质数？', options: ['27', '29', '33'], answer: 1, conceptIds: concept ? [concept, 'cpt_unknown'] : [] } },
      ].map(line => JSON.stringify(line)).join('\n')
    }
    if (user.includes('Decide which is true')) return JSON.stringify({ verdict: 'right', summary: '没错。', explanation: '题目没问题。' })
    return '{}'
  }
  return {
    prompts,
    drillPrompts: () => prompts.filter(user => user.includes('Write exactly')),
    explainPrompts: () => prompts.filter(user => user.includes('Explain this one question')),
    supportsImages: () => false,
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
  const root = await mkdtemp(join(tmpdir(), 'aha-drill-'))
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
    const first = course.units[0].lectures[0].lessons[0]
    const concept = first.concepts[0]
    const practice = (await store.readJson(store.paths.practice(courseId, first.id), null)).items
    // An answer as the practice screen records it, a minute after the last.
    const answer = async (item, source, response, grade) => {
      clock.at += 60_000
      return lessons.record({ courseId, lessonId: source.lessonId ?? first.id, conceptIds: item.conceptIds, evidence: { kind: 'practice', ...grade }, item: { source: { ...source, courseId }, response, sig: itemSig(item) } })
    }
    const book = async () => (await store.readJson(store.paths.mistakes(courseId), null))?.items ?? []
    await run({ clock, store, llm, jobs, courses, learner, lessons, courseId, course, first, concept, practice, answer, book })
  } finally {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

const WRONG = { score: 0, correct: false, confidence: 'sure' }

test('a set on one concept is written for it, pitched at the learner and kept until they answer it', () => withCourse(async ({ store, llm, jobs, courses, lessons, courseId, first, concept, practice, answer, book }) => {
  const [prime] = practice
  await answer(prime, { kind: 'practice', lessonId: first.id, itemId: prime.id }, 'c', { ...WRONG, errorTag: '把 25 当成了质数' })

  const started = await lessons.conceptDrill({ courseId, conceptId: concept.id })
  assert.ok(started.job, 'the first set is written')
  assert.equal((await lessons.conceptDrill({ courseId, conceptId: concept.id })).job.id, started.job.id, 'asking again while it is written waits for the same set')
  const { drill } = await finish(jobs, started.job)
  assert.equal(drill.items.length, DRILL_SIZE, 'as many questions as a set holds, thinned evenly')
  assert.deepEqual(drill.items.map(item => item.id), ['r1i1', 'r1i2', 'r1i3', 'r1i4', 'r1i5'])
  assert.ok(drill.items.every(item => item.conceptIds.length === 1 && item.conceptIds[0] === concept.id), 'every question counts toward the concept alone')
  assert.deepEqual([drill.conceptName, drill.lessonId, drill.round, 'earlier' in drill], [concept.name, first.id, 1, false])

  const [asked] = llm.drillPrompts()
  assert.match(asked, new RegExp(`Write exactly ${DRILL_SIZE} questions`, 'u'))
  assert.match(asked, /The learner is weak on it/u, 'pitched at the learner\'s stage')
  assert.match(asked, /<misconceptions>\n把 25 当成了质数/u, 'aimed at what their answers showed')
  assert.match(asked, /<earlier_questions>\n1\. 下列哪个是质数？/u, 'and clear of the questions on it they have met')

  // Not answered yet: the same set comes back, with no model call.
  const again = await lessons.conceptDrill({ courseId, conceptId: concept.id })
  assert.deepEqual([again.job, again.drill?.items.map(item => item.id)], [undefined, drill.items.map(item => item.id)])
  assert.equal(llm.drillPrompts().length, 1)

  // An answer uses the set: a wrong one goes to the book under the concept's lesson.
  const [question] = drill.items
  const source = { kind: 'drill', conceptId: concept.id, itemId: question.id }
  await answer(question, source, '7', WRONG)
  assert.ok((await store.readJson(store.paths.drill(courseId, concept.id), null)).startedAt)
  const mistake = (await book()).find(entry => entry.key === `drill:${concept.id}:${question.id}`)
  assert.deepEqual([mistake?.source, mistake?.lessonId, mistake?.item.prompt], [source, first.id, question.prompt])
  const listed = (await courses.get({ courseId })).mistakes.find(row => row.source?.kind === 'drill')
  assert.equal(listed?.prompt, question.prompt, 'the course page lists it')

  // The next set is new, asks none of the first set's questions, and keeps them to stay clear of.
  const next = (await finish(jobs, (await lessons.conceptDrill({ courseId, conceptId: concept.id })).job)).drill
  assert.deepEqual([next.round, next.items[0].id], [2, 'r2i1'])
  assert.match(llm.drillPrompts()[1], /第 1 组第 1 题/u)
  assert.deepEqual((await store.readJson(store.paths.drill(courseId, concept.id), null)).earlier, drill.items.map(item => item.prompt))
  // 「再来一组」 writes one at once, even before an answer.
  const fresh = (await finish(jobs, (await lessons.conceptDrill({ courseId, conceptId: concept.id, fresh: true })).job)).drill
  assert.deepEqual([fresh.round, fresh.items[0].id], [3, 'r3i1'])
  await assert.rejects(lessons.conceptDrill({ courseId, conceptId: newId('cpt') }), { code: 'not-found' })
}))

test('a question from a set is found where it is kept: checked there, and back in reviews from the next day', () => withCourse(async ({ clock, jobs, learner, lessons, courseId, first, concept, answer }) => {
  const { drill } = await finish(jobs, (await lessons.conceptDrill({ courseId, conceptId: concept.id })).job)
  const [question] = drill.items
  const source = { kind: 'drill', courseId, conceptId: concept.id, itemId: question.id }
  await answer(question, source, '7', WRONG)
  const checked = await finish(jobs, lessons.challengeItem({ source, response: '7', shown: { score: 0, correct: false }, sig: itemSig(question) }))
  assert.equal(checked.verdict, 'right')

  clock.at = on(4, 9)
  const round = await learner.reviewSession({ courseId, mistakes: true })
  assert.deepEqual(round.items.map(entry => [entry.source, entry.lessonId, entry.lessonTitle, entry.conceptName]), [[source, first.id, first.title, concept.name]])
}))

test('「讲这题」 explains a question at the board from the learner\'s answer and keeps it as a thread', () => withCourse(async ({ store, llm, jobs, lessons, courseId, first, concept, practice, answer }) => {
  const [prime] = practice
  const source = { kind: 'practice', courseId, lessonId: first.id, itemId: prime.id }
  const threadId = newId('thd')
  const result = await finish(jobs, lessons.explainItem({ source, response: 'c', shown: { score: 0, correct: false }, sig: itemSig(prime), newThreadId: threadId }))
  assert.equal(result.threadId, threadId)
  assert.equal(result.board.steps.length, 3)
  assert.deepEqual(result.board.steps[2].check.conceptIds, [concept.id], 'its closing question counts toward the question\'s concepts only')

  const [asked] = llm.explainPrompts()
  assert.match(asked, /<learner_answer>\nC\. 25/u)
  assert.match(asked, /The learner got it wrong/u)
  assert.match(asked, new RegExp(`<concepts>\\n${concept.id}=${concept.name}`, 'u'))
  assert.match(asked, /The last step asks one similar question as its check/u)

  const thread = await store.readJson(store.paths.item('assist', threadId), null)
  assert.deepEqual([thread.title, thread.turns.length, thread.turns[0].mode, thread.turns[0].request], ['判断质数', 1, 'item', prime.prompt], 'found again under instant help, named by its board')

  // A mistake from the book is explained from its last wrong answer.
  await answer(prime, { kind: 'practice', lessonId: first.id, itemId: prime.id }, 'a', WRONG)
  await finish(jobs, lessons.explainItem({ source, book: true, sig: itemSig(prime) }))
  assert.match(llm.explainPrompts()[1], /<learner_answer>\nA\. 21/u)

  // A right answer is explained as one: why it works.
  await finish(jobs, lessons.explainItem({ source, response: 'b', shown: { score: 1, correct: true }, sig: itemSig(prime) }))
  assert.match(llm.explainPrompts()[2], /The learner got it right/u)

  // A library quiz's question has no course: no concepts to count toward.
  const deckId = newId('dck')
  await store.writeJson(store.paths.item('decks', deckId), { id: deckId, kind: 'quiz', title: '资料测验', language: 'zh-CN', materialIds: [], items: [{ ...prime, id: 'i1', conceptIds: [] }], createdAt: new Date().toISOString() })
  const deck = await finish(jobs, lessons.explainItem({ source: { kind: 'deck', deckId, itemId: 'i1' }, response: 'c', shown: { score: 0, correct: false } }))
  assert.deepEqual(deck.board.steps[2].check.conceptIds, [])
  assert.doesNotMatch(llm.explainPrompts()[3], /<concepts>/u)
}))

test('the browser names a set\'s questions and asks 「讲这题」 with what the host needs', async () => {
  const courseId = newId('crs')
  const conceptId = newId('cpt')
  const lessonId = newId('les')
  const item = { id: 'r1i2', kind: 'choice', prompt: '哪个是质数？', options: [{ id: 'a', text: '21' }, { id: 'b', text: '23' }], answer: 'b', conceptIds: [conceptId] }
  assert.deepEqual(itemSource({ courseId, conceptId }, item), { kind: 'drill', courseId, conceptId, itemId: 'r1i2' })
  const graded = { score: 0, correct: false, given: 'a', feedback: '' }
  assert.deepEqual(explainRequest({ courseId, conceptId }, item, graded, { lessonId }), {
    request: { source: { kind: 'drill', courseId, conceptId, itemId: 'r1i2' }, response: 'a', shown: { score: 0, correct: false, partial: false, feedback: '', wrongStep: '', fix: '' }, sig: itemSig(item) },
    record: { courseId, lessonId, conceptIds: [conceptId] },
  })
  const deckId = newId('dck')
  assert.equal(explainRequest({ deckId }, item, graded).record, null, 'a library question counts toward no course')
  assert.equal(explainRequest({}, item, graded), null, 'a question kept nowhere cannot be explained')
  assert.equal(explainRequest({ courseId, conceptId }, item, null), null, 'nor one not answered yet')

  const seen = []
  const keep = name => request => { seen.push([name, request]); return { job: { id: 'job_aaaaaaaa' } } }
  const routes = createRoutes({ lessons: { conceptDrill: keep('drill'), explainItem: keep('explain') } })
  await routes['concept/drill']({ courseId, conceptId, fresh: true })
  await assert.rejects(async () => routes['concept/drill']({ courseId, conceptId: 'cpt_../x' }), { code: 'invalid' })
  const threadId = newId('thd')
  await routes['item/explain']({ source: { kind: 'drill', courseId, conceptId, itemId: 'r1i2' }, response: 'a', shown: { score: 0 }, sig: 'k9', newThreadId: threadId })
  await routes['item/explain']({ source: { kind: 'deck', deckId, itemId: 'i1' }, book: 'yes' })
  await assert.rejects(async () => routes['item/explain']({ source: { kind: 'drill', courseId, conceptId: 'les_aaaaaaaa', itemId: 'i1' } }), { code: 'invalid' })
  assert.deepEqual(seen[0], ['drill', { courseId, conceptId, fresh: true }])
  assert.deepEqual(seen[1][1], { source: { kind: 'drill', courseId, conceptId, itemId: 'r1i2' }, response: 'a', shown: { score: 0, correct: false, partial: false, feedback: '', wrongStep: '', fix: '' }, book: false, newThreadId: threadId, sig: 'k9' })
  assert.deepEqual([seen[2][1].book, seen[2][1].newThreadId, seen[2][1].source], [false, undefined, { kind: 'deck', deckId, itemId: 'i1' }])
})
