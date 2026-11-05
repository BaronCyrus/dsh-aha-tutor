import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkCite, checkRange, checkSheet, locateQuote, scrubItem, scrubPages, scrubStep, shownAside, shownBoard, shownSheet } from '../src/core/citations.js'
import { normalizeCheatsheet } from '../src/core/course-model.js'
import { createCourses } from '../src/host/courses.js'
import { generateSteps } from '../src/host/generate.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

const read = new Set(['12', '13'])
const sentences = value => (value.match(/[。！？!?]/gu) ?? []).length

test('pages that were not read are left out of what is said and written', () => {
  const cases = [
    ['请看课本第12页的例2。', '请看课本第12页的例2。'],
    ['请看课本第37页的例2。', '请看课本的例2。'],
    ['课本的第37页的例2', '课本的例2'],
    ['我们看第37页的图，它说明了什么？', '我们看书上的图，它说明了什么？'],
    ['书上第37页上的例题', '书上的例题'],
    ['回复力指向平衡位置（第37页）。', '回复力指向平衡位置。'],
    ['回复力指向平衡位置（见课本第37页）。', '回复力指向平衡位置。'],
    ['这一点（书上第37页也提到过，很重要）要记住。', '这一点（书上也提到过，很重要）要记住。'],
    ['第12–13页讲乘法，第40-41页是练习。', '第12–13页讲乘法，书上是练习。'],
    ['第12-37页', '书上'],
    ['这份讲义共3页。', '这份讲义共3页。'],
    ['See page 37 for details.', 'See the book for details.'],
    ['As shown on p. 37, the force points back.', 'As shown in the book, the force points back.'],
    ['The restoring force (p. 37) points back.', 'The restoring force points back.'],
    ['Read pp. 12–13 first.', 'Read pp. 12–13 first.'],
  ]
  for (const [before, after] of cases) assert.equal(scrubPages(before, read), after, before)
  // Sentence ends stay, so a step's ops keep the sentence they are written in.
  const said = '先看例题（课本第37页。）然后算。'
  assert.equal(sentences(scrubPages(said, read)), sentences(said))
  assert.equal(scrubPages('第12页', null), '书上', 'nothing read, nothing named')
})

test('a step and a question are checked in every text they show', () => {
  const step = {
    id: 's1',
    say: '翻到课本第37页。看第12页的例2。',
    ops: [
      { id: 'o1', t: 'p', text: '（见第37页）' },
      { id: 'o2', t: 'list', items: ['第12页', '第37页的表'] },
      { id: 'o3', t: 'table', head: ['页'], rows: [['第37页']] },
      { id: 'o4', t: 'math', tex: 'x', text: 'x' },
    ],
    check: { kind: 'choice', prompt: '第37页的例题答案是？', options: [{ id: 'a', text: '见第12页' }, { id: 'b', text: 'p. 37' }], answer: 'a', explanation: '（第37页）因为……' },
  }
  const clean = scrubStep(step, read)
  assert.equal(clean.say, '翻到课本。看第12页的例2。')
  assert.deepEqual(clean.ops.map(op => op.id), ['o2', 'o3', 'o4'], 'a paragraph that was only a citation goes')
  assert.deepEqual(clean.ops[0].items, ['第12页', '书上的表'])
  assert.deepEqual(clean.ops[1].rows, [['书上']])
  assert.equal(clean.check.prompt, '书上的例题答案是？')
  assert.deepEqual(clean.check.options.map(option => option.text), ['见第12页', 'the book'])
  assert.equal(clean.check.explanation, '因为……')
  // Keys an item does not have stay missing.
  assert.deepEqual(Object.keys(scrubItem({ kind: 'number', prompt: '第37页', answer: 37 }, read)).sort(), ['answer', 'kind', 'prompt'])
})

test('boards written before pages were checked show none', () => {
  const old = { steps: [{ id: 's1', say: '看课本第12页。', ops: [] }] }
  assert.equal(shownBoard(old).steps[0].say, '看课本。')
  const checked = { ...old, pagesChecked: true }
  assert.equal(shownBoard(checked), checked)
  assert.equal(shownAside({ steps: old.steps }).steps[0].say, '看课本。')
  assert.equal(shownBoard(null), null)
})

test('quotes are found whatever the spacing, width or hyphenation', () => {
  const passages = [
    { page: 14, label: '12', source: '课本', materialId: 'mat_book00001', text: '回复力 F = −kx 的方向\n总是指向平衡位置，这是简谐运动的特点。' },
    { page: 15, label: '13', source: '课本', materialId: 'mat_book00001', text: 'The restoring force al-\nways points back to equilibrium.' },
  ]
  assert.equal(locateQuote('方向总是指向平衡位置', passages)?.page, 14, 'across a line break')
  assert.equal(locateQuote('ＴＨＥ restoring force always points back', passages)?.page, 15, 'full-width letters and a hyphenated break')
  assert.equal(locateQuote('总是指向平衡位置，这是简谐运动的特点与本质所在之处啊', passages)?.page, 14, 'half of a long quote is enough')
  assert.equal(locateQuote('平衡', passages), null, 'too short to tell')
  assert.equal(locateQuote('书里没有的一句话', passages), null)
  // A citation moves to the page its words are on.
  assert.deepEqual(checkCite({ page: '40', quote: '总是指向平衡位置', source: '?' }, { read: passages }), { page: '12', pdf: 14, source: '课本', materialId: 'mat_book00001', quote: '总是指向平衡位置', verified: true })
  // Words outside the passages read are looked for in the whole material.
  const all = [...passages, { page: 30, label: '28', source: '课本', text: '单摆的周期与质量无关。' }]
  assert.equal(checkCite({ page: '12', quote: '单摆的周期与质量无关' }, { read: passages, all })?.page, '28')
  assert.equal(checkCite({ page: '12' }, { read: passages, all }), null, 'no quote, no citation')
  assert.equal(checkCite({ page: '12', quote: '书里没有的一句话' }, { read: passages, all }), null)
  // A material without pages is cited by its section.
  assert.deepEqual(checkCite({ quote: '周期与质量无关' }, { read: [{ section: '单摆', source: '讲义', text: '周期与质量无关。' }] }), { section: '单摆', source: '讲义', quote: '周期与质量无关', verified: true })
})

test('a cheat sheet keeps checked citations only, old ones are not shown', () => {
  const passages = [{ page: 14, label: '12', source: '课本', text: '回复力总是指向平衡位置。' }]
  const sheet = checkSheet(normalizeCheatsheet({ title: '速查（第37页）', sections: [{ title: '回复力', items: [
    { kind: 'fact', text: '回复力指向平衡位置（第12页）', cite: { page: 99, quote: '回复力总是指向平衡位置' } },
    { kind: 'fact', text: '振幅', cite: { page: 12, quote: '这句话不在书里' } },
  ] }] }), { read: passages })
  assert.equal(sheet.title, '速查')
  assert.deepEqual(sheet.sections[0].items.map(item => item.cite?.page ?? null), ['12', null])
  assert.equal(sheet.sections[0].items[0].text, '回复力指向平衡位置（第12页）')
  // An older sheet's citations were never checked.
  const old = { sections: [{ items: [{ text: 'x', cite: { page: 12, source: '课本' } }, { text: 'y', cite: { page: '3', verified: true, pdf: 5 } }] }] }
  assert.deepEqual(shownSheet(old).sections[0].items.map(item => item.cite?.page ?? null), [null, '3'])
})

test('a note\'s page ranges count when both ends were read', () => {
  assert.equal(checkRange('12–13', read), '12–13')
  assert.equal(checkRange('p. 12-13', read), '12–13')
  assert.equal(checkRange('12', read), '12')
  assert.equal(checkRange('12–40', read), '')
  assert.equal(checkRange('第三章', read), '')
})

test('cleaning a streamed board drops marks on what it left out', async () => {
  const lines = [
    { say: '看这里。', ops: [{ t: 'p', text: '（第37页）', id: 'x' }, { t: 'p', text: '要点' }] },
    { say: '圈出来。', ops: [{ t: 'mark', ref: 'x', style: 'circle' }] },
  ].map(line => JSON.stringify(line)).join('\n')
  const llm = { async stream({ onText }) { onText(lines); return lines } }
  const shown = []
  const board = await generateSteps(llm, { prompt: { system: '', user: '' }, onStep: step => shown.push(step), clean: step => scrubStep(step, read) })
  assert.deepEqual(board.steps.map(step => step.ops.map(op => op.t)), [['p'], []])
  assert.deepEqual(shown.map(step => step.ops.length), [1, 0], 'the learner sees the cleaned steps as they stream')
})

function fakeLlm() {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify({ title: '小数', emoji: '🔢', summary: 's', units: [{ title: '小数乘法', lectures: [{ title: '乘法', lessons: [{ title: '小数乘小数', summary: '课本第1–2页的方法，另见第99页。', concepts: ['小数乘小数'], estMinutes: 12, src: ['M1.1'] }] }] }], projects: [] })
    if (user.includes('For EACH lesson write')) return JSON.stringify({ lessons: {} })
    if (user.includes('Teach this lesson')) return [{ say: '翻开课本第2页，看例2。再看第37页。', ops: [{ t: 'title', text: '小数乘小数' }, { t: 'note', tone: 'example', text: '例2（第2页）：3.5×4=14' }] }, { say: '课本第1页讲了方法。', ops: [{ t: 'p', text: '先乘再点' }] }, { say: '小结。', ops: [{ t: 'p', text: '积的小数位数' }] }].map(line => JSON.stringify(line)).join('\n')
    if (user.includes('raised a hand')) return JSON.stringify({ say: '书上第2页的例2，再对照第88页。', ops: [{ t: 'p', text: '3.5×4=14' }] })
    if (user.includes('Write structured study notes')) return '# 笔记\n\n小数乘小数先按整数乘（p. 2）。另见（p. 88）。'
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

test('lessons, raised hands and notes name only the pages they read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-cite-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm()
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner: createLearner({ store, llm }) })
    const studio = createStudio({ store, llm, jobs })
    const chunks = ['小数乘小数：先按整数乘法算出积，再点小数点。', '例2 小明买了3.5千克苹果，每千克4元。'].map((text, index) => ({ id: `c${index + 1}`, page: index + 3, label: String(index + 1), part: 1, text }))
    const meta = { id: 'mat_book00001', title: '数学', kind: 'pdf', pages: 4, chars: 60, printed: 'pdf', createdAt: new Date().toISOString(), brief: null, outline: { source: 'bookmarks', entries: [{ title: '小数乘小数', level: 1, page: 3, end: 4, first: 1, last: 2, label: '1', endLabel: '2' }, { title: '练习', level: 1, page: 4, end: 4, first: 2, last: 2, label: '2', endLabel: '2' }] } }
    await store.writeJson(store.paths.material(meta.id), meta)
    await store.writeJson(store.paths.materialChunks(meta.id), chunks)
    const { courseId } = await finish(jobs, courses.startCraft({ goal: '小数', materialIds: [meta.id] }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const lessonId = course.units[0].lectures[0].lessons[0].id
    assert.equal(course.units[0].lectures[0].lessons[0].summary, '课本第1–2页的方法，另见书上。', 'the outline names only pages its contents list')

    // The board read printed pages 1 and 2: it keeps those, not page 37.
    const { board } = await finish(jobs, (await lessons.prepare({ courseId, lessonId })).job)
    assert.equal(board.pagesChecked, true)
    assert.equal(board.steps[0].say, '翻开课本第2页，看例2。再看书上。')
    assert.equal(board.steps[0].ops[1].text, '例2（第2页）：3.5×4=14')
    assert.equal(board.steps[1].say, '课本第1页讲了方法。')
    // A raised hand keeps the page it was given and the board names.
    await finish(jobs, lessons.ask({ scope: { kind: 'lesson', courseId, lessonId }, question: '例2怎么做？' }))
    const { asides } = await lessons.get({ courseId, lessonId })
    assert.equal(asides[0].steps[0].say, '书上第2页的例2，再对照书上。')
    assert.equal(asides[0].pagesChecked, true)

    // A board from before shows no pages at all.
    await store.writeJson(store.paths.board(courseId, lessonId), { steps: [{ id: 's1', say: '看课本第2页。', ops: [] }] })
    assert.equal((await lessons.get({ courseId, lessonId })).board.steps[0].say, '看课本。')
    assert.equal((await lessons.prepare({ courseId, lessonId })).board.steps[0].say, '看课本。')

    // Notes cite the pages they were given; older notes cite none.
    const notes = await finish(jobs, studio.makeNotes({ materialIds: [meta.id] }))
    assert.equal(notes.item.markdown, '# 笔记\n\n小数乘小数先按整数乘（p. 2）。另见。')
    await store.writeJson(store.paths.item('sheets', 'chs_oldnotes01'), { id: 'chs_oldnotes01', kind: 'notes', title: 'old', markdown: '要点（p. 2）。', createdAt: new Date().toISOString() })
    assert.equal((await studio.getItem({ kind: 'sheets', id: 'chs_oldnotes01' })).item.markdown, '要点。')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a digest gives only pages it read, with their place in the PDF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-digest-pages-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const jobs = createJobs()
    const llm = {
      supportsImages: () => false,
      async complete(request) {
        if (request.user.includes('Describe this material')) return JSON.stringify({ summary: '见第99页', topics: ['小数'] })
        return JSON.stringify({ overview: '概览（第99页）', structure: [{ heading: '小数乘法', pages: '1–2', points: ['要点'] }, { heading: '编的章', pages: '50–60', points: ['x'] }], arguments: [{ claim: '积', support: 's', page: '2' }, { claim: '编', support: 's', page: '77' }] })
      },
      async stream(request) { return this.complete(request) },
    }
    const studio = createStudio({ store, llm, jobs })
    const chunks = ['小数乘小数。', '例2 苹果。'].map((text, index) => ({ id: `c${index + 1}`, page: index + 3, label: String(index + 1), part: 1, text }))
    await store.writeJson(store.paths.material('mat_digest001'), { id: 'mat_digest001', title: '数学', kind: 'pdf', pages: 4, chars: 20, createdAt: new Date().toISOString(), brief: null, digest: { overview: 'old', structure: [{ heading: 'h', pages: '1–2', points: [] }], arguments: [{ claim: 'c', support: 's', page: '1' }] } })
    await store.writeJson(store.paths.materialChunks('mat_digest001'), chunks)
    // A digest from before shows no pages.
    const before = (await studio.getMaterial({ id: 'mat_digest001' })).material.digest
    assert.deepEqual([before.structure[0].pages, before.arguments[0].page], ['', ''])
    const { material } = await finish(jobs, studio.digest({ id: 'mat_digest001' }))
    assert.equal(material.digest.pagesChecked, true)
    assert.equal(material.digest.overview, '概览')
    assert.deepEqual(material.digest.structure.map(part => [part.pages, part.pdf ?? null]), [['1–2', [3, 4]], ['', null]])
    assert.deepEqual(material.digest.arguments.map(argument => [argument.page, argument.pdf ?? null]), [['2', [4, 4]], ['', null]])
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
