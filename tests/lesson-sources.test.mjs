import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { normalizeBlueprint, normalizeLesson } from '../src/core/course-model.js'
import { exportCoursePack, importCoursePack } from '../src/core/coursepack.js'
import { bindBlueprint, keepSources, resolveSource, sourceIndex, stripSources } from '../src/core/lesson-sources.js'
import { materialLanguage, materialPassages, materialsSummary, sourcing } from '../src/host/context.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createStore } from '../src/host/store.js'

// A textbook of eight chunks: pages 3–10 of the file, printed 1–8.
const bookChunks = [
  '第一单元 小数乘法。小数乘整数的意义。',
  '例1 一支铅笔0.5元，买3支多少元？0.5×3=1.5（元）。',
  '小数乘小数：先按整数乘法算出积，再看因数中一共有几位小数。',
  '例2 小明买了3.5千克苹果，每千克4元，一共多少元？3.5×4=14（元）。',
  '第二单元 位置。用数对表示位置，先列后行。',
  '例3 小红的座位在第3列第2行，用（3，2）表示。',
  '练习二 在方格纸上标出下面各点的位置。',
  '第三单元 小数除法。除数是整数的小数除法。',
].map((text, index) => ({ id: `c${index + 1}`, page: index + 3, label: String(index + 1), part: 1, text }))
const bookMeta = {
  id: 'mat_book00001',
  title: '数学五年级上册',
  kind: 'pdf',
  pages: 10,
  printed: 'pdf',
  outline: { source: 'bookmarks', entries: [
    { title: '第一单元 小数乘法', level: 1, page: 3, end: 6, first: 1, last: 4, label: '1', endLabel: '4' },
    { title: '小数乘整数', level: 2, page: 3, end: 4, first: 1, last: 2, label: '1', endLabel: '2' },
    { title: '小数乘小数', level: 2, page: 5, end: 6, first: 3, last: 4, label: '3', endLabel: '4' },
    { title: '第二单元 位置', level: 1, page: 7, end: 9, first: 5, last: 7, label: '5', endLabel: '7' },
    { title: '第三单元 小数除法', level: 1, page: 10, end: 10, first: 8, last: 8, label: '8', endLabel: '8' },
  ] },
}
const book = { meta: bookMeta, chunks: bookChunks }

test('outline references become the chunks and pages of a lesson', () => {
  const index = sourceIndex([book])
  assert.deepEqual(resolveSource('M1.3', index), { materialId: 'mat_book00001', first: 3, last: 4, title: '小数乘小数', page: 5, end: 6, label: '3', endLabel: '4' })
  assert.deepEqual(resolveSource('[M1.1]', index)?.last, 4, 'brackets are fine')
  // Some pages of an entry, as printed.
  assert.deepEqual(resolveSource('M1.1:4', index), { materialId: 'mat_book00001', first: 4, last: 4, title: '第一单元 小数乘法', page: 6, end: 6, label: '4', endLabel: '4' })
  assert.equal(resolveSource('M1.1:99', index)?.first, 1, 'pages outside the entry keep the whole entry')
  // Pages of the material without an entry.
  assert.deepEqual(resolveSource('M1:5-6', index), { materialId: 'mat_book00001', first: 5, last: 6, title: '', page: 7, end: 8, label: '5', endLabel: '6' })
  for (const wrong of ['M1.9', 'M2.1', 'M1', 'M1:99', 'chapter 1', '', null, 3]) assert.equal(resolveSource(wrong, index), null, String(wrong))
  // A source in the stored shape is kept when its material is in the course.
  const stored = { materialId: 'mat_book00001', first: 5, last: 7, title: '第二单元 位置', page: 7, end: 9 }
  assert.equal(resolveSource(stored, index)?.first, 5)
  assert.equal(resolveSource({ ...stored, materialId: 'mat_other0001' }, index), null)
  assert.equal(resolveSource({ ...stored, last: 99 }, index), null)
})

test('a blueprint\'s lessons keep their sources and terms through normalizing', () => {
  const raw = { title: '小数', units: [{ title: '小数乘法', lectures: [{ title: '乘法', lessons: [
    { title: '小数乘整数', concepts: ['小数乘整数'], src: ['M1.2'], terms: ['decimal', 'decimal'] },
    { title: '小数乘小数', concepts: ['小数乘小数'], src: ['M1.3', 'M1.9', 'M1.3'] },
    { title: '复习', concepts: ['复习'], src: [] },
  ] }] }] }
  const blueprint = normalizeBlueprint(bindBlueprint(raw, sourceIndex([book])))
  const [first, second, third] = blueprint.units[0].lectures[0].lessons
  assert.deepEqual(first.sources.map(source => [source.title, source.label, source.endLabel]), [['小数乘整数', '1', '2']])
  assert.deepEqual(first.terms, ['decimal'])
  assert.equal(second.sources.length, 1, 'unknown and repeated references are dropped')
  assert.equal(third.sources, undefined, 'a lesson without sources stores none')
  assert.equal(first.src, undefined)
  // Bad shapes from an edited blueprint are dropped; at most three.
  const lesson = normalizeLesson({ title: 'x', sources: [
    { materialId: 'mat_book00001', first: 2, last: 1 },
    { materialId: '../../x', first: 1, last: 2 },
    ...[1, 2, 3, 4].map(first => ({ materialId: 'mat_book00001', first, last: first, page: 'p', label: 'x'.repeat(40) })),
  ] })
  assert.equal(lesson.sources.length, 3)
  assert.deepEqual(lesson.sources[0], { materialId: 'mat_book00001', first: 1, last: 1, title: '' })
})

test('revisions keep the sources of lessons they left alone', () => {
  const before = { units: [{ lectures: [{ lessons: [
    { id: 'les_kept000001', title: '小数乘整数', sources: [{ materialId: 'mat_book00001', first: 1, last: 2, title: 'A' }], terms: ['decimal'] },
    { id: 'les_renamed001', title: '旧标题', sources: [{ materialId: 'mat_book00001', first: 3, last: 4, title: 'B' }] },
  ] }] }] }
  const stripped = stripSources(before.units)
  assert.equal(stripped[0].lectures[0].lessons[0].sources, undefined, 'the model sees no sources')
  assert.ok(before.units[0].lectures[0].lessons[0].sources, 'stripping copies')
  const after = { units: [{ lectures: [{ lessons: [
    { id: 'les_kept000001', title: '小数乘整数' },
    { id: 'les_renamed001', title: '新标题' },
    { id: 'les_new0000001', title: '新的一讲', sources: [{ materialId: 'mat_book00001', first: 5, last: 5, title: 'C' }] },
  ] }] }] }
  const kept = keepSources(before, after).units[0].lectures[0].lessons
  assert.deepEqual(kept[0].sources.map(source => source.title), ['A'])
  assert.deepEqual(kept[0].terms, ['decimal'])
  assert.equal(kept[1].sources, undefined, 'a lesson that changed its title lost its old pages')
  assert.deepEqual(kept[2].sources.map(source => source.title), ['C'])
})

test('a lesson\'s own pages come first in its passages', () => {
  const other = { meta: { id: 'mat_notes0001', title: '笔记' }, chunks: [{ id: 'c1', text: '小数乘小数的笔记：积的小数位数等于因数小数位数之和。' }] }
  const sources = [resolveSource('M1.3', sourceIndex([book]))]
  const result = materialPassages([book, other], { query: '小数乘小数', sources, maxChars: 4000 })
  assert.deepEqual(result.passages.slice(0, 2).map(passage => passage.label), ['3', '4'], 'the bound pages, in book order')
  assert.ok(result.passages.some(passage => passage.materialId === 'mat_notes0001'), 'other materials still add matches')
  assert.equal(new Set(result.passages.map(passage => `${passage.materialId}:${passage.id}`)).size, result.passages.length, 'no passage twice')
  // A bound stretch longer than its share gives its best-matching parts.
  const long = Array.from({ length: 30 }, (_, index) => ({ id: `c${index + 1}`, page: index + 1, text: `${index === 17 ? '例2 小明买了苹果。' : '其他内容。'}${'正文。'.repeat(150)}` }))
  const wide = { meta: { id: 'mat_long00001', title: '长书' }, chunks: long }
  const narrow = materialPassages([wide], { query: '例2 苹果', sources: [{ materialId: 'mat_long00001', first: 1, last: 30 }], maxChars: 2000 })
  assert.equal(narrow.passages[0].page, 18)
  // Without a query the stretch is read from its start.
  assert.equal(materialPassages([wide], { sources: [{ materialId: 'mat_long00001', first: 5, last: 30 }], maxChars: 2000 }).passages[0].page, 5)
})

test('course design numbers the contents, and asks for terms in another language', () => {
  const english = { meta: { id: 'mat_english001', title: 'Calculus', kind: 'pdf', pages: 2, outline: { source: 'bookmarks', entries: [{ title: 'Limits', level: 1, page: 1, end: 1, first: 1, last: 1 }, { title: 'Derivatives', level: 1, page: 2, end: 2, first: 2, last: 2 }] } }, chunks: [{ id: 'c1', page: 1, text: 'A limit describes the value a function approaches.' }, { id: 'c2', page: 2, text: 'The derivative is the rate of change.' }] }
  const summary = materialsSummary([book, english], { refs: true })
  assert.match(summary, /- \[M1\] 数学五年级上册 \(10 pages\)/u)
  assert.match(summary, / {6}- \[M1\.3\] 小数乘小数 \(p\.3–4\)/u)
  assert.match(summary, / {4}- \[M2\.2\] Derivatives \(p\.2\)/u)
  assert.equal(materialLanguage(english.chunks), 'en')
  assert.equal(materialLanguage(bookChunks), 'zh-CN')
  assert.deepEqual(sourcing([book], 'zh-CN'), { refs: true, termsLanguage: null })
  assert.deepEqual(sourcing([english], 'zh-CN'), { refs: true, termsLanguage: 'en' })
  assert.deepEqual(sourcing([{ meta: { id: 'mat_x', title: 'x' }, chunks: bookChunks }], 'zh-TW'), { refs: false, termsLanguage: null }, 'Chinese for a Chinese course needs no terms')
})

test('course packs leave the sender\'s pages behind', () => {
  const course = { id: 'crs_pack000001', title: 'T', language: 'zh-CN', units: [{ id: 'unt_a00000001', title: 'U', lectures: [{ id: 'lec_a00000001', title: 'L', lessons: [{ id: 'les_a00000001', title: '小数乘小数', objectives: [], concepts: [{ id: 'cpt_a00000001', name: 'x' }], estMinutes: 10, sources: [{ materialId: 'mat_book00001', first: 3, last: 4, title: 'B' }], terms: ['decimal'] }] }] }], projects: [] }
  const imported = importCoursePack(JSON.stringify(exportCoursePack({ course, progress: null, boards: {}, practice: {}, sheets: {}, cards: [] })))
  const lesson = imported.course.units[0].lectures[0].lessons[0]
  assert.equal(lesson.sources, undefined)
  assert.deepEqual(lesson.terms, ['decimal'], 'terms still help')
})

function fakeLlm(lessonsOf) {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify({ title: '小数', emoji: '🔢', summary: 's', units: [{ title: '小数乘法', lectures: [{ title: '乘法', lessons: lessonsOf(user) }] }], projects: [] })
    if (user.includes('For EACH lesson write')) return JSON.stringify({ lessons: {} })
    if (user.includes('Teach this lesson')) return [{ say: '看书。', ops: [{ t: 'title', text: 'T' }] }, { say: '例题。', ops: [{ t: 'p', text: 'p' }] }, { say: '小结。', ops: [{ t: 'p', text: 'q' }] }].map(line => JSON.stringify(line)).join('\n')
    if (user.includes('raised a hand')) return JSON.stringify({ say: '看例2。', ops: [{ t: 'p', text: '14' }] })
    if (user.includes('Apply the change request')) {
      const current = JSON.parse(/<current_blueprint>\n([\s\S]*?)\n<\/current_blueprint>/u.exec(user)[1])
      current.units[0].lectures[0].lessons.push({ title: '位置', concepts: ['数对'], src: ['M1.4'] })
      return JSON.stringify(current)
    }
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

test('a course made from a textbook teaches each lesson from its pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-sources-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm(() => [
      { title: '小数乘整数', concepts: ['小数乘整数'], estMinutes: 12, src: ['M1.2'] },
      { title: '小数乘小数', concepts: ['小数乘小数'], estMinutes: 12, src: ['M1.3'] },
    ])
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner: createLearner({ store, llm }) })
    await store.writeJson(store.paths.material(bookMeta.id), { ...bookMeta, chars: 400, createdAt: new Date().toISOString(), brief: null })
    await store.writeJson(store.paths.materialChunks(bookMeta.id), bookChunks)

    const { courseId } = await finish(jobs, courses.startCraft({ goal: '小数乘法', materialIds: [bookMeta.id] }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const design = llm.calls.find(call => call.user.includes('Design the course blueprint')).user
    assert.match(design, /\[M1\.3\] 小数乘小数 \(p\.3–4\)/u)
    assert.match(design, /gets "src"/u)
    assert.doesNotMatch(design, /gets "terms"/u, 'a Chinese book for a Chinese course needs no terms')
    assert.match(design, /"depth":"intuition\|definition\|derivation\|application\|extension","src":\["M1\.3"\]/u)
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const [first, second] = course.units[0].lectures[0].lessons
    assert.deepEqual(first.sources.map(source => [source.title, source.label, source.endLabel]), [['小数乘整数', '1', '2']])

    // The board of the second lesson reads its own pages first.
    await finish(jobs, (await lessons.prepare({ courseId, lessonId: second.id })).job)
    const board = llm.calls.find(call => call.user.includes('Teach this lesson') && call.user.includes('小数乘小数')).user
    assert.match(board, /<source_passages>\n<<数学五年级上册 · p\.3>>\n小数乘小数：先按整数乘法/u)
    // A raised hand in it finds the example on its pages.
    await finish(jobs, lessons.ask({ scope: { kind: 'lesson', courseId, lessonId: second.id }, question: '书上那道例题怎么做？' }))
    const asked = llm.calls.filter(call => call.user.includes('raised a hand')).at(-1).user
    assert.match(asked, /例2 小明买了3\.5千克苹果/u)
    // The lesson page shows its pages with the material's title.
    const shown = await lessons.get({ courseId, lessonId: second.id })
    assert.deepEqual(shown.sources.map(source => [source.materialTitle, source.label, source.endLabel]), [['数学五年级上册', '3', '4']])

    // A revision keeps the pages of lessons it leaves alone and binds new ones.
    await finish(jobs, courses.revise({ courseId, instruction: '加一讲位置' }))
    const revise = llm.calls.find(call => call.user.includes('Apply the change request')).user
    assert.doesNotMatch(revise, /"sources"/u, 'the model sees references, not stored sources')
    assert.match(revise, /\[M1\.4\] 第二单元 位置/u)
    const { course: applied } = await courses.applyProposal({ courseId })
    const revised = applied.units[0].lectures[0].lessons
    assert.equal(revised[0].sources[0].title, '小数乘整数')
    assert.equal(revised[2].sources[0].title, '第二单元 位置')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an English textbook in a Chinese course is found by the lesson\'s English terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-terms-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm(() => [{ title: '导数的定义', concepts: ['导数'], estMinutes: 12, terms: ['derivative', 'rate of change'] }])
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner: createLearner({ store, llm }) })
    const pages = ['Limits describe where a function heads.', 'Continuity means no jumps.', 'The derivative is the instantaneous rate of change of a function.', 'Integrals add up small pieces.']
    await store.writeJson(store.paths.material('mat_calc000001'), { id: 'mat_calc000001', title: 'Calculus', kind: 'pdf', pages: 4, chars: 200, createdAt: new Date().toISOString(), brief: null })
    await store.writeJson(store.paths.materialChunks('mat_calc000001'), pages.map((text, index) => ({ id: `c${index + 1}`, page: index + 1, part: 1, text })))
    const { courseId } = await finish(jobs, courses.startCraft({ goal: '学导数', materialIds: ['mat_calc000001'], language: 'zh-CN' }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const design = llm.calls.find(call => call.user.includes('Design the course blueprint')).user
    assert.match(design, /The materials are written in English\. Each lesson gets "terms"/u)
    assert.doesNotMatch(design, /gets "src"/u, 'no contents, no references')
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const lesson = course.units[0].lectures[0].lessons[0]
    assert.deepEqual(lesson.terms, ['derivative', 'rate of change'])
    await finish(jobs, (await lessons.prepare({ courseId, lessonId: lesson.id })).job)
    const board = llm.calls.find(call => call.user.includes('Teach this lesson')).user
    assert.match(board, /<source_passages>\n<<Calculus · p\.3>>\nThe derivative is/u, 'the right page, found by its words')
    assert.doesNotMatch(board, /No passage of the materials matched/u)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
