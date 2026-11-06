import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LIMITS, materialsTitle, normalizeBlueprint } from '../src/core/course-model.js'
import { materialParts, samplePassages, spreadPassages } from '../src/core/retrieval.js'
import { COURSE_MATERIALS, contentsShare, materialPassages, materialsSummary } from '../src/host/context.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'

const ids = count => Array.from({ length: count }, (_, index) => `mat_limit${String(index + 1).padStart(4, '0')}`)
const sizeOf = chunks => chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)

test('one limit of 30 materials holds everywhere they are picked', () => {
  assert.equal(LIMITS.materials, 30)
  assert.equal(COURSE_MATERIALS, LIMITS.materials)
  const seen = {}
  const keep = name => request => { seen[name] = request.materialIds; return { id: 'job_x' } }
  const routes = createRoutes({
    courses: { startCraft: keep('start'), addMaterials: keep('add') },
    studio: { makeSheet: keep('sheet'), makeNotes: keep('notes'), makeCards: keep('cards'), makeQuiz: keep('quiz'), assist: keep('assist') },
  })
  const wanted = ids(31)
  routes['course/start']({ goal: 'x', materialIds: wanted })
  routes['course/add-materials']({ courseId: 'crs_aaaaaaaa', materialIds: wanted })
  for (const name of ['sheet', 'notes', 'cards', 'quiz']) routes[`studio/${name}`]({ materialIds: wanted })
  routes['assist/ask']({ mode: 'explain', request: 'x', materialIds: wanted })
  for (const [name, kept] of Object.entries(seen)) assert.deepEqual(kept, wanted.slice(0, 30), name)
  assert.equal(Object.keys(seen).length, 7)
})

test('a thing made from many materials is named by the first two and how many', () => {
  assert.equal(materialsTitle(['甲', '乙', '丙', '丁']), '甲 + 乙 + 丙 + 丁')
  assert.equal(materialsTitle(['甲', '乙', '丙', '丁', '戊'], 'zh-CN'), '甲 + 乙 等 5 份资料')
  assert.equal(materialsTitle(['A', 'B', 'C', 'D', 'E', 'F'], 'en'), 'A + B and 4 more')
  assert.equal(materialsTitle([]), '')
})

test('course design gives each material less of its contents only past 15 of them', () => {
  assert.deepEqual([1, 2, 8, 12, 15, 16, 30].map(contentsShare), [6000, 3000, 800, 800, 800, 750, 400])
  const outline = { source: 'headings', entries: Array.from({ length: 40 }, (_, index) => ({ title: `第 ${index + 1} 章 数列与极限的性质`, level: 1, page: index * 5 + 1, end: index * 5 + 5 })) }
  const material = (n, summary) => ({ meta: { id: `mat_${n}`, title: `讲义 ${n}`, kind: 'pdf', pages: 200, outline, brief: { summary } }, chunks: [] })
  const eight = materialsSummary(Array.from({ length: 8 }, (_, index) => material(index + 1, '概要'.repeat(300))), { refs: true })
  assert.match(eight, /\n {2}(概要){300}\n/u, 'eight materials keep their whole brief')
  const thirty = materialsSummary(Array.from({ length: 30 }, (_, index) => material(index + 1, '概要'.repeat(300))), { refs: true })
  for (let n = 1; n <= 30; n += 1) assert.match(thirty, new RegExp(`\\[M${n}\\] 讲义 ${n} `, 'u'))
  assert.match(thirty, /\[M30\.1\]/u, 'the last one still shows its contents')
  assert.match(thirty, /\n {2}(概要){133}…\n/u, 'and a shorter brief')
  assert.ok(thirty.length < 30 * 1000, `thirty materials stay short: ${thirty.length}`)
  assert.ok(thirty.length < eight.length * 3, 'not four times as long as eight')
})

test('with many materials, a lesson gets the passages that match best, wherever they are', () => {
  // Every material mentions derivatives; the last one is about L'Hôpital.
  const filler = '这一节复习导数的定义和求导法则。'.repeat(60)
  const materials = Array.from({ length: 30 }, (_, index) => ({
    meta: { id: `mat_${index + 1}`, title: `讲义 ${index + 1}` },
    chunks: [{ id: 'c1', page: 1, text: index === 29 ? `洛必达法则：0/0 型极限可以对分子分母分别求导。${'洛必达法则的条件与导数。'.repeat(40)}` : filler }],
  }))
  const found = materialPassages(materials, { query: '洛必达法则 导数', maxChars: 9000 })
  assert.match(found.text, /<<讲义 30 · p\.1>>\n洛必达法则/u, 'the best match is in the 30th material')
  assert.ok(found.text.length <= 9000 + 30 * 20)
  // Three materials still get a share each.
  const few = materialPassages(materials.slice(27), { query: '洛必达法则 导数', maxChars: 9000 })
  assert.deepEqual(few.passages.map(passage => passage.materialId), ['mat_28', 'mat_29', 'mat_30'])
})

test('a material of one long chunk is excerpted, not lost', () => {
  const one = [{ id: 'c1', page: 1, text: '甲'.repeat(1600) }]
  assert.deepEqual(spreadPassages(one, { maxChars: 300, samples: 2 }).map(chunk => chunk.text.length), [301], 'cut to its room, with …')
  assert.deepEqual(samplePassages(one, { maxChars: 600 }).map(chunk => chunk.text.length), [601])
  // Nothing matches: each of many one-chunk materials is sampled.
  const many = Array.from({ length: 30 }, (_, index) => ({ meta: { id: `mat_${index + 1}`, title: `照片 ${index + 1}` }, chunks: one }))
  assert.equal(materialPassages(many, { query: 'Taylor', maxChars: 9000 }).sampled, true)
})

test('thirty short materials are read a few to a part; up to 24, a part never mixes two', () => {
  const doc = (n, chars) => ({ title: `试卷 ${n}`, chunks: [{ id: 'c1', page: 1, text: 'x'.repeat(chars) }] })
  const thirty = materialParts(Array.from({ length: 30 }, (_, index) => doc(index + 1, 3000)))
  assert.equal(thirty.length, 5, 'six papers of 3,000 characters to a part')
  assert.ok(thirty.every(part => part.mixed && part.chars <= 20000))
  assert.equal(thirty[0].title, '试卷 1 + 试卷 2 + 试卷 3 + 试卷 4 + 试卷 5 + 试卷 6')
  assert.deepEqual(thirty[0].passages.map(passage => passage.source), ['试卷 1', '试卷 2', '试卷 3', '试卷 4', '试卷 5', '试卷 6'])
  assert.equal(thirty.reduce((sum, part) => sum + part.passages.length, 0), 30, 'every paper is read')

  const big = materialParts([doc(1, 3000), { title: '课本', chunks: Array.from({ length: 30 }, (_, index) => ({ id: `c${index + 1}`, page: index + 1, text: 'y'.repeat(1600) })) }, ...Array.from({ length: 28 }, (_, index) => doc(index + 2, 3000))])
  const book = big.filter(part => part.title === '课本')
  assert.equal(book.length, 1, 'a long material among many is read on its own')
  assert.ok(!book[0].mixed && book[0].passages.every(passage => !passage.source))

  const some = materialParts(Array.from({ length: 24 }, (_, index) => doc(index + 1, 3000)))
  assert.equal(some.length, 24)
  assert.ok(some.every(part => !part.mixed))
  // A long book with 23 short handouts: 24 parts in all, not one per handout on top.
  const uneven = materialParts([{ title: '课本', chunks: Array.from({ length: 300 }, (_, index) => ({ id: `c${index + 1}`, page: index + 1, text: 'z'.repeat(1600) })) }, ...Array.from({ length: 23 }, (_, index) => doc(index + 1, 1000))])
  assert.equal(uneven.length, 24)
})

// A ready course whose blueprint revision returns the outline unchanged.
async function readyCourse(t, materialCount) {
  const root = await mkdtemp(join(tmpdir(), 'aha-limit-'))
  const store = createStore({ root: join(root, 'data') })
  const calls = []
  const llm = {
    supportsImages: () => false,
    async complete(request) { calls.push(request); return /<current_blueprint>\n([\s\S]*?)\n<\/current_blueprint>/u.exec(request.user)?.[1] ?? '{}' },
    async stream(request) { const full = await this.complete(request); request.onText?.(full); return full },
  }
  const jobs = createJobs()
  const courses = createCourses({ store, llm, jobs })
  t.after(async () => {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  })
  for (const id of ids(40)) {
    await store.writeJson(store.paths.material(id), { id, title: `讲义 ${id.slice(-2)}`, kind: 'pdf', pages: 3, chars: 4000, brief: { summary: '一份讲义', topics: ['导数'] } })
    await store.writeJson(store.paths.materialChunks(id), [{ id: 'c1', page: 1, text: `${id}：导数的定义。${'求导法则与例题。'.repeat(250)}` }])
  }
  const blueprint = normalizeBlueprint({ title: '微积分', units: [{ title: '导数', lectures: [{ title: '定义', lessons: [{ title: '导数是什么', concepts: ['导数'], estMinutes: 12 }] }] }] }, { language: 'zh-CN' })
  const course = { id: 'crs_limit0001', schemaVersion: 1, status: 'ready', goal: '学微积分', language: 'zh-CN', ...blueprint, materialIds: ids(materialCount) }
  await store.writeJson(store.paths.course(course.id), course)
  const finish = async started => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const job = jobs.get(started.id)
      if (job.status !== 'running') {
        if (job.status !== 'done') throw Object.assign(new Error(job.error?.message), { code: job.error?.code })
        return job.result
      }
      await new Promise(resolve => { setTimeout(resolve, 2) })
    }
    throw new Error('job timed out')
  }
  return { courses, course, calls, finish }
}

test('materials beyond a course\'s room are refused, not dropped; up to 30 are added', async t => {
  const { courses, course, finish } = await readyCourse(t, 28)
  const all = ids(40)
  await assert.rejects(finish(courses.addMaterials({ courseId: course.id, materialIds: all.slice(28, 31) })), error => error.code === 'materials-too-many')
  const { proposal } = await finish(courses.addMaterials({ courseId: course.id, materialIds: all.slice(28, 30) }))
  assert.equal(proposal.materials.length, 2)
  const { course: applied } = await courses.applyProposal({ courseId: course.id })
  assert.equal(applied.materialIds.length, 30)
  await assert.rejects(finish(courses.addMaterials({ courseId: course.id, materialIds: all.slice(30, 31) })), error => error.code === 'materials-full')
})

test('thirty materials added at once share 9,000 characters of excerpts', async t => {
  const { courses, course, calls, finish } = await readyCourse(t, 0)
  await finish(courses.addMaterials({ courseId: course.id, materialIds: ids(30) }))
  const passages = /<material_passages>\n([\s\S]*?)\n<\/material_passages>/u.exec(calls.at(-1).user)[1]
  for (const id of ids(30)) assert.ok(passages.includes(`${id}：`), id)
  assert.ok(passages.length < 15000, `excerpts stay near their room: ${passages.length}`)
})

test('a course can start with 30 materials, each once', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aha-limit-start-'))
  const store = createStore({ root: join(root, 'data') })
  const jobs = createJobs()
  const llm = { supportsImages: () => false, complete: async () => '{}', stream: async () => '{}' }
  const courses = createCourses({ store, llm, jobs })
  t.after(async () => {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const started = courses.startCraft({ goal: '学微积分', quick: true, materialIds: [...ids(31), ...ids(2)] })
  for (let attempt = 0; attempt < 500 && jobs.get(started.id).status === 'running'; attempt += 1) await new Promise(resolve => { setTimeout(resolve, 2) })
  const { courseId } = jobs.get(started.id).result
  assert.deepEqual((await courses.get({ courseId })).course.materialIds, ids(30))
})
