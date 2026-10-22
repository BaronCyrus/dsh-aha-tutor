import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'

const blueprint = {
  title: '微积分',
  emoji: '📐',
  summary: '从极限到导数。',
  units: [{ title: '导数', lectures: [{ title: '定义', lessons: [{ title: '导数是什么', concepts: ['导数'], estMinutes: 12, depth: 'intuition' }] }] }],
  projects: [],
}

function fakeLlm() {
  const calls = []
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [{ kind: 'choice', prompt: 'Q?', options: ['a', 'b'], answer: 0, conceptIds: [concept] }] }])) })
    }
    if (user.includes('The learner added these materials')) {
      const current = JSON.parse(/<current_blueprint>\n([\s\S]*?)\n<\/current_blueprint>/u.exec(user)[1])
      current.units.push({ title: '泰勒展开', lectures: [{ title: '多项式逼近', lessons: [{ title: '泰勒公式', concepts: ['泰勒公式'], estMinutes: 15, depth: 'derivation' }] }] })
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

test('materials added to a course become a proposal, and applying it attaches them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-addmat-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const llm = fakeLlm()
    const jobs = createJobs()
    const courses = createCourses({ store, llm, jobs })
    const { courseId } = await finish(jobs, courses.startCraft({ goal: '学微积分' }))
    await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
    const { course } = await finish(jobs, courses.confirm({ courseId }))
    const kept = course.units[0].lectures[0].lessons[0]
    const add = async (id, title, chunks) => {
      await store.writeJson(store.paths.material(id), { id, title, kind: 'pdf', chars: 100, createdAt: new Date().toISOString(), brief: { summary: `${title}的概要`, topics: ['泰勒'] } })
      await store.writeJson(store.paths.materialChunks(id), chunks.map((text, index) => ({ text, page: index + 1 })))
    }
    await add('mat_taylor0001', '泰勒讲义', ['泰勒公式与余项。', '常用展开式。'])

    const result = await finish(jobs, courses.addMaterials({ courseId, materialIds: ['mat_taylor0001', 'mat_taylor0001'], instruction: '重点补上余项' }))
    assert.deepEqual(result.proposal.materials, [{ id: 'mat_taylor0001', title: '泰勒讲义' }])
    assert.equal(result.proposal.instruction, '重点补上余项')
    const prompt = llm.calls.find(call => call.user.includes('The learner added these materials')).user
    assert.match(prompt, /<new_materials>[\s\S]*泰勒讲义/u)
    assert.match(prompt, /<material_passages>[\s\S]*泰勒公式与余项/u)
    assert.match(prompt, /<learner_request>\n重点补上余项/u)
    // Nothing changes until the proposal is applied.
    assert.equal((await courses.get({ courseId })).course.units.length, 1)
    assert.equal((await courses.get({ courseId })).proposal.materials[0].id, 'mat_taylor0001')
    const applied = await courses.applyProposal({ courseId })
    assert.deepEqual(applied.course.materialIds, ['mat_taylor0001'])
    assert.equal(applied.course.units.length, 2)
    assert.equal(applied.course.units[0].lectures[0].lessons[0].id, kept.id, 'a lesson left alone keeps its id, so its progress stays')
    assert.equal(applied.course.status, 'ready')

    // Errors say what went wrong.
    await assert.rejects(async () => courses.addMaterials({ courseId, materialIds: [] }), error => error.code === 'no-materials')
    await assert.rejects(finish(jobs, courses.addMaterials({ courseId, materialIds: ['mat_taylor0001'] })), error => error.code === 'materials-known')
    await assert.rejects(finish(jobs, courses.addMaterials({ courseId, materialIds: ['mat_missing001'] })), error => error.code === 'not-found')
    // The endpoint keeps only material ids.
    const seen = []
    const routes = createRoutes({ courses: { addMaterials: request => { seen.push(request); return { id: 'job_x' } } } })
    routes['course/add-materials']({ courseId, materialIds: ['mat_taylor0001', '../x', 5], instruction: 'x' })
    assert.deepEqual(seen[0].materialIds, ['mat_taylor0001'])
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
