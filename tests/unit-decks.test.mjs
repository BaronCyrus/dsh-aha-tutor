import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { exportCoursePack, importCoursePack } from '../src/core/coursepack.js'
import { LIMITS, normalizePractice, unitCardRange, unitConcepts, unitQuizRange } from '../src/core/course-model.js'
import { newId } from '../src/core/ids.js'
import { createCard, deckStatus, review } from '../src/core/srs.js'
import { createCourses } from '../src/host/courses.js'
import { uploadRoute } from '../src/host/http.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '../src/host/materials.js'
import { flashcardsPrompt, quizPrompt } from '../src/host/prompts.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { en, zh } from '../src/ui/i18n.js'

const T0 = Date.parse('2026-10-29T08:00:00.000Z')
const MINUTE = 60_000

const lessonWith = (title, concepts) => ({ title, objectives: [title], concepts, estMinutes: 10 })
const unitOf = counts => ({ lectures: [{ lessons: counts.map((count, index) => ({ concepts: Array.from({ length: count }, (_, at) => ({ id: `cpt_l${index}c${at}aaa`, name: `${index}-${at}` })) })) }] })

test('a unit quiz has at least one question per concept, a deck two to four cards each', () => {
  // A concept taught twice counts once.
  const shared = { id: 'cpt_sharedaa', name: '小数' }
  const unit = { lectures: [{ lessons: [{ concepts: [shared, { id: 'cpt_otheraaa', name: '积' }] }] }, { lessons: [{ concepts: [shared] }] }] }
  assert.deepEqual(unitConcepts(unit).map(concept => concept.id), ['cpt_sharedaa', 'cpt_otheraaa'])
  assert.deepEqual(unitConcepts(null), [])

  assert.deepEqual(unitQuizRange(unitOf([2])), { min: 10, max: 15 }, 'a small unit still gets a real quiz')
  assert.deepEqual(unitQuizRange(unitOf([3, 3, 3, 3])), { min: 12, max: 18 })
  assert.deepEqual(unitQuizRange(unitOf([4, 4, 4, 4, 4])), { min: 20, max: 30 })
  assert.deepEqual(unitQuizRange(unitOf([6, 6, 6, 6, 6, 6])), { min: 30, max: 30 }, 'never more than a quiz holds')

  assert.deepEqual(unitCardRange(unitOf([2])), { min: 8, max: 8 })
  assert.deepEqual(unitCardRange(unitOf([3, 3, 3, 3])), { min: 24, max: 48 })
  assert.deepEqual(unitCardRange(unitOf([6, 6, 6, 6, 6, 6])), { min: 60, max: 60 })

  const items = Array.from({ length: 40 }, (_, index) => ({ kind: 'number', prompt: `${index} + 1 = ?`, answer: index + 1 }))
  assert.equal(normalizePractice({ items }).items.length, LIMITS.practiceItems, 'a lesson\'s practice stays short')
  assert.equal(normalizePractice({ items }, [], LIMITS.quizItems).items.length, 30)
})

test('a deck at a glance: due again, not seen yet', () => {
  const cards = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }]
  const srs = { c1: review(createCard('c1', T0), 'again', T0), c2: review(createCard('c2', T0), 'good', T0), c9: createCard('c9', T0) }
  assert.deepEqual(deckStatus({ cards, srs }, T0 + 11 * MINUTE), { total: 4, due: 1, fresh: 2 }, 'a card no longer in the deck is not counted')
  assert.deepEqual(deckStatus({ cards, srs }, T0), { total: 4, due: 0, fresh: 2 })
  assert.deepEqual(deckStatus(null), { total: 0, due: 0, fresh: 0 })
})

test('quiz and flashcard prompts take a range, or a fixed count for the library', () => {
  const quiz = quizPrompt({ scopeTitle: '小数乘法', outline: 'Unit 1', concepts: 'cpt_a=积的近似数', passages: '[p.12] 例 3', language: 'zh-CN', range: { min: 12, max: 18 } })
  assert.match(quiz.user, /at least 12 and at most 18: at least one question for every concept listed/u)
  assert.match(quiz.user, /<source_passages>\n\[p\.12\] 例 3\n<\/source_passages>/u)
  assert.match(quiz.user, /exercises, notation, units/u)
  const fixed = quizPrompt({ scopeTitle: '小数', outline: '', concepts: '', language: 'zh-CN', count: 10 })
  assert.match(fixed.user, /Write a 10-question quiz across the whole scope\. About 30% recall/u)
  assert.doesNotMatch(fixed.user, /source_passages|exercises, notation/u)

  const cards = flashcardsPrompt({ scopeTitle: '小数乘法', outline: 'Unit 1', concepts: '积的近似数, 小数乘整数', passages: '…', language: 'zh-CN', range: { min: 24, max: 48 } })
  assert.match(cards.user, /at least 24 and at most 48: every concept listed gets two to four cards/u)
  assert.match(cards.user, /<concepts>\n积的近似数, 小数乘整数\n<\/concepts>/u)
  assert.match(flashcardsPrompt({ scopeTitle: '小数', outline: '', passages: '', language: 'zh-CN', count: 24 }).user, /Write 24 flashcards covering/u)
})

// ── on the host ─────────────────────────────────────────────────────────────

const blueprint = {
  title: '五年级数学（上）',
  emoji: '🔢',
  summary: '小数乘法与位置。',
  level: 'beginner',
  units: [
    { title: '小数乘法', lectures: [
      { title: '小数乘整数', lessons: [lessonWith('小数乘整数', ['积的小数位数', '小数乘整数的算理', '验算']), lessonWith('小数乘小数', ['因数的小数位数', '积的末尾有 0', '估算'])] },
      { title: '积的近似数', lessons: [lessonWith('积的近似数', ['四舍五入', '保留两位小数', '近似数的写法']), lessonWith('整数乘法运算定律推广到小数', ['交换律', '结合律', '分配律'])] },
    ] },
    { title: '位置', lectures: [{ title: '用数对确定位置', lessons: [lessonWith('数对', ['列与行', '数对的写法'])] }] },
  ],
  projects: [],
}

// The course flow, plus unit quizzes and decks as long as the prompt asks
// for at least. hold() makes the next quiz or deck wait until released.
function unitLlm() {
  const calls = []
  let gate = null
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零基础', '学过'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\]/gu)].map(match => match[1])
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(id => [id, { items: [{ kind: 'number', prompt: '$0.5 \\times 4$ = ?', answer: 2 }] }])) })
    }
    const wanted = Number(/at least (\d+) and at most/u.exec(user)?.[1] ?? 0)
    const concept = /(cpt_[a-z0-9]+)=/u.exec(user)?.[1]
    if (user.includes('quiz across the whole scope')) return JSON.stringify({ items: Array.from({ length: wanted }, (_, index) => ({ kind: 'number', prompt: `$${index + 1} \\times 0.1$ 等于多少？`, answer: (index + 1) / 10, conceptIds: [concept] })) })
    if (user.includes('flashcards')) return JSON.stringify({ cards: Array.from({ length: wanted }, (_, index) => ({ front: `第 ${index + 1} 张：积有几位小数？`, back: '因数一共有几位小数，积就有几位小数。', tag: '积的小数位数' })) })
    return '{}'
  }
  return {
    calls,
    supportsImages: () => false,
    hold() {
      let release
      gate = new Promise(resolve => { release = resolve })
      return () => release()
    },
    async complete(request) {
      calls.push(request)
      return answer(request)
    },
    async stream(request) {
      calls.push(request)
      if (gate) await gate.finally(() => { gate = null })
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
  const llm = unitLlm()
  const jobs = createJobs()
  const learner = createLearner({ store, llm, now })
  const courses = createCourses({ store, llm, jobs, now })
  const lessons = createLessons({ store, llm, jobs, courses, learner, now })
  const { courseId } = await finish(jobs, courses.startCraft({ goal: '五年级数学上册' }))
  await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
  const { course } = await finish(jobs, courses.confirm({ courseId }))
  // The textbook the course was made from.
  const materialId = newId('mat')
  await store.writeJson(store.paths.material(materialId), { id: materialId, title: '五年级上册数学', kind: 'pdf', pages: 130, chars: 120 })
  await store.writeJson(store.paths.materialChunks(materialId), [
    { id: 'c1', page: 12, part: 1, text: '例 3：小数乘整数，先按整数乘法算出积，再看因数中有几位小数，就从积的右边起数出几位，点上小数点。' },
    { id: 'c2', page: 80, part: 1, text: '用数对表示位置时，先写列，再写行。' },
  ])
  await store.updateJson(store.paths.course(courseId), null, value => ({ ...value, materialIds: [materialId] }))
  return { clock, store, llm, jobs, courses, lessons, courseId, course, units: course.units }
}

test('a unit quiz is as long as its unit, follows the material and counts what it has written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-unit-'))
  try {
    const { store, llm, jobs, lessons, courseId, units } = await setup(root)
    const [unit] = units
    const started = await lessons.unitQuiz({ courseId, unitId: unit.id })
    const { quiz } = await finish(jobs, started.job)
    const prompt = llm.calls.findLast(call => call.user.includes('quiz across the whole scope')).user
    assert.match(prompt, /at least 12 and at most 18/u, 'twelve concepts')
    assert.match(prompt, /<source_passages>[\s\S]*小数乘整数，先按整数乘法算出积[\s\S]*<\/source_passages>/u)
    assert.equal(quiz.items.length, 12, 'more than a lesson\'s practice may hold')
    assert.deepEqual([quiz.round, quiz.items[0].id, quiz.items[11].id], [1, 'i1', 'i12'])
    assert.deepEqual(jobs.get(started.job.id).progress, { done: 12, total: 18, label: 'writing' }, 'one per question, wherever the stream split it')
    assert.deepEqual(await lessons.unitQuiz({ courseId, unitId: unit.id }), { quiz }, 'kept')

    // A new set: new question ids, so answers to the first set never count
    // as answers to it. Asking again while it is written waits for it.
    const release = llm.hold()
    const again = await lessons.unitQuiz({ courseId, unitId: unit.id, force: true })
    assert.deepEqual((await lessons.unitQuiz({ courseId, unitId: unit.id })).job?.id, again.job.id, 'not the old set')
    release()
    const second = (await finish(jobs, again.job)).quiz
    assert.deepEqual([second.round, second.items[0].id, second.items.length], [2, 'r2i1', 12])
    const third = (await finish(jobs, (await lessons.unitQuiz({ courseId, unitId: unit.id, force: true })).job)).quiz
    assert.deepEqual([third.round, third.items[3].id], [3, 'r3i4'])
    assert.deepEqual((await store.readJson(store.paths.unitQuiz(courseId, unit.id), null)).items[0].id, 'r3i1')

    // The small unit: still ten questions at least, from its own pages.
    const small = (await finish(jobs, (await lessons.unitQuiz({ courseId, unitId: units[1].id })).job)).quiz
    assert.equal(small.items.length, 10)
    const smallPrompt = llm.calls.findLast(call => call.user.includes('quiz across the whole scope')).user
    assert.match(smallPrompt, /at least 10 and at most 15/u)
    assert.match(smallPrompt, /<source_passages>\n<<五年级上册数学 · p\.80>>\n用数对表示位置时，先写列，再写行。\n<\/source_passages>/u, 'the passage on its own lessons')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('each unit has its own flashcards; review gathers the due ones and the old whole-course deck', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-unit-'))
  try {
    const { clock, store, llm, jobs, courses, lessons, courseId, units } = await setup(root)
    const [unit, small] = units
    assert.deepEqual((await courses.get({ courseId })).ready.cards, { units: {}, review: 0, decks: 0 }, 'no decks yet')

    const started = await lessons.unitCards({ courseId, unitId: unit.id })
    assert.deepEqual(started.unit, { title: '小数乘法', n: 1 })
    const { deck, unit: about } = await finish(jobs, started.job)
    assert.deepEqual(about, { title: '小数乘法', n: 1 })
    const prompt = llm.calls.findLast(call => call.user.includes('flashcards')).user
    assert.match(prompt, /at least 24 and at most 48/u)
    assert.match(prompt, /<concepts>\n积的小数位数, 小数乘整数的算理, 验算, 因数的小数位数/u)
    assert.match(prompt, /<source_passages>[\s\S]*点上小数点/u)
    assert.deepEqual([deck.unitId, deck.cards.length, deck.cards[23].id], [unit.id, 24, 'c24'])
    assert.deepEqual(jobs.get(started.job.id).progress, { done: 24, total: 48, label: 'writing' })
    const smallStarted = await lessons.unitCards({ courseId, unitId: small.id })
    assert.deepEqual(smallStarted.unit, { title: '位置', n: 2 })
    assert.equal((await finish(jobs, smallStarted.job)).deck.cards.length, 8, 'a small unit gets eight')
    assert.equal((await lessons.unitCards({ courseId, unitId: unit.id })).deck.cards.length, 24, 'kept, never written twice')
    await assert.rejects(lessons.unitCards({ courseId, unitId: newId('unt') }), error => error.code === 'not-found')

    // Two cards of the unit studied; the old whole-course deck has one card
    // due, one not yet and one never seen.
    await lessons.reviewCard({ courseId, unitId: unit.id, cardId: 'c1', grade: 'again' })
    await lessons.reviewCard({ courseId, unitId: unit.id, cardId: 'c2', grade: 'good' })
    await store.writeJson(store.paths.cards(courseId), {
      cards: [{ id: 'c1', front: '旧卡 1', back: '…', tag: '' }, { id: 'c2', front: '旧卡 2', back: '…', tag: '' }, { id: 'c3', front: '旧卡 3', back: '…', tag: '' }],
      srs: { c1: { ...createCard('c1', T0), dueAt: new Date(T0 - 60 * MINUTE).toISOString() }, c2: review(createCard('c2', T0), 'easy', T0) },
    })
    clock.at = T0 + 11 * MINUTE
    const ready = (await courses.get({ courseId })).ready.cards
    assert.deepEqual([ready.units[unit.id], ready.units[small.id]], [{ total: 24, due: 1, fresh: 22 }, { total: 8, due: 0, fresh: 8 }])
    assert.deepEqual([ready.review, ready.decks], [3, 3], 'the unit\'s due card, and the old deck\'s due and unseen ones; a unit\'s unseen cards wait in its deck')

    const { cards } = await lessons.cardSession({ courseId })
    assert.deepEqual(cards.map(card => [card.unitId, card.id]), [[null, 'c1'], [unit.id, 'c1'], [null, 'c3']], 'oldest due first, unseen old cards last')
    assert.deepEqual([cards[1].unit, cards[0].unit], [{ title: '小数乘法', n: 1 }, null])

    // Each card is reviewed in its own deck.
    await lessons.reviewCard({ courseId, cardId: 'c3', grade: 'good' })
    await lessons.reviewCard({ courseId, unitId: unit.id, cardId: 'c1', grade: 'good' })
    assert.ok((await store.readJson(store.paths.cards(courseId), null)).srs.c3)
    assert.equal((await store.readJson(store.paths.unitCards(courseId, unit.id), null)).srs.c1.reps, 1)
    assert.deepEqual((await lessons.cardSession({ courseId })).cards.map(card => card.id), ['c1'])
    await assert.rejects(lessons.reviewCard({ courseId, unitId: newId('unt'), cardId: 'c1', grade: 'good' }), error => error.code === 'not-found', 'no such deck')
    await assert.rejects(lessons.reviewCard({ courseId, unitId: small.id, cardId: 'c9', grade: 'good' }), error => error.code === 'not-found', 'no such card')

    // A course pack carries every deck, without its review state.
    const exported = JSON.parse((await courses.exportPack({ courseId })).json)
    assert.deepEqual([exported.unitCards[unit.id].length, exported.unitCards[small.id].length, exported.cards.length], [24, 8, 3])
    const imported = await courses.importPack({ json: JSON.stringify(exported) })
    const copy = (await courses.get({ courseId: imported.id })).course
    const copied = await store.readJson(store.paths.unitCards(copy.id, copy.units[0].id), null)
    assert.deepEqual([copied.unitId, copied.cards.length, copied.srs], [copy.units[0].id, 24, {}])
    assert.deepEqual((await courses.get({ courseId: copy.id })).ready.cards.review, 3, 'the old deck\'s cards are all unseen again')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a course pack keeps unit decks for the units it can map', () => {
  const unitId = newId('unt')
  const course = { title: '小数', language: 'zh-CN', units: [{ id: unitId, title: '小数乘法', lectures: [{ title: '一', lessons: [{ id: newId('les'), title: '小数乘整数', concepts: [{ id: newId('cpt'), name: '积' }] }] }] }], projects: [] }
  const pack = exportCoursePack({ course, unitCards: { [unitId]: [{ id: 'c1', front: '问', back: '答' }], [newId('unt')]: [{ front: '别的', back: '单元' }] } })
  const imported = importCoursePack(JSON.stringify(pack))
  assert.deepEqual(Object.values(imported.unitCards), [[{ id: 'c1', front: '问', back: '答', tag: '' }]])
  assert.equal(Object.keys(imported.unitCards)[0], imported.course.units[0].id)
  assert.deepEqual(importCoursePack(JSON.stringify({ ...pack, unitCards: undefined })).unitCards, {}, 'a pack from before 1.10')
})

test('flashcard routes check the course, the unit and the grade', async () => {
  const seen = []
  const routes = createRoutes({ lessons: {
    unitCards: request => { seen.push(['cards', request]); return {} },
    cardSession: request => { seen.push(['session', request]); return { cards: [] } },
    reviewCard: request => { seen.push(['review', request]); return {} },
  } })
  const courseId = newId('crs')
  const unitId = newId('unt')
  await routes['unit/cards']({ courseId, unitId, force: true })
  await routes['course/card-session']({ courseId })
  await routes['course/card-review']({ courseId, unitId, cardId: 'c12', grade: 'good' })
  await routes['course/card-review']({ courseId, unitId: null, cardId: 'c1', grade: 'again' })
  assert.deepEqual(seen, [
    ['cards', { courseId, unitId }],
    ['session', { courseId }],
    ['review', { courseId, unitId, cardId: 'c12', grade: 'good' }],
    ['review', { courseId, unitId: undefined, cardId: 'c1', grade: 'again' }],
  ])
  assert.throws(() => routes['course/card-review']({ courseId, unitId: '../x', cardId: 'c1', grade: 'good' }), error => error.code === 'invalid')
  assert.throws(() => routes['course/card-review']({ courseId, cardId: 'c1', grade: 'later' }), error => error.code === 'invalid')
  assert.throws(() => routes['unit/cards']({ courseId }), error => error.code === 'invalid')
  assert.equal(routes['course/cards'], undefined, 'the whole-course deck is no longer written')
})

test('uploads take files up to 200 MB, and the message says so', async () => {
  assert.deepEqual([MAX_UPLOAD_MB, MAX_UPLOAD_BYTES], [200, 200 * 1024 * 1024])
  assert.match(zh['err_too-large'], /200 MB/u)
  assert.match(en['err_too-large'], /200 MB/u)
  // A body one byte over the limit, streamed: refused without reading on.
  const route = uploadRoute({ studio: { upload: () => assert.fail('not uploaded') } })
  let sent = 0
  const body = new ReadableStream({
    pull(controller) {
      const size = Math.min(16 * 1024 * 1024, MAX_UPLOAD_BYTES + 1 - sent)
      if (size <= 0) return controller.close()
      sent += size
      controller.enqueue(new Uint8Array(size))
    },
  })
  const response = await route.fetch(new Request('http://dsh.internal/api/aha-tutor/upload?name=book.pdf', { method: 'POST', body, duplex: 'half' }))
  assert.equal(response.status, 413)
  assert.deepEqual((await response.json()).error, { code: 'aha-tutor/too-large', message: 'The file is larger than 200 MB', details: {} })
  let taken = null
  const fits = uploadRoute({ studio: { upload: ({ bytes }) => { taken = bytes; return { id: 'job_x' } } } })
  const ok = await fits.fetch(new Request('http://dsh.internal/api/aha-tutor/upload?name=a.txt', { method: 'POST', body: new Uint8Array(70 * 1024 * 1024), duplex: 'half' }))
  assert.equal(ok.status, 200)
  assert.equal(taken.length, 70 * 1024 * 1024, 'more than the old 60 MB')
})
