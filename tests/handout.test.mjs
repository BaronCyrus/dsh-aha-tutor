import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { normalizeHandout } from '../src/core/course-model.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'

test('a handout keeps points, an example, mistakes, terms and questions', () => {
  const handout = normalizeHandout({
    title: '胡克定律',
    summary: '回复力与位移成正比。',
    points: ['回复力指向平衡位置', { title: '$F=-kx$', oneLine: '拉得越远，拉回的力越大', detail: '在弹性限度内' }, { oneLine: 'no title' }],
    example: { problem: 'k=200 N/m，x=5 cm，求 |F|', steps: ['换单位：0.05 m', '|F| = 200 × 0.05 = 10 N'], answer: '10 N' },
    mistakes: [{ mistake: '忘了把 cm 换成 m', fix: '先换单位再代入' }, 'string mistake', {}],
    glossary: [{ term: '劲度系数', meaning: '弹簧的硬度' }, { meaning: 'no term' }],
    questions: [{ question: '负号表示什么？', answer: '方向相反' }],
  })
  assert.deepEqual(handout.points.map(point => point.title), ['回复力指向平衡位置', '$F=-kx$'])
  assert.equal(handout.points[1].oneLine, '拉得越远，拉回的力越大')
  assert.deepEqual(handout.example.steps.length, 2)
  assert.deepEqual(handout.mistakes.map(item => item.mistake), ['忘了把 cm 换成 m', 'string mistake'])
  assert.deepEqual(handout.glossary.map(item => item.term), ['劲度系数'])
  assert.equal(handout.questions[0].answer, '方向相反')
  assert.equal(normalizeHandout({ points: ['x'], example: { steps: ['no problem'] } }).example, null)
  assert.throws(() => normalizeHandout({ points: [] }))
})

const blueprint = { title: '胡克定律', emoji: '🌀', summary: '弹簧。', units: [{ title: '回复力', lectures: [{ title: '胡克定律', lessons: [{ title: '弹簧的力', concepts: ['回复力'], estMinutes: 12 }] }] }], projects: [] }

function fakeLlm() {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) return JSON.stringify({ lessons: {} })
    if (user.includes('Teach this lesson')) return [{ say: '先看公式。', ops: [{ t: 'title', text: '弹簧的力' }, { t: 'math', tex: 'F=-kx' }] }, { say: '负号表示方向相反。', ops: [{ t: 'note', text: '负号 = 方向相反' }] }, { say: '总结。', ops: [{ t: 'p', text: '回复力' }] }].map(line => JSON.stringify(line)).join('\n')
    if (user.includes('Write the handout from what the board taught')) return JSON.stringify({ title: '', summary: '回复力。', points: [{ title: '$F=-kx$', oneLine: '方向相反' }], questions: [{ question: 'Q', answer: 'A' }] })
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

test('a lesson handout is made from its board once, then kept', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-handout-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm()
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const lessons = createLessons({ store, llm, jobs, courses, learner: createLearner({ store, llm }) })
    const { courseId } = await finish(jobs, courses.startCraft({ goal: '胡克定律' }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const lessonId = course.units[0].lectures[0].lessons[0].id
    await assert.rejects(lessons.handout({ courseId, lessonId }), error => error.code === 'no-board', 'no board, no handout')
    await finish(jobs, (await lessons.prepare({ courseId, lessonId })).job)

    const made = await finish(jobs, (await lessons.handout({ courseId, lessonId })).job)
    assert.equal(made.handout.title, '弹簧的力', 'the lesson title stands in for none')
    const call = llm.calls.find(entry => entry.user.includes('Write the handout'))
    assert.match(call.user, /<what_the_board_taught>[\s\S]*F=-kx[\s\S]*负号表示方向相反/u)
    assert.equal(call.effort, 'lowest')
    // Kept: the next request returns it without a model call.
    const count = llm.calls.length
    assert.equal((await lessons.handout({ courseId, lessonId })).handout.points[0].title, '$F=-kx$')
    assert.equal(llm.calls.length, count)
    assert.ok((await lessons.handout({ courseId, lessonId, force: true })).job, 'and can be made again')
    const routes = createRoutes({ lessons })
    await assert.rejects(async () => routes['lesson/handout']({ courseId, lessonId: '../x' }), error => error.code === 'invalid')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
