import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LIMITS, materialQuizRange, partCardRange, shareRange, takeEvenly, thinEvenly, uniqueCards } from '../src/core/course-model.js'
import { newId } from '../src/core/ids.js'
import { materialParts } from '../src/core/retrieval.js'
import { TutorError } from '../src/host/generate.js'
import { createJobs } from '../src/host/jobs.js'
import { flashcardsPrompt, quizPrompt, summaryPrompt } from '../src/host/prompts.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

test('a material\'s deck and quiz are sized by its length', () => {
  assert.deepEqual([partCardRange(2000), partCardRange(10000), partCardRange(20000), partCardRange(40000)], [{ min: 4, max: 7 }, { min: 5, max: 33 }, { min: 10, max: 60 }, { min: 20, max: 60 }], 'two to four cards a key point, up to a card per 300 characters')
  assert.deepEqual([materialQuizRange(5000), materialQuizRange(20000), materialQuizRange(60000), materialQuizRange(200000)], [{ min: 5, max: 10 }, { min: 5, max: 10 }, { min: 15, max: 30 }, { min: 20, max: 30 }], 'a handout 5–10, a book at most 30')
  assert.deepEqual([shareRange({ min: 20, max: 30 }, 8), shareRange({ min: 20, max: 30 }, 24), shareRange({ min: 5, max: 10 }, 0)], [{ min: 2, max: 4 }, { min: 1, max: 2 }, { min: 5, max: 10 }])

  assert.deepEqual(thinEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3), [2, 6, 9], 'spread over the list, its end included')
  assert.deepEqual(thinEvenly([1, 2], 3), [1, 2])
  assert.deepEqual(takeEvenly([[1, 2, 3, 4], [5], [6, 7, 8]], 5), [2, 4, 5, 6, 8], 'shares taken in turns, each list thinned evenly and kept in order')
  assert.deepEqual(takeEvenly([[1, 2], [3]], 10), [1, 2, 3])
  assert.deepEqual(takeEvenly([], 3), [])
  const cards = uniqueCards([[{ front: '什么是质数？' }, { front: 'Prime?' }], [{ front: '什么是 质数?' }, { front: 'prime' }, { front: '合数' }]])
  assert.deepEqual(cards.map(list => list.map(card => card.front)), [['什么是质数？', 'Prime?'], ['合数']], 'spacing, punctuation and case aside')

  const chunks = (count, size, from = 1) => Array.from({ length: count }, (_, index) => ({ id: `c${index + 1}`, page: from + index, text: 'x'.repeat(size) }))
  const parts = materialParts([{ title: '课本', chunks: chunks(100, 1600) }, { title: '讲义', chunks: chunks(5, 1600) }, { title: '空', chunks: [] }])
  assert.deepEqual(parts.map(part => part.title), [...Array(8).fill('课本'), '讲义'], 'a part never mixes two materials')
  assert.deepEqual([parts[0].passages[0].page, parts[0].passages.at(-1).page, parts[1].passages[0].page, parts[8].chars], [1, 13, 14, 8000])
  assert.ok(materialParts([{ title: '大', chunks: chunks(400, 1600) }]).length <= 24, 'about 24 parts at most')
})

test('a part of a long material and the focus reach the prompts', () => {
  const part = { n: 2, of: 9, range: 'p.14–p.25' }
  const cards = flashcardsPrompt({ scopeTitle: '课本', outline: '小数', passages: '<<课本 · p.14>>\n…', language: 'zh-CN', range: { min: 10, max: 40 }, part, focus: '第 3–6 章' })
  assert.match(cards.user, /<part>\nPart 2 of 9 \(p\.14–p\.25\)\. The other parts are covered separately: write only about the passages of this part\.\n<\/part>/u)
  assert.match(cards.user, /as many flashcards as this part needs, at least 10 and at most 40: every key point of the passages gets two to four cards/u)
  assert.match(cards.user, /<focus>\n第 3–6 章\n<\/focus>/u)
  assert.match(cards.user, /Cover only what falls within the learner's focus: write fewer when little of the passages does, and return \{"cards":\[\]\} when none does\./u)
  assert.doesNotMatch(flashcardsPrompt({ scopeTitle: '课本', passages: '…', language: 'zh-CN', range: { min: 4, max: 4 } }).user, /<part>|<focus>|learner's focus/u, 'a short material, no focus')

  const quiz = quizPrompt({ scopeTitle: '课本', outline: '', concepts: '', passages: '…', language: 'zh-CN', range: { min: 2, max: 4 }, part, focus: '分数' })
  assert.match(quiz.user, /Write questions on this part of the scope, at least 2 and at most 4, on its most important points/u)
  assert.match(quiz.user, /return \{"items":\[\]\} when none does/u)
  assert.match(quizPrompt({ scopeTitle: '讲义', concepts: '', passages: '…', language: 'zh-CN', range: { min: 5, max: 10 } }).user, /quiz across the whole scope with as many questions as it needs, at least 5 and at most 10: at least one question for every key point of the passages/u)

  const notes = summaryPrompt({ scopeTitle: '课本', passages: '…', outline: '', language: 'zh-CN', focus: '第 3 章' })
  assert.match(notes.user, /<focus>\n第 3 章\n<\/focus>[\s\S]*Cover only what falls within the learner's focus\./u)
  assert.doesNotMatch(summaryPrompt({ scopeTitle: '课本', passages: '…', outline: '', language: 'zh-CN' }).user, /focus/u)
})

// ── on the host ─────────────────────────────────────────────────────────────

const MARK = '【乘法单元】'

// Answers decks and quizzes per part, with as many entries as the prompt asks
// for at least (or at most); every part's first card asks the same question.
// Parts in `fail` answer garbage; `fatal` is thrown on every call; a part
// for which `within(prompt)` is false has nothing within the focus.
function libraryLlm() {
  const calls = []
  const setup = { size: 'least', fail: new Set(), fatal: null, within: () => true }
  let active = 0
  let most = 0
  const answer = ({ user }) => {
    if (setup.fatal) throw setup.fatal
    const part = Number(/<part>\nPart (\d+) of/u.exec(user)?.[1] ?? 1)
    if (setup.fail.has(part)) return 'not json'
    const [, least, at] = /at least (\d+) and at most (\d+)/u.exec(user) ?? [null, 0, 0]
    const count = setup.size === 'over' ? Number(at) + 30 : Number(setup.size === 'most' ? at : least)
    const within = setup.within(user)
    if (user.includes('Return {"cards"')) return JSON.stringify({ cards: within ? Array.from({ length: count }, (_, index) => ({ front: index === 0 ? '什么是小数？' : `第 ${part} 段第 ${index + 1} 张？`, back: '答案', tag: `第 ${part} 段` })) : [] })
    if (user.includes('Return {"items"')) return JSON.stringify({ items: within ? Array.from({ length: count }, (_, index) => ({ kind: 'number', prompt: `第 ${part} 段第 ${index + 1} 题？`, answer: index })) : [] })
    if (user.includes('Write structured study notes')) return '# 笔记'
    return '{}'
  }
  const take = async request => {
    calls.push(request)
    active += 1
    most = Math.max(most, active)
    try {
      await new Promise(resolve => setTimeout(resolve, 3))
      return answer(request)
    } finally {
      active -= 1
    }
  }
  return {
    calls,
    setup,
    most: () => most,
    supportsImages: () => false,
    complete: take,
    async stream(request) {
      const full = await take(request)
      for (const piece of full.match(/[\s\S]{1,23}/gu) ?? []) request.onText(piece)
      return full
    },
  }
}

async function settle(jobs, started) {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const job = jobs.get(started.id)
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('job timed out')
}

async function finish(jobs, started) {
  const job = await settle(jobs, started)
  if (job.status !== 'done') throw new Error(`job ${job.kind} ${job.status}: ${job.error?.message}`)
  return job.result
}

async function material(store, title, chunks) {
  const id = newId('mat')
  await store.writeJson(store.paths.material(id), { id, title, kind: 'pdf', chars: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), brief: { topics: ['小数'] } })
  await store.writeJson(store.paths.materialChunks(id), chunks)
  return id
}

// A 160-page book read in 8 parts (pages 30–45 are about multiplication),
// and an 8-page handout read whole.
async function setup(root) {
  const store = createStore({ root: join(root, 'data') })
  const llm = libraryLlm()
  const jobs = createJobs()
  const studio = createStudio({ store, llm, jobs })
  const page = (number, size) => ({ id: `c${number}`, page: number, part: 1, text: `第 ${number} 页${number >= 30 && number <= 45 ? MARK : ''}：${'小数的读写与比较。'.repeat(size / 5)}`.slice(0, size) })
  const book = await material(store, '五年级上册数学', Array.from({ length: 160 }, (_, index) => page(index + 1, 1000)))
  const handout = await material(store, '讲义', Array.from({ length: 8 }, (_, index) => page(index + 1, 1000)))
  return { store, llm, jobs, studio, book, handout }
}

test('a deck covers the whole book part by part, without thinking, each question once and at most 300 cards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const { store, llm, jobs, studio, book, handout } = await setup(root)
    const started = studio.makeCards({ materialIds: [book] })
    const { item } = await finish(jobs, started)
    const calls = llm.calls.filter(call => call.user.includes('Return {"cards"'))
    assert.equal(calls.length, 8)
    assert.ok(calls.every(call => call.effort === 'lowest' && call.purpose === 'teach'), 'cards restate the text')
    assert.deepEqual(calls.map(call => /<part>\nPart (\d) of 8 \((p\.\d+–p\.\d+)\)/u.exec(call.user)?.slice(1).join(' ')).sort(), ['1 p.1–p.20', '2 p.21–p.40', '3 p.41–p.60', '4 p.61–p.80', '5 p.81–p.100', '6 p.101–p.120', '7 p.121–p.140', '8 p.141–p.160'])
    assert.ok(llm.most() > 1 && llm.most() <= 3, `three parts at a time (${llm.most()})`)
    assert.equal(item.cards.length, 8 * 10 - 7, 'the same question from every part is kept once')
    assert.deepEqual([item.cards[0].id, item.cards.at(-1).id, item.title, item.kind], ['c1', 'c73', '五年级上册数学', 'cards'])
    assert.deepEqual(item.srs, {})
    assert.equal(item.missing, undefined)
    const job = jobs.get(started.id)
    assert.deepEqual([job.progress, job.preview], [{ done: 8, total: 8, label: 'reading' }, { written: 80 }])
    assert.deepEqual((await store.readJson(store.paths.item('decks', item.id), null)).cards.length, 73)

    // Parts that write all they may: 320 cards, cut evenly to 300.
    llm.setup.size = 'most'
    const full = (await finish(jobs, studio.makeCards({ materialIds: [book] }))).item
    assert.equal(full.cards.length, LIMITS.libraryCards)
    const perPart = Object.values(Object.groupBy(full.cards, card => card.tag)).map(cards => cards.length)
    assert.ok(Math.min(...perPart) >= 36, `every part keeps its share (${perPart})`)
    assert.ok(full.cards.some(card => card.front === '第 8 段第 60 张？'), 'a part thinned out keeps its end')

    // A part that writes more than it may keep is thinned evenly, and the
    // running count never shows more than is kept.
    llm.setup.size = 'over'
    const over = studio.makeCards({ materialIds: [book] })
    const thinned = (await finish(jobs, over)).item
    assert.equal(thinned.cards.length, LIMITS.libraryCards)
    assert.ok(thinned.cards.some(card => card.front === '第 3 段第 90 张？'), 'the end of a part that wrote 90')
    assert.equal(jobs.get(over.id).preview.written, LIMITS.libraryCards)

    // A handout is read whole.
    llm.setup.size = 'least'
    const before = llm.calls.length
    const small = (await finish(jobs, studio.makeCards({ materialIds: [handout] }))).item
    assert.equal(llm.calls.length - before, 1)
    assert.doesNotMatch(llm.calls.at(-1).user, /<part>/u)
    assert.equal(small.cards.length, 4)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a quiz is shared out over the parts and thinks; one on a handout is 5 to 10 questions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const { store, llm, jobs, studio, book, handout } = await setup(root)
    const { item } = await finish(jobs, studio.makeQuiz({ materialIds: [book] }))
    const calls = llm.calls.filter(call => call.user.includes('Return {"items"'))
    assert.equal(calls.length, 8)
    assert.ok(calls.every(call => !('effort' in call)), 'answer keys are worked out')
    assert.ok(calls.every(call => /Write questions on this part of the scope, at least 2 and at most 4/u.test(call.user)), 'a book of 160,000 characters gets 20–30 questions')
    assert.deepEqual([item.kind, item.items.length, item.items[0].id, item.items.at(-1).id], ['quiz', 16, 'i1', 'i16'])

    llm.setup.size = 'most'
    const full = (await finish(jobs, studio.makeQuiz({ materialIds: [book] }))).item
    assert.equal(full.items.length, LIMITS.quizItems, 'eight parts of four, cut to 30')
    const shortQuiz = (await finish(jobs, studio.makeQuiz({ materialIds: [handout] }))).item
    assert.match(llm.calls.at(-1).user, /quiz across the whole scope with as many questions as it needs, at least 5 and at most 10/u)
    assert.equal(shortQuiz.items.length, 10, 'more than the 12 a lesson\'s practice holds is allowed, up to the range')
    const pair = (await finish(jobs, studio.makeQuiz({ materialIds: [book, handout] }))).item
    assert.equal(pair.title, '五年级上册数学 + 讲义')
    assert.equal(pair.items.length, 30)
    assert.ok(await store.readJson(store.paths.item('decks', pair.id), null))
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the focus keeps only the parts within it, and says so when there are none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const { llm, jobs, studio, book } = await setup(root)
    llm.setup.within = user => user.includes(MARK)
    const deck = (await finish(jobs, studio.makeCards({ materialIds: [book], focus: '  小数乘法  ' }))).item
    assert.ok(llm.calls.every(call => call.user.includes('<focus>\n小数乘法\n</focus>')))
    assert.deepEqual([deck.title, deck.focus, deck.cards.length], ['五年级上册数学 · 小数乘法', '小数乘法', 10 + 10 - 1], 'pages 30–45 lie in parts 2 and 3')
    // Each part may write as a material of its size would: 5–10 questions.
    const quiz = (await finish(jobs, studio.makeQuiz({ materialIds: [book], focus: '小数乘法' }))).item
    assert.equal(quiz.items.length, 10)
    assert.ok(llm.calls.filter(call => call.user.includes('Return {"items"')).every(call => /at least 5 and at most 10/u.test(call.user)))

    llm.setup.within = () => false
    for (const make of [studio.makeCards, studio.makeQuiz]) {
      const none = await settle(jobs, make({ materialIds: [book], focus: '三角函数' }))
      assert.deepEqual([none.status, none.error.code], ['failed', 'focus-empty'])
    }
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a part that cannot be read is named; too many such parts, or a model that refuses, fail the job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const { llm, jobs, studio, book } = await setup(root)
    llm.setup.fail = new Set([3])
    const { item } = await finish(jobs, studio.makeCards({ materialIds: [book] }))
    assert.deepEqual(item.missing, ['p.41–p.60'])
    assert.equal(item.cards.length, 7 * 10 - 6)
    assert.equal(llm.calls.filter(call => /<part>\nPart 3 of/u.test(call.user)).length, 4, 'tried twice, each with its repair round')

    llm.setup.fail = new Set([1, 2, 3, 4, 5])
    const most = await settle(jobs, studio.makeQuiz({ materialIds: [book] }))
    assert.deepEqual([most.status, most.error.code], ['failed', 'bad-output'])

    llm.setup.fail = new Set()
    llm.setup.fatal = new TutorError('llm-auth', 'The model rejected the sign-in or key.')
    const before = llm.calls.length
    const refused = await settle(jobs, studio.makeCards({ materialIds: [book] }))
    assert.deepEqual([refused.status, refused.error.code], ['failed', 'llm-auth'])
    assert.ok(llm.calls.length - before <= 3, 'stopped at once, not tried part after part')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('notes follow the focus, and the routes pass it on', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const { llm, jobs, studio, book } = await setup(root)
    const { item } = await finish(jobs, studio.makeNotes({ materialIds: [book], focus: '小数乘法' }))
    assert.equal(item.title, '五年级上册数学 · 小数乘法')
    assert.match(llm.calls.at(-1).user, /<focus>\n小数乘法\n<\/focus>[\s\S]*Cover only what falls within the learner's focus\./u)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const seen = []
  const job = name => request => { seen.push([name, request]); return { id: 'job_x' } }
  const routes = createRoutes({ studio: { makeCards: job('cards'), makeQuiz: job('quiz'), makeNotes: job('notes') } })
  const materialIds = [newId('mat')]
  for (const endpoint of ['studio/cards', 'studio/quiz', 'studio/notes']) await routes[endpoint]({ materialIds, focus: '第 3 章', count: 99 })
  assert.deepEqual(seen, [['cards', { materialIds, focus: '第 3 章' }], ['quiz', { materialIds, focus: '第 3 章' }], ['notes', { materialIds, focus: '第 3 章' }]])
})
