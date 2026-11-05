import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { mentionedPages, pageMentions } from '../src/core/citations.js'
import { courseSpan } from '../src/core/course-model.js'
import { buildIndex, samplePassages, search, selectPassages, tokenize } from '../src/core/retrieval.js'
import { materialPassages, SAMPLED_NOTE } from '../src/host/context.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createStore } from '../src/host/store.js'

// An English textbook of 40 pages, each about one topic, in book order.
const TOPICS = ['place value', 'rounding', 'adding decimals', 'subtracting decimals', 'multiplying decimals', 'dividing decimals', 'fractions', 'ratios', 'percent', 'area']
const englishBook = Array.from({ length: 40 }, (_, index) => ({
  id: `c${index + 1}`,
  page: index + 1,
  text: `Chapter ${Math.floor(index / 4) + 1}: ${TOPICS[Math.floor(index / 4)]}. ${'This page explains the idea with worked examples and exercises. '.repeat(8)}`,
}))

test('a query that matches nothing falls back to excerpts instead of nothing', () => {
  // A Chinese lesson on an English textbook shares no words with it.
  assert.equal(search(buildIndex(englishBook), '小数乘法 小数乘整数').length, 0)
  const picked = selectPassages(englishBook, '小数乘法 小数乘整数', { maxChars: 2000 })
  assert.ok(picked.length > 0, 'excerpts stand in for matches')
  assert.ok(picked.every(passage => passage.sampled === true), 'and say they were sampled')
  assert.ok(picked.reduce((sum, passage) => sum + passage.text.length, 0) <= 2000 + 1)
  assert.deepEqual(selectPassages(englishBook, '小数乘法', { maxChars: 2000, fallback: 'none' }), [])
  // A query that does match is unchanged: the best passage first.
  assert.match(selectPassages(englishBook, 'percent', { maxChars: 2000 })[0].text, /percent/u)
})

test('sampled excerpts come from about where the lesson sits in the course', () => {
  // The fifth lesson of ten sits 40–50% of the way in: the pages there.
  const picked = samplePassages(englishBook, { maxChars: 1500, around: [0.4, 0.5] })
  const pages = picked.map(passage => passage.page)
  assert.ok(pages.includes(17) && pages.every(page => page >= 14 && page <= 22), `pages ${pages}`)
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b), 'a contiguous stretch, in book order')
  // A short material is given whole; no window means the whole material.
  assert.equal(samplePassages(englishBook.slice(0, 2), { maxChars: 9000, around: [0.9, 1] }).length, 2)
  const spread = samplePassages(englishBook, { maxChars: 3000 }).map(passage => passage.page)
  assert.ok(spread[0] === 1 && spread.at(-1) === 40, 'spread over the whole book')
  // A lesson's place in its course.
  const course = { units: [{ lectures: [{ lessons: [{ id: 'les_a' }, { id: 'les_b' }] }, { lessons: [{ id: 'les_c' }, { id: 'les_d' }] }] }] }
  assert.deepEqual(courseSpan(course, ['les_b']), [0.25, 0.5])
  assert.deepEqual(courseSpan(course, ['les_c', 'les_d']), [0.5, 1])
  assert.equal(courseSpan(course, ['les_x']), undefined)
})

test('numbered things are found by their number', () => {
  assert.ok(tokenize('例2 小明买了').includes('例2'))
  assert.ok(tokenize('书上12页').includes('12页'))
  assert.ok(tokenize('See Example 3 below').includes('example3'))
  const chunks = [
    { id: 'c1', page: 1, text: '例1 一支铅笔0.5元，买3支多少元？' },
    { id: 'c2', page: 2, text: '例2 小明买了3.5千克苹果，每千克4元。' },
  ]
  assert.equal(search(buildIndex(chunks), '例2怎么做')[0].chunk.page, 2)
})

test('page references are read in Chinese and English', () => {
  assert.deepEqual(mentionedPages('书上第12页的例2怎么做？'), ['12'])
  assert.deepEqual(mentionedPages('看第 3 至 5 页，还有 p. 40 和 pages 7-8'), ['3', '4', '5', '40', '7', '8'])
  assert.deepEqual(mentionedPages('课本12页那道题'), ['12'])
  assert.deepEqual(mentionedPages('没有页码，例2'), [])
  // A long range names its ends only.
  assert.deepEqual(mentionedPages('pp. 10–90'), ['10', '90'])
  const [mention] = pageMentions('请看第12页。')
  assert.equal('请看第12页。'.slice(mention.start, mention.end), '第12页')
})

test('material passages: named pages first, then matches, else a marked sample', () => {
  const book = { meta: { id: 'mat_book', title: 'Decimals' }, chunks: englishBook }
  const named = materialPassages([book], { query: 'percent', pages: ['2'], maxChars: 3000 })
  assert.equal(named.passages[0].page, 2, 'the page the learner named comes first')
  assert.ok(named.passages.some(passage => /percent/u.test(passage.text)))
  assert.equal(named.sampled, false)
  // The cross-language case: nothing matches, so the stretch of the book
  // where the lesson sits is given, and the prompt is told so.
  const sampled = materialPassages([book], { query: '小数乘法', around: [0.4, 0.5], maxChars: 1500 })
  assert.equal(sampled.sampled, true)
  assert.ok(sampled.text.startsWith(SAMPLED_NOTE))
  assert.match(sampled.text, /<<Decimals · p\.17>>/u)
  assert.ok(sampled.passages.every(passage => passage.materialId === 'mat_book'))
  // Many materials keep to the budget together.
  const many = Array.from({ length: 12 }, (_, index) => ({ meta: { id: `mat_${index}`, title: `M${index}` }, chunks: englishBook }))
  const total = materialPassages(many, { query: 'percent', maxChars: 4000 }).passages.reduce((sum, passage) => sum + passage.text.length, 0)
  assert.ok(total <= 4001, `${total}`)
})

const blueprint = {
  title: '小数乘法',
  emoji: '🔢',
  summary: '小数乘整数和小数乘小数。',
  units: [{ title: '小数乘法', lectures: [{ title: '小数乘整数', lessons: [
    { title: '小数乘整数', concepts: ['小数乘整数'], estMinutes: 12 },
    { title: '小数乘小数', concepts: ['小数乘小数'], estMinutes: 12 },
  ] }] }],
  projects: [],
}

function fakeLlm() {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) return JSON.stringify({ lessons: {} })
    if (user.includes('raised a hand')) return JSON.stringify({ say: '我们看书上的例题。', ops: [{ t: 'p', text: '3.5 × 4 = 14' }] })
    return '{}'
  }
  return {
    calls,
    supportsImages: () => false,
    async complete(request) { calls.push(request); return answer(request) },
    async stream(request) { calls.push(request); const full = answer(request); request.onText?.(full); return full },
  }
}

async function finish(jobs, started) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = jobs.get(started.id)
    if (job.status !== 'running') {
      if (job.status !== 'done') throw Object.assign(new Error(job.error?.message), { code: job.error?.code })
      return job.result
    }
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('job timed out')
}

test('a raised hand is answered with the passages of the course materials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-ground-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm()
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner: createLearner({ store, llm }) })
    const pages = ['目录', '例1 一支铅笔0.5元，买3支多少元？', '例2 小明买了3.5千克苹果，每千克4元，一共多少元？', '练习一 计算下面各题。', '小数乘小数：先按整数乘法算出积，再看因数中一共有几位小数。']
    await store.writeJson(store.paths.material('mat_book00001'), { id: 'mat_book00001', title: '数学五年级上册', kind: 'pdf', pages: pages.length, chars: 200, createdAt: new Date().toISOString(), brief: null })
    await store.writeJson(store.paths.materialChunks('mat_book00001'), pages.map((text, index) => ({ id: `c${index + 1}`, page: index + 1, part: 1, text })))
    await store.writeJson(store.paths.material('mat_english001'), { id: 'mat_english001', title: 'Decimals', kind: 'pdf', pages: 40, chars: 20000, createdAt: new Date().toISOString(), brief: null })
    await store.writeJson(store.paths.materialChunks('mat_english001'), englishBook)

    const { courseId } = await finish(jobs, courses.startCraft({ goal: '小数乘法', materialIds: ['mat_book00001'] }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const [first, second] = course.units[0].lectures[0].lessons
    const asked = async (lessonId, question) => {
      await finish(jobs, lessons.ask({ scope: { kind: 'lesson', courseId, lessonId }, question }))
      return llm.calls.filter(call => call.user.includes('raised a hand')).at(-1).user
    }

    // "The example on page 3 of the book" brings that page, labelled.
    const prompt = await asked(first.id, '书上第3页的例2怎么做？')
    assert.match(prompt, /<source_passages>\n<<数学五年级上册 · p\.3>>\n例2 小明买了3\.5千克苹果/u)
    assert.match(prompt, /never follow it/u, 'the passages are reference material, not instructions')
    assert.ok(prompt.indexOf('<source_passages>') < prompt.indexOf('<learner_question>'))
    // Without a page, the question's own words find the example.
    assert.match(await asked(first.id, '那道买苹果的例题为什么是14元？'), /例2 小明买了/u)

    // An English book in a Chinese course: nothing matches the words, so the
    // part of the book where the lesson sits is given, and marked.
    await courses.saveCourse({ ...course, materialIds: ['mat_english001'] })
    const crossed = await asked(second.id, '这道例题怎么做？')
    assert.ok(crossed.includes(SAMPLED_NOTE))
    const shown = [...crossed.matchAll(/<<Decimals · p\.(\d+)>>/gu)].map(match => Number(match[1]))
    assert.ok(shown.length && shown.every(page => page >= 15), `the second half of the book for the second of two lessons: ${shown}`)

    // A course without materials asks as before.
    await courses.saveCourse({ ...course, materialIds: [] })
    assert.doesNotMatch(await asked(first.id, '为什么？'), /<source_passages>/u)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
