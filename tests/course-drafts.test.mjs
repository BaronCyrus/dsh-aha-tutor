import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createStore } from '../src/host/store.js'

const QUESTIONS = JSON.stringify({ questions: [{ prompt: '基础？', options: ['零', '一些'] }] })
const BLUEPRINT = JSON.stringify({
  title: '微积分',
  emoji: '📐',
  summary: '从极限到导数。',
  units: [{ title: '导数', lectures: [{ title: '定义', lessons: [{ title: '导数是什么', concepts: ['导数'], estMinutes: 12 }] }] }],
  projects: [],
})

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms) })

// A model whose answers are given per prompt kind: a string, or a function
// of the request (to fail, to wait for the signal, to ignore it).
function fakeLlm({ questions = QUESTIONS, blueprint = BLUEPRINT } = {}) {
  const answer = async request => {
    const value = request.user.includes('multiple-choice questions whose answers') ? questions : request.user.includes('Design the course blueprint') ? blueprint : '{}'
    return typeof value === 'function' ? value(request) : value
  }
  return {
    supportsImages: () => false,
    complete: answer,
    async stream(request) {
      const full = await answer(request)
      request.onText?.(full)
      return full
    },
  }
}

// Resolves with the job's result, or rejects with its error code.
async function finish(jobs, started) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = jobs.get(started.id)
    if (job.status !== 'running') {
      if (job.status !== 'done') throw Object.assign(new Error(job.error?.message), { code: job.error?.code })
      return job.result
    }
    await wait(2)
  }
  throw new Error('job timed out')
}

async function until(check) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await check()) return
    await wait(2)
  }
  throw new Error('condition not reached')
}

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aha-drafts-'))
  const store = createStore({ root: join(root, 'data') })
  const jobs = createJobs()
  const courses = createCourses({ store, llm: fakeLlm(options), jobs, ...(options.removeWaitMs ? { removeWaitMs: options.removeWaitMs } : {}) })
  t.after(async () => {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { store, jobs, courses }
}

// Which course ids have a folder on disk.
const folders = store => store.listIds(store.paths.courses(), 'crs')

test('a start that fails before its questions are written leaves no draft behind', async t => {
  const { store, jobs, courses } = await setup(t, { questions: () => { throw new Error('model down') } })
  const started = courses.startCraft({ goal: '学微积分' })
  await assert.rejects(finish(jobs, started), error => error.code === 'failed')
  await until(async () => !(await folders(store)).length)
  assert.deepEqual(await courses.list(), [])
})

test('a cancelled start is gone from the list at once, and its folder once its work stops', async t => {
  let release
  const { store, jobs, courses } = await setup(t, {
    // The model notices the cancel only when told to go on.
    questions: () => new Promise(resolve => { release = () => resolve(QUESTIONS) }),
  })
  const started = courses.startCraft({ goal: '学微积分' })
  await until(async () => (await courses.list()).length === 1)
  const [draft] = await courses.list()
  assert.equal(draft.status, 'intake', 'the draft shows while its questions are written')
  assert.equal((await courses.get({ courseId: draft.id })).jobs.questions?.id, started.id, 'and its page follows the start')

  jobs.cancel(started.id)
  assert.deepEqual(await courses.list(), [], 'gone at once, though its work is still running')
  await assert.rejects(courses.get({ courseId: draft.id }), error => error.code === 'not-found')
  release()
  await until(async () => !(await folders(store)).length)
  assert.deepEqual(await courses.list(), [], 'the answer that came too late wrote nothing')
})

test('a draft whose start died with DSH is removed once old; a finished start keeps its draft', async t => {
  const { store, jobs, courses } = await setup(t)
  const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString()
  await store.writeJson(store.paths.course('crs_orphan001'), { id: 'crs_orphan001', status: 'intake', goal: '学物理', starting: true, createdAt: minutesAgo(20) })
  // Another DSH process on the same data folder may be writing this one's questions.
  await store.writeJson(store.paths.course('crs_elsewhere1'), { id: 'crs_elsewhere1', status: 'intake', goal: '学化学', starting: true, createdAt: minutesAgo(2) })
  assert.deepEqual((await courses.list()).map(row => row.id), ['crs_elsewhere1'])
  await assert.rejects(courses.get({ courseId: 'crs_orphan001' }), error => error.code === 'not-found')
  await until(async () => !(await folders(store)).includes('crs_orphan001'))
  await courses.remove({ courseId: 'crs_elsewhere1' })

  const { courseId } = await finish(jobs, courses.startCraft({ goal: '学微积分' }))
  const { course, intake } = await courses.get({ courseId })
  assert.equal(course.starting, undefined, 'a draft with its questions is an ordinary draft')
  assert.equal(intake.questionnaire.questions.length, 1)
  assert.deepEqual((await courses.list()).map(row => row.id), [courseId])

  const quick = await finish(jobs, courses.startCraft({ goal: '学线代', quick: true }))
  assert.equal(quick.questionnaire, null)
  assert.equal((await courses.get({ courseId: quick.courseId })).course.starting, undefined, 'so is a quick start')
})

test('deleting a draft stops its blueprint, and what the blueprint still writes does not bring it back', async t => {
  let release
  const { store, jobs, courses } = await setup(t, {
    // The model ignores the cancel and answers after the course is removed.
    blueprint: () => new Promise(resolve => { release = () => resolve(BLUEPRINT) }),
    removeWaitMs: 20,
  })
  const { courseId } = await finish(jobs, courses.startCraft({ goal: '学微积分' }))
  const designing = courses.submitIntake({ courseId, answers: {} })
  await until(() => Boolean(release))
  assert.equal((await courses.list())[0].status, 'intake')

  await courses.remove({ courseId })
  assert.equal(jobs.get(designing.id).status, 'cancelled', 'the blueprint stopped')
  assert.deepEqual(await courses.list(), [])
  release()
  // The late blueprint is written, then removed again.
  await until(async () => !(await folders(store)).length && (await courses.list()).length === 0)
  await wait(30)
  assert.deepEqual(await folders(store), [])
})

test('deleting a course without running jobs removes it right away', async t => {
  const { store, jobs, courses } = await setup(t)
  const { courseId } = await finish(jobs, courses.startCraft({ goal: '学微积分' }))
  await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
  assert.equal((await courses.list())[0].status, 'blueprint')
  const before = Date.now()
  assert.deepEqual(await courses.remove({ courseId }), { removed: courseId })
  assert.ok(Date.now() - before < 1000, 'nothing to wait for')
  assert.deepEqual(await folders(store), [])
})
