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

test('the refresh after a lesson changes the tutor\'s entries and keeps the learner\'s', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-profile-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const replies = []
    const prompts = []
    const llm = { complete: async request => { prompts.push(request.user); return JSON.stringify(replies.shift()) } }
    let clock = Date.parse('2026-11-05T08:00:00Z')
    const learner = createLearner({ store, llm, now: () => new Date(clock) })
    const lesson = { course: { title: '微积分', language: 'zh-CN' }, lesson: { title: '导数' }, states: [] }
    const refresh = async reply => {
      replies.push(reply)
      clock += 11 * 60_000
      await learner.noteLesson(lesson)
    }
    // The tutor writes a first profile.
    await refresh({ background: '高二学生', goals: ['考试拿高分'], strengths: ['计算快'], weaknesses: ['链式法则', '符号粗心'], preferences: { style: '多举例' } })
    let profile = await learner.getProfile()
    assert.deepEqual(profile.weaknesses, ['链式法则', '符号粗心'])
    assert.deepEqual(profile.own.weaknesses, [])
    // The learner rewrites a goal, deletes a weak spot, adds one and edits the style.
    profile = await learner.saveProfile({ background: '高二学生', goals: ['期末考到 120 分'], strengths: ['计算快'], weaknesses: ['链式法则', '应用题读不懂'], preferences: { ...profile.preferences, style: '先讲直觉' } })
    assert.deepEqual(profile.own, { background: false, style: true, goals: ['期末考到 120 分'], strengths: [], weaknesses: ['应用题读不懂'] })
    assert.deepEqual(profile.removed, { goals: ['考试拿高分'], strengths: [], weaknesses: ['符号粗心'] })
    // The tutor's next refresh sees only its own entries and cannot undo the learner's.
    await refresh({ background: '高二理科生', goals: ['考试拿高分', '理解导数'], strengths: [], weaknesses: ['符号粗心'], preferences: { style: '多举例' } })
    assert.match(prompts[1], /<learner_wrote>[\s\S]*期末考到 120 分[\s\S]*应用题读不懂[\s\S]*先讲直觉[\s\S]*<\/learner_wrote>/u)
    assert.match(prompts[1], /<removed_by_learner>[\s\S]*符号粗心[\s\S]*<\/removed_by_learner>/u)
    assert.doesNotMatch(prompts[1].split('<current_profile>')[1].split('</current_profile>')[0], /期末考到|应用题读不懂|先讲直觉/u)
    profile = await learner.getProfile()
    assert.equal(profile.background, '高二理科生', 'a background the learner never edited is the tutor\'s')
    assert.deepEqual(profile.goals, ['期末考到 120 分', '理解导数'], 'a goal the learner replaced does not come back')
    assert.deepEqual(profile.weaknesses, ['应用题读不懂'], 'the tutor dropped 链式法则; 符号粗心 stays deleted')
    assert.equal(profile.preferences.style, '先讲直觉')
    // Once the learner empties the style it is the tutor's again.
    profile = await learner.saveProfile({ preferences: { ...profile.preferences, style: '' } })
    assert.equal(profile.own.style, false)
    await refresh({ preferences: { style: '多举例' } })
    assert.equal((await learner.getProfile()).preferences.style, '多举例')
    assert.deepEqual((await learner.clearProfile()).own, { background: false, style: false, goals: [], strengths: [], weaknesses: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
