import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { blueprintDiff, LESSON_DEPTHS, normalizeBlueprint, normalizeLesson } from '../src/core/course-model.js'
import { createLearner } from '../src/host/learner.js'
import { blueprintPrompt, lessonPrompt, reworkPrompt } from '../src/host/prompts.js'
import { createStore } from '../src/host/store.js'

test('lessons carry a depth from a fixed set, and a changed depth is a change', () => {
  assert.deepEqual(LESSON_DEPTHS, ['intuition', 'definition', 'derivation', 'application', 'extension'])
  assert.equal(normalizeLesson({ title: '推导', depth: 'derivation' }).depth, 'derivation')
  assert.equal('depth' in normalizeLesson({ title: '随便', depth: 'deep' }), false, 'an unknown depth is left out')
  assert.equal('depth' in normalizeLesson({ title: '没有' }), false)
  const before = normalizeBlueprint({ units: [{ title: 'U', lectures: [{ title: 'L', lessons: [{ title: 'A', depth: 'intuition' }] }] }] })
  const after = structuredClone(before)
  after.units[0].lectures[0].lessons[0].depth = 'derivation'
  assert.deepEqual(blueprintDiff(before, after).changed.map(entry => entry.title), ['A'])
})

test('the blueprint asks for depths and a lesson is taught at its depth', () => {
  const blueprint = blueprintPrompt({ goal: '学微积分', language: 'zh-CN', intake: '', timeline: 'balanced' })
  assert.match(blueprint.user, /Give each lesson a "depth": "intuition"/u)
  assert.match(blueprint.user, /"depth":"intuition\|definition\|derivation\|application\|extension"/u)
  assert.match(reworkPrompt({ outline: '', unitTitle: 'U', lectureTitle: 'L', lesson: {}, mode: 'deepen', language: 'zh-CN' }).user, /"depth"/u)
  const base = { course: { title: '微积分', summary: '' }, unit: { title: '单元' }, lecture: { title: '讲' }, language: 'zh-CN' }
  const derived = lessonPrompt({ ...base, lesson: { title: '导数', objectives: [], concepts: [], estMinutes: 15, depth: 'derivation' }, learner: {} })
  assert.match(derived.user, /This lesson derives or proves the result/u)
  assert.doesNotMatch(derived.user, /Call the learner by name/u)
  const plain = lessonPrompt({ ...base, lesson: { title: '导数', objectives: [], concepts: [], estMinutes: 15 }, learner: { profile: { name: '小明' } } })
  assert.doesNotMatch(plain.user, /This lesson (builds|makes|derives|applies|goes)/u, 'no depth, no depth guidance')
  assert.match(plain.user, /The learner likes to be called: 小明/u)
  assert.match(plain.user, /Call the learner by name once, in the opening step\./u)
})

test('the profile keeps a name, and saving some fields keeps the others', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-profile-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const learner = createLearner({ store, llm: {} })
    assert.equal((await learner.getProfile()).name, '')
    await learner.saveProfile({ name: '  小明\n同学  ', background: '高二', goals: ['考试'] })
    let profile = await learner.getProfile()
    assert.equal(profile.name, '小明 同学')
    await learner.saveProfile({ name: undefined, background: '高三' })
    profile = await learner.getProfile()
    assert.deepEqual([profile.name, profile.background, profile.goals], ['小明 同学', '高三', ['考试']], 'fields left out keep their values')
    assert.equal((await learner.saveProfile({ name: 'x'.repeat(40) })).name.length, 20)
    assert.equal((await learner.clearProfile()).name, '')
    assert.match(await readFile(store.paths.profile(), 'utf8'), /"name": ""/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
