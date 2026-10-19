import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createProjects } from '../src/host/projects.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

const blueprint = {
  title: '简谐运动',
  subtitle: '从弹簧到单摆',
  emoji: '🌀',
  summary: '理解周期运动。',
  level: 'beginner',
  units: [
    { title: '回复力', lectures: [{ title: '胡克定律', lessons: [{ title: '弹簧的力', objectives: ['写出 F=-kx'], concepts: ['回复力'], estMinutes: 12 }, { title: '负号的含义', concepts: ['方向'], estMinutes: 10 }] }] },
    { title: '单摆', lectures: [{ title: '小角度', lessons: [{ title: '近似', concepts: ['小角近似'], estMinutes: 15 }] }] },
  ],
  projects: [{ title: '测量单摆周期', kind: 'code', brief: '用数据验证公式', unitIndex: 1, rubric: [{ criterion: '数据', points: 50 }, { criterion: '结论', points: 50 }] }],
}

function step(say, extra = {}) {
  return JSON.stringify({ say, ops: [{ t: 'p', text: say }], ...extra })
}

function fakeLlm() {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '你的基础？', topic: 'level', options: [{ label: '零基础' }, { label: '学过高中物理' }] }, { prompt: '目标？', options: ['考试', '兴趣'] }] })
    if (user.includes('Design the course blueprint')) return `好的，这是蓝图：\n\`\`\`json\n${JSON.stringify(blueprint)}\n\`\`\``
    if (user.includes('Apply the change request')) return JSON.stringify({ ...blueprint, title: '简谐运动（修订）' })
    if (user.includes('Split this lesson into two')) return JSON.stringify({ lessons: [{ title: '弹簧的力（上）', concepts: ['回复力'], estMinutes: 10 }, { title: '弹簧的力（下）', concepts: ['胡克定律'], estMinutes: 10 }] })
    if (user.includes('Expand every project')) {
      const id = /"id": "(prj_[a-z0-9]+)"/u.exec(user)?.[1]
      return JSON.stringify({ projects: [{ id, title: '测量单摆周期', kind: 'code', brief: '详细说明', milestones: [{ title: '采集数据' }], rubric: [{ criterion: '数据', points: 50 }, { criterion: '结论', points: 50 }], starterFiles: [{ path: 'main.py', content: '# TODO' }, { path: '../evil.py', content: 'x' }] }] })
    }
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [{ kind: 'choice', prompt: 'Q?', options: ['a', 'b', 'c'], answer: 1, conceptIds: [concept] }, { kind: 'number', prompt: 'k?', answer: 2, conceptIds: [concept] }] }])) })
    }
    if (user.includes('Teach this lesson')) {
      const concept = /Concepts \(id=name\): (cpt_[a-z0-9]+)/u.exec(user)?.[1]
      return [
        JSON.stringify({ say: '开场', ops: [{ t: 'title', text: '课' }, { t: 'h', text: '回复力' }] }),
        step('公式', { ops: [{ t: 'math', tex: 'F=-kx', id: 'eq' }] }),
        step('检查', { check: { kind: 'choice', prompt: '负号？', options: ['反向', '同向'], answer: 0, conceptIds: [concept] } }),
        step('总结'),
      ].join('\n')
    }
    if (user.includes('raised a hand')) return step('这是你问题的答案')
    if (user.includes('did not get this step')) return [step('换个例子'), step('再试一次')].join('\n')
    if (user.includes('Describe this material')) return JSON.stringify({ summary: '一份讲义', topics: ['回复力', '单摆'], level: 'beginner', suggestedGoal: '学会简谐运动' })
    if (user.includes('Write a cheat sheet')) return JSON.stringify({ title: '速查', sections: [{ title: '公式', items: [{ kind: 'formula', tex: 'T=2\\pi\\sqrt{L/g}', page: 2 }] }] })
    if (user.includes('two-minute explainer')) return [step('一'), step('二'), step('三')].join('\n')
    if (user.includes('Explain the concept')) return [step('概念'), step('例子')].join('\n')
    if (user.includes('Score each rubric')) return JSON.stringify({ scores: [{ criterionId: 'r1', points: 45, comment: '好' }, { criterionId: 'r2', points: 80, comment: '超分' }], summary: '不错', strengths: ['认真'], nextSteps: ['加图'] })
    if (user.includes('Update the profile')) return JSON.stringify({ background: '物理初学者', goals: ['理解振动'], strengths: [], weaknesses: ['负号'], preferences: { style: '多举例' }, newNote: '喜欢例子' })
    if (user.includes('went wrong somewhere')) return [step('这里少了负根'), step('记住正负')].join('\n')
    if (user.includes('<learner_working>')) return JSON.stringify({ score: 0.5, verdict: 'partial', feedback: '只找到一个根', errorTag: '漏了负根', wrongStep: '$x=2$', why: '开平方要取正负', fix: '$x=\\pm 2$' })
    if (user.includes('<learner_answer>')) return JSON.stringify({ score: 0.5, verdict: 'partial', feedback: '方向对了', errorTag: '缺单位' })
    return '{}'
  }
  return {
    calls,
    supportsImages: () => false,
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

test('end-to-end tutoring flow on the host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-services-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm()
    const jobs = createJobs()
    const learner = createLearner({ store, llm })
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner })
    const studio = createStudio({ store, llm, jobs })
    const projects = createProjects({ store, llm, jobs, courses, projectsRoot: join(root, 'projects') })

    // material → course
    const uploaded = await finish(jobs, studio.upload({ name: '讲义.md', base64: Buffer.from('# 简谐运动\n\n## 回复力\n回复力 F=-kx。\n\n## 单摆\n周期与质量无关。').toString('base64') }))
    assert.equal(uploaded.material.brief.topics[0], '回复力')

    const started = await finish(jobs, courses.startCraft({ goal: '我想学简谐运动', materialIds: [uploaded.material.id] }))
    assert.equal(started.questionnaire.questions.length, 2)
    const { courseId } = started
    const intakeJob = courses.submitIntake({ courseId, answers: { q1: { choice: ['b'], other: '' }, q9: { choice: ['a'] } }, timeline: 'intensive', weeklyMinutes: 120, deadline: '2026-12-01' })
    const drafted = await finish(jobs, intakeJob)
    assert.equal(drafted.course.status, 'blueprint')
    assert.deepEqual(jobs.get(intakeJob.id).progress, { done: 3, total: 0, label: 'blueprint' }, 'the streamed blueprint reports lessons written so far')
    // …and the outline as it grows, for the learner to watch.
    const outline = jobs.get(intakeJob.id).preview
    assert.equal(outline.title, '简谐运动')
    assert.deepEqual(outline.units[0].lectures[0].lessons, ['弹簧的力', '负号的含义'])
    assert.equal(drafted.course.settings.size, 'auto')
    assert.equal(drafted.course.language, 'zh-CN')
    assert.equal(drafted.course.projects[0].unitId, drafted.course.units[1].id)
    const intakePrompt = llm.calls.find(call => call.user.includes('Design the course blueprint')).user
    assert.match(intakePrompt, /学过高中物理/)
    assert.match(intakePrompt, /Intensive pace: for a broad subject, up to/)
    // A narrow goal or a time budget sizes the course; the pace is only a ceiling.
    assert.match(intakePrompt, /Size the course to the goal first[\s\S]*Never pad/)
    assert.match(intakePrompt, /一份讲义/)

    // A revision is only proposed until the learner applies it…
    const revised = await finish(jobs, courses.revise({ courseId, instruction: '标题加上修订' }))
    assert.equal(revised.proposal.blueprint.title, '简谐运动（修订）')
    const pending = await courses.get({ courseId })
    assert.equal(pending.course.title, '简谐运动')
    assert.equal(pending.proposal.instruction, '标题加上修订')
    await courses.discardProposal({ courseId })
    assert.equal((await courses.get({ courseId })).proposal, null, '…or discards it')
    await finish(jobs, courses.revise({ courseId, instruction: '标题加上修订' }))
    assert.equal((await courses.applyProposal({ courseId })).course.title, '简谐运动（修订）')
    assert.equal((await courses.get({ courseId })).proposal, null)
    // One lesson can be split in two (returned as an edit, not saved).
    const toSplit = (await courses.get({ courseId })).course.units[0].lectures[0].lessons[0]
    const split = await finish(jobs, courses.reworkLesson({ courseId, lesson: toSplit, unitTitle: '回复力', lectureTitle: '胡克定律', mode: 'split' }))
    assert.deepEqual(split.lessons.map(lesson => lesson.title), ['弹簧的力（上）', '弹簧的力（下）'])
    assert.ok(split.lessons.every(lesson => lesson.id !== toSplit.id))
    assert.match(llm.calls.at(-1).user, /弹簧的力/u)
    const confirmed = await finish(jobs, courses.confirm({ courseId }))
    assert.equal(confirmed.course.status, 'ready')
    assert.deepEqual(confirmed.warnings, [])
    assert.deepEqual(confirmed.course.projects[0].starterFiles.map(file => file.path), ['main.py'])
    const detail = await courses.get({ courseId })
    assert.equal(detail.ready.practice.length, 2, 'only the first unit gets practice when the course is confirmed')
    // A later lecture gets practice for all its lessons when one is practised…
    const laterLesson = confirmed.course.units[1].lectures[0].lessons[0]
    const later = await lessons.practice({ courseId, lessonId: laterLesson.id })
    assert.ok(later.job)
    const laterSets = await finish(jobs, later.job)
    assert.equal(laterSets.sets[laterLesson.id].items.length, 2)
    assert.ok((await lessons.practice({ courseId, lessonId: laterLesson.id })).practice, 'and keeps it')

    // classroom
    const firstLesson = confirmed.course.units[0].lectures[0].lessons[0]
    const secondLesson = confirmed.course.units[0].lectures[0].lessons[1]
    const prepared = await lessons.prepare({ courseId, lessonId: firstLesson.id })
    const boardResult = await finish(jobs, prepared.job)
    assert.equal(boardResult.board.steps.length, 4)
    assert.equal(boardResult.board.steps[2].check.conceptIds[0], firstLesson.concepts[0].id)
    assert.equal(jobs.get(prepared.job.id).partialCount, 4)
    for (let attempt = 0; attempt < 200 && !(await store.exists(store.paths.board(courseId, secondLesson.id))); attempt += 1) await new Promise(resolve => setTimeout(resolve, 3))
    assert.ok(await store.exists(store.paths.board(courseId, secondLesson.id)), 'next lesson was prefetched')
    assert.ok((await lessons.prepare({ courseId, lessonId: firstLesson.id })).board, 'saved board is reused')

    const asked = await finish(jobs, lessons.ask({ scope: { kind: 'lesson', courseId, lessonId: firstLesson.id }, stepIndex: 1, question: '为什么有负号？' }))
    assert.equal(asked.steps[0].say, '这是你问题的答案')
    assert.match(llm.calls.at(-1).user, /F=-kx/)
    const again = await finish(jobs, lessons.reexplain({ scope: { kind: 'lesson', courseId, lessonId: firstLesson.id }, stepIndex: 1, style: 'analogy', anchorStepId: 's3' }))
    assert.equal(again.steps.length, 2)
    // Both stay with the lesson, anchored where they were asked.
    const kept = (await lessons.get({ courseId, lessonId: firstLesson.id })).asides
    assert.deepEqual(kept.map(aside => [aside.kind, aside.anchorStepId]), [['question', 's2'], ['reexplain', 's3']])
    assert.equal(kept[0].question, '为什么有负号？')
    assert.equal(kept[0].steps[0].say, '这是你问题的答案')
    assert.equal(asked.aside.id, kept[0].id)

    // A written-out working that went wrong is graded line by line, corrected
    // at the board and kept with the lesson like the other asides.
    const workGrade = await lessons.grade({ item: { kind: 'work', prompt: '解 $x^2=4$', answer: '$x=\\pm 2$' }, response: '$x=2$' })
    assert.equal(workGrade.wrongStep, '$x=2$')
    assert.match(workGrade.fix, /\\pm/u)
    const corrected = await finish(jobs, lessons.correct({ scope: { kind: 'lesson', courseId, lessonId: firstLesson.id }, stepIndex: 2, item: { prompt: '解 $x^2=4$', answer: '$x=\\pm 2$' }, response: '$x=2$', grade: workGrade }))
    assert.equal(corrected.steps[0].say, '这里少了负根')
    assert.match(llm.calls.at(-1).user, /First wrong line: \$x=2\$/u)
    const correction = (await lessons.get({ courseId, lessonId: firstLesson.id })).asides.at(-1)
    assert.deepEqual([correction.kind, correction.errorTag, correction.anchorStepId], ['correction', '漏了负根', 's3'])
    assert.equal(corrected.aside.id, correction.id)

    const conceptId = firstLesson.concepts[0].id
    const recorded = await lessons.record({ courseId, lessonId: firstLesson.id, conceptIds: [conceptId], evidence: { kind: 'check', score: 0, confidence: 'sure', errorTag: '方向搞反' } })
    assert.equal(recorded.recommendation.action, 'remediate')
    await lessons.savePosition({ courseId, lessonId: firstLesson.id, stepIndex: 3 })
    const completed = await lessons.complete({ courseId, lessonId: firstLesson.id })
    assert.equal(completed.inserted.kind, 'remedial')
    assert.equal(completed.next.id, completed.inserted.id)
    assert.deepEqual(completed.inserted.concepts.map(concept => concept.id), [conceptId])
    // …and opening a lesson that has none prepares it in the background.
    const remedialBoard = await lessons.prepare({ courseId, lessonId: completed.inserted.id })
    await finish(jobs, remedialBoard.job)
    for (let attempt = 0; attempt < 300 && !(await store.exists(store.paths.practice(courseId, completed.inserted.id))); attempt += 1) await new Promise(resolve => setTimeout(resolve, 3))
    assert.ok(await store.exists(store.paths.practice(courseId, completed.inserted.id)))
    const graded = await lessons.grade({ item: { prompt: '解释负号', answer: '方向相反' }, response: '反方向' })
    assert.equal(graded.verdict, 'partial')

    // learner
    const plan = await learner.plan({ today: '2026-10-19' })
    assert.ok(plan.plan.days.length > 0)
    assert.ok(plan.plan.days.flatMap(day => day.items).some(item => item.kind === 'lesson'))
    const session = await learner.reviewSession()
    assert.equal(session.items.length, 0, 'the review is not due yet')
    // Once due, a course page can review its own course only.
    const dueLater = createLearner({ store, llm, now: () => new Date('2030-01-01T00:00:00Z') })
    assert.ok((await dueLater.reviewSession({ courseId })).items.length > 0)
    assert.ok((await dueLater.reviewSession({ courseId })).items.every(entry => entry.courseId === courseId))
    assert.equal((await dueLater.reviewSession({ courseId: 'crs_another1' })).items.length, 0)
    for (let attempt = 0; attempt < 100 && !(await learner.getProfile()).background; attempt += 1) await new Promise(resolve => setTimeout(resolve, 3))
    assert.equal((await learner.getProfile()).background, '物理初学者')

    // studio
    const sheet = await finish(jobs, studio.makeSheet({ materialIds: [uploaded.material.id] }))
    assert.equal(sheet.item.sheet.sections[0].items[0].cite.page, 2)
    const help = await finish(jobs, studio.assist({ mode: 'explain', request: '什么是简谐运动？' }))
    assert.equal(help.board.steps.length, 2)
    const followUp = await finish(jobs, studio.assist({ mode: 'explain', request: '再举个例子', threadId: help.threadId }))
    assert.equal(followUp.turn, 1)
    const short = await finish(jobs, studio.makeShort({ topic: '为什么单摆周期和质量无关' }))
    assert.equal(short.item.board.steps.length, 3)
    assert.equal((await studio.listItems({ kind: 'shorts' })).length, 1)

    // projects
    const project = confirmed.course.projects[0]
    const workspace = await projects.openWorkspace({ courseId, projectId: project.id })
    assert.deepEqual(workspace.written.sort(), ['PROJECT.md', 'main.py'])
    assert.match(await readFile(join(workspace.path, 'PROJECT.md'), 'utf8'), /测量单摆周期/)
    await writeFile(join(workspace.path, 'main.py'), 'print("my work")')
    assert.deepEqual((await projects.openWorkspace({ courseId, projectId: project.id })).written, [], 'user files are never overwritten')
    const reviewed = await finish(jobs, projects.submit({ courseId, projectId: project.id, notes: '我测了 10 次' }))
    assert.equal(reviewed.submission.review.total, 95)
    assert.match(llm.calls.at(-1).user, /my work/)

    // packs
    const exported = await courses.exportPack({ courseId, includeProgress: true })
    assert.match(exported.fileName, /\.aha-course\.json$/)
    const imported = await courses.importPack({ json: exported.json })
    assert.notEqual(imported.id, courseId)
    assert.equal((await courses.list()).length, 2)
    await courses.remove({ courseId })
    assert.equal((await courses.list()).length, 1)
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a long document is digested from notes on every part, and briefed from all of it', async () => {
  const seen = {}
  const root = await mkdtemp(join(tmpdir(), 'aha-digest-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const jobs = createJobs()
    const calls = []
    const llm = {
      supportsImages: () => false,
      async complete(request) {
        calls.push(request.user)
        if (request.user.includes('Describe this material')) return JSON.stringify({ summary: '一本书', topics: ['证明'], level: 'beginner', suggestedGoal: '读懂' })
        if (request.user.includes('Take notes on this part only')) {
          const [, part, of] = /Part (\d+) of (\d+)/u.exec(request.user)
          seen[part] = (seen[part] ?? 0) + 1
          // Part 2 fails once (with its repair round) and is read on the retry;
          // part 3 never comes back usable.
          if ((part === '2' && seen[part] <= 2) || part === '3') return '{}'
          return JSON.stringify({ sections: [{ heading: `第${part}/${of}部分`, points: ['要点'] }], keyIdeas: ['想法'] })
        }
        if (request.user.includes('notes_on_each_part')) return JSON.stringify({ overview: '全书概览', structure: [{ heading: '终章', points: ['收尾'] }], keyIdeas: ['k'], questions: ['q'] })
        return '{}'
      },
      async stream(request) {
        return this.complete(request)
      },
    }
    const studio = createStudio({ store, llm, jobs })
    const book = Array.from({ length: 120 }, (_, index) => `章节标记${index} ${'勾股定理的证明与应用。'.repeat(40)}`).join('\n\n')
    const uploaded = await finish(jobs, studio.upload({ name: 'book.md', bytes: Buffer.from(book) }))
    const brief = calls.find(user => user.includes('Describe this material'))
    assert.match(brief, /章节标记0 /u)
    assert.match(brief, /章节标记1[01]\d/u, 'the brief sees the end of the book, not just its opening')

    const { material } = await finish(jobs, studio.digest({ id: uploaded.material.id }))
    assert.equal(material.digest.overview, '全书概览')
    assert.deepEqual(seen, { 1: 1, 2: 3, 3: 4 }, 'a failed part is tried once more')
    assert.ok(calls.some(user => user.includes('Part 3 of 3') && /章节标记119/u.test(user)), 'the last part reaches the end of the book')
    const combine = calls.find(user => user.includes('notes_on_each_part'))
    for (const heading of ['第1/3部分', '第2/3部分']) assert.ok(combine.includes(heading), heading)
    assert.ok(!combine.includes('Part 3/3'))
    assert.equal(material.digest.missing.length, 1, 'the unread part is named in the digest')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
