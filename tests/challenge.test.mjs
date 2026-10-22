import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyFixes, boardForCheck, describeFixes, normalizeVerdict, prefixFixes, sanitizeStep } from '../src/core/board-fix.js'
import { normalizeBoard } from '../src/core/board-script.js'
import { newId } from '../src/core/ids.js'
import { createCourses } from '../src/host/courses.js'
import { createJobs } from '../src/host/jobs.js'
import { createLearner } from '../src/host/learner.js'
import { createLessons } from '../src/host/lessons.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'
import { furthestStep, transcriptEntries } from '../src/ui/board/sidepanel.js'

const BOARD = normalizeBoard([
  { say: '先看公式。', ops: [{ t: 'title', text: '胡克定律' }, { t: 'math', tex: 'F=-kx', id: 'eq', at: 0 }] },
  { say: '代入 k = 200，x = 5 cm。', ops: [{ t: 'p', text: '$x = 5$ cm $= 0.5$ m', at: 0 }, { t: 'math', tex: '|F| = 200 \\times 0.5 = 100\\ \\text{N}', at: 0 }, { t: 'mark', ref: 'eq', style: 'circle' }] },
  { say: '所以回复力是 100 牛。', ops: [{ t: 'note', text: '$|F| = 100$ N' }], check: { kind: 'number', prompt: '压缩 2 cm 时力多大？', answer: 40, explanation: '…', conceptIds: ['cpt_aaaaaaaa'] } },
], { conceptIds: ['cpt_aaaaaaaa'] })

test('a verdict keeps only the fixes that change something on the board', () => {
  const [, second, third] = BOARD.steps
  const verdict = normalizeVerdict({
    verdict: 'wrong',
    summary: '5 cm 是 0.05 m。',
    fixes: [
      { step: 's2', op: second.ops[0].id, replace: { t: 'p', text: '$x = 5$ cm $= 0.05$ m' } },
      { step: 's2', op: second.ops[1].id, replace: { t: 'math', tex: '|F| = 200 \\times 0.05 = 10\\ \\text{N}' } },
      { step: 's2', op: second.ops[2].id, replace: { t: 'p', text: 'a mark is not content' } },
      { step: 's2', op: 'o99', replace: { t: 'p', text: 'no such op' } },
      { step: 's9', say: 'no such step' },
      { step: 's1', op: BOARD.steps[0].ops[1].id, replace: { t: 'math', tex: 'F=-kx' } },
      { step: 's3', say: '所以回复力是 10 牛。', op: third.ops[0].id, replace: { t: 'note', text: '$|F| = 10$ N' } },
      { step: 's3', check: { kind: 'number', prompt: '压缩 2 cm 时力多大？', answer: 4, explanation: '…' } },
      { step: 's2', op: second.ops[0].id, replace: { t: 'p', text: 'a second fix of the same op' } },
    ],
  }, BOARD.steps)
  assert.equal(verdict.verdict, 'wrong')
  assert.deepEqual(verdict.fixes.map(fix => [fix.step, fix.op ?? (fix.say ? 'say' : 'check')]), [['s2', 'o3'], ['s2', 'o4'], ['s3', 'o6'], ['s3', 'say'], ['s3', 'check']])
  assert.equal(verdict.fixes.at(-1).check.answer, 4)
  assert.deepEqual(verdict.fixes.at(-1).check.conceptIds, ['cpt_aaaaaaaa'], 'a fixed check keeps its concepts')
  // Right and unclear carry no fixes; a reply without a verdict is not usable.
  assert.deepEqual(normalizeVerdict({ verdict: 'right', summary: '没错。', fixes: [{ step: 's2', say: 'x' }] }, BOARD.steps).fixes, [])
  assert.throws(() => normalizeVerdict({ summary: '?' }, BOARD.steps))
})

test('fixes keep ids and pacing, and remember what an op first said', () => {
  const { fixes } = normalizeVerdict({ verdict: 'wrong', fixes: [{ step: 's2', op: 'o4', replace: { t: 'math', tex: '|F| = 10\\ \\text{N}' } }, { step: 's2', say: '代入 k = 200，x = 0.05 m。' }] }, BOARD.steps)
  const { steps, applied } = applyFixes(BOARD.steps, fixes, { at: '2026-10-22T00:00:00.000Z' })
  assert.notEqual(steps, BOARD.steps)
  assert.equal(BOARD.steps[1].ops[1].tex, '|F| = 200 \\times 0.5 = 100\\ \\text{N}', 'the board given is not changed')
  const fixed = steps[1].ops[1]
  assert.deepEqual([fixed.id, fixed.at, fixed.tex], ['o4', 0, '|F| = 10\\ \\text{N}'])
  assert.deepEqual(fixed.fixed, { was: '|F| = 200 \\times 0.5 = 100\\ \\text{N}', at: '2026-10-22T00:00:00.000Z' })
  assert.equal(steps[1].say, '代入 k = 200，x = 0.05 m。')
  assert.equal(steps[1].ops[2].ref, 'o2', 'marks still point at their ops')
  assert.equal(steps[0], BOARD.steps[0], 'untouched steps stay as they were')
  assert.equal(applied.length, 2)
  // Fixed again, it still remembers the first version; a client applying
  // the host's fixes gets the same note.
  const again = applyFixes(steps, [{ step: 's2', op: 'o4', replace: { t: 'math', tex: '|F| = 10 N' } }])
  assert.equal(again.steps[1].ops[1].fixed.was, '|F| = 200 \\times 0.5 = 100\\ \\text{N}')
  assert.deepEqual(applyFixes(BOARD.steps, applied).steps[1].ops[1], fixed)
  // Asides on the client carry a prefix.
  assert.deepEqual(prefixFixes([{ step: 's1', op: 'o2', replace: {} }, { step: 's1', say: 'x' }], 'a3_'), [{ step: 'a3_s1', op: 'a3_o2', replace: {} }, { step: 'a3_s1', say: 'x' }])
})

test('the checking model sees the step in full and the board around it', () => {
  const svg = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'
  const steps = normalizeBoard([
    { say: '一', ops: [{ t: 'svg', svg, caption: '图' }] },
    { say: '二', ops: [{ t: 'svg', svg, caption: '图二' }] },
    { say: '三'.repeat(500), ops: [] },
  ]).steps
  const lines = boardForCheck(steps, 's2').split('\n')
  assert.deepEqual(lines.map(line => JSON.parse(line).id), ['s1', 's2', 's3'])
  assert.equal(JSON.parse(lines[1]).ops[0].svg, '…', 'diagrams of the board show their captions only')
  assert.deepEqual(boardForCheck(steps, 's2', { maxChars: 700 }).split('\n').map(line => JSON.parse(line).id), ['s1', 's2'], 'nearest steps first, within the budget')
  assert.match(describeFixes([{ step: 's2', say: '贰' }], steps), /s2 narration: 二 → 贰/u)
  // A step the classroom sends keeps its own ids; anything unusable goes.
  const sent = sanitizeStep({ id: 'a2_s1', say: '答案', ops: [{ t: 'p', text: '对', id: 'a2_o1', at: 0 }, { t: 'evil', id: 'a2_o2' }, { t: 'p', text: 'no id' }] })
  assert.deepEqual(sent, { id: 'a2_s1', say: '答案', ops: [{ id: 'a2_o1', t: 'p', text: '对', at: 0 }] })
  assert.equal(sanitizeStep({ id: '../x', say: 'x', ops: [] }), null)
})

test('an answer inserted earlier in the lesson hides no line already heard', () => {
  const before = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]
  const reached = furthestStep(before, 3)
  assert.equal(reached, 's4')
  // An answer about s1 goes in after s1: s4 moves from 3 to 5.
  const after = [{ id: 's1' }, { id: 'a1_s1', aside: true }, { id: 'a1_s2', aside: true }, { id: 's2' }, { id: 's3' }, { id: 's4' }]
  assert.equal(furthestStep(after, 1, reached), 's4', 'playing the answer keeps the furthest step')
  assert.equal(after.findIndex(step => step.id === furthestStep(after, 1, reached)), 5)
  assert.equal(furthestStep(after, 5, 's2'), 's4')
  assert.equal(furthestStep([], 0, null), null)
})

test('the transcript lists a challenge like a raised hand', () => {
  const entries = transcriptEntries([{ id: 's1', say: '一' }, { id: 'a1_s1', say: '核对', aside: true }], 5, [{ id: 'a1', kind: 'challenge', label: '这一步不对？ · 核对过，没有错', streaming: false, steps: [{ id: 'a1_s1' }] }])
  assert.deepEqual(entries.map(entry => [entry.kind, entry.text]), [['say', '一'], ['challenge', '这一步不对？ · 核对过，没有错'], ['say', '核对']])
})

// ── on the host ─────────────────────────────────────────────────────────────

const blueprint = {
  title: '胡克定律',
  emoji: '🌀',
  summary: '弹簧的力。',
  level: 'beginner',
  units: [{ title: '回复力', lectures: [{ title: '胡克定律', lessons: [{ title: '弹簧的力', objectives: ['算出回复力'], concepts: ['回复力'], estMinutes: 12 }, { title: '负号', concepts: ['方向'], estMinutes: 10 }] }] }],
  projects: [],
}

const lessonLines = concept => [
  { say: '先看公式。', ops: [{ t: 'title', text: '弹簧的力' }, { t: 'math', tex: 'F=-kx' }] },
  { say: '代入 x = 5 cm = 0.5 m。', ops: [{ t: 'p', text: '$x = 0.5$ m' }, { t: 'math', tex: '|F| = 100\\ \\text{N}' }] },
  { say: '所以是 100 牛。', ops: [{ t: 'note', text: '100 N' }], check: { kind: 'number', prompt: '压缩 2 cm？', answer: 40, conceptIds: [concept] } },
].map(line => JSON.stringify(line)).join('\n')

// A model that answers the course flow, and checks steps with the verdict
// the test sets (with fixes written against the ids it is shown).
function checkingLlm() {
  const calls = []
  let verdict = () => ({ verdict: 'right', summary: '没错。', fixes: [] })
  let gate = null
  const answer = ({ user }) => {
    if (user.includes('multiple-choice questions whose answers')) return JSON.stringify({ questions: [{ prompt: '基础？', options: ['零基础', '学过'] }] })
    if (user.includes('Design the course blueprint')) return JSON.stringify(blueprint)
    if (user.includes('For EACH lesson write')) {
      const lessons = [...user.matchAll(/\[(les_[a-z0-9]+)\][^|]*\| concepts: (cpt_[a-z0-9]+)/gu)]
      return JSON.stringify({ lessons: Object.fromEntries(lessons.map(([, id, concept]) => [id, { items: [{ kind: 'choice', prompt: 'Q?', options: ['a', 'b'], answer: 0, conceptIds: [concept] }] }])) })
    }
    if (user.includes('Teach this lesson')) return lessonLines(/Concepts \(id=name\): (cpt_[a-z0-9]+)/u.exec(user)?.[1])
    if (user.includes('Explain the concept')) return [{ say: '概念', ops: [{ t: 'p', text: '一' }] }, { say: '例子', ops: [{ t: 'math', tex: '2+2=5' }] }].map(line => JSON.stringify(line)).join('\n')
    if (user.includes('two-minute explainer')) return [{ say: '一', ops: [{ t: 'p', text: '一' }] }, { say: '二', ops: [{ t: 'math', tex: '1+1=3' }] }, { say: '三', ops: [] }].map(line => JSON.stringify(line)).join('\n')
    if (user.includes('raised a hand')) return JSON.stringify({ say: '答案是 3。', ops: [{ t: 'math', tex: '1+2=4' }] })
    if (user.includes('Decide whether step')) return JSON.stringify(verdict(user))
    if (user.includes('<check_result>')) return JSON.stringify({ say: user.includes('<check_result>\nwrong') ? '你说得对，这里错了。' : '这一步是对的。', ops: [{ t: 'p', text: '核对' }] })
    return '{}'
  }
  return {
    calls,
    supportsImages: () => false,
    setVerdict(next) { verdict = typeof next === 'function' ? next : () => next },
    hold() {
      let open
      gate = { opened: new Promise(resolve => { open = resolve }), open: () => open() }
    },
    release() {
      gate?.open()
      gate = null
    },
    async complete(request) {
      calls.push(request)
      return answer(request)
    },
    async stream(request) {
      calls.push(request)
      const full = answer(request)
      const held = gate
      if (held && request.user.includes('Teach this lesson')) {
        const lines = full.split('\n')
        request.onText(`${lines.slice(0, 2).join('\n')}\n`)
        await held.opened
        request.onText(lines.slice(2).join('\n'))
        return full
      }
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

async function setup(root) {
  const store = createStore({ root: join(root, 'data') })
  const llm = checkingLlm()
  const jobs = createJobs()
  const learner = createLearner({ store, llm })
  const courses = createCourses({ store, llm, jobs })
  const lessons = createLessons({ store, llm, jobs, courses, learner })
  const studio = createStudio({ store, llm, jobs })
  const { courseId } = await finish(jobs, courses.startCraft({ goal: '胡克定律' }))
  await finish(jobs, courses.submitIntake({ courseId, answers: {} }))
  const { course } = await finish(jobs, courses.confirm({ courseId }))
  const lesson = course.units[0].lectures[0].lessons[0]
  return { store, llm, jobs, lessons, studio, courseId, lesson, scope: { kind: 'lesson', courseId, lessonId: lesson.id } }
}

test('a wrong step is checked with thinking, fixed where it is kept and corrected at the board', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-challenge-'))
  try {
    const { store, llm, jobs, lessons, courseId, lesson, scope } = await setup(root)
    const { job: boardJob } = await lessons.prepare({ courseId, lessonId: lesson.id })
    await finish(jobs, boardJob)
    const progressBefore = JSON.stringify((await store.readJson(store.paths.progress(courseId), null))?.concepts ?? {})

    llm.setVerdict({ verdict: 'wrong', summary: '5 cm 是 0.05 m，力是 10 N。', fixes: [
      { step: 's2', op: 'o3', replace: { t: 'p', text: '$x = 0.05$ m' } },
      { step: 's2', op: 'o4', replace: { t: 'math', tex: '|F| = 10\\ \\text{N}' } },
      { step: 's2', say: '代入 x = 5 cm = 0.05 m。' },
      { step: 's3', op: 'o5', replace: { t: 'note', text: '10 N' } },
      { step: 's3', check: { kind: 'number', prompt: '压缩 2 cm？', answer: 4 } },
    ] })
    const result = await finish(jobs, lessons.challenge({ scope, stepIndex: 1, anchorStepId: 's2', target: { stepId: 's2' }, note: '5 cm 不是 0.5 m 吧？' }))
    assert.equal(result.verdict, 'wrong')
    assert.deepEqual(result.target, { main: true })
    assert.equal(result.fixes.length, 5)
    assert.equal(result.steps[0].say, '你说得对，这里错了。')

    // Checked by a model that thinks first, answered by one that does not.
    const check = llm.calls.find(call => call.user.includes('Decide whether step s2'))
    assert.equal(check.effort, 'low')
    assert.equal(check.purpose, 'teach')
    assert.match(check.user, /<challenged_step>\n\{"id":"s2","say":"代入 x = 5 cm = 0\.5 m。"/u)
    assert.match(check.user, /<learner_says>\n5 cm 不是 0\.5 m 吧？/u)
    const reply = llm.calls.find(call => call.user.includes('<check_result>'))
    assert.equal(reply.effort, 'lowest')
    assert.match(reply.user, /<fixes_made>\ns2 o3: \$x = 0\.5\$ m → \$x = 0\.05\$ m/u)

    // The saved board is fixed, ids and all; the answer stays with the lesson.
    const saved = await store.readJson(store.paths.board(courseId, lesson.id), null)
    assert.deepEqual(saved.steps[1].ops.map(op => [op.id, op.t, op.fixed?.was ?? null]), [['o3', 'p', '$x = 0.5$ m'], ['o4', 'math', '|F| = 100\\ \\text{N}']])
    assert.equal(saved.steps[1].say, '代入 x = 5 cm = 0.05 m。')
    assert.equal(saved.steps[2].check.answer, 4)
    assert.equal(saved.steps[2].check.id, 'k3')
    const kept = (await lessons.get({ courseId, lessonId: lesson.id })).asides.at(-1)
    assert.deepEqual([kept.kind, kept.verdict, kept.note, kept.anchorStepId], ['challenge', 'wrong', '5 cm 不是 0.5 m 吧？', 's2'])
    assert.equal(result.aside.id, kept.id)
    // Challenging never touches mastery.
    assert.equal(JSON.stringify((await store.readJson(store.paths.progress(courseId), null))?.concepts ?? {}), progressBefore)

    // A step that is right is explained, and nothing changes.
    llm.setVerdict({ verdict: 'right', summary: '负号表示方向。', fixes: [{ step: 's1', say: 'ignored' }] })
    const right = await finish(jobs, lessons.challenge({ scope, stepIndex: 0, target: { stepId: 's1' } }))
    assert.deepEqual([right.verdict, right.fixes], ['right', []])
    assert.match(llm.calls.findLast(call => call.user.includes('Decide whether step')).user, /<learner_says>\n\(no reason given\)/u)
    assert.equal((await store.readJson(store.paths.board(courseId, lesson.id), null)).steps[0].say, '先看公式。')

    // A step of a kept answer is fixed inside that answer.
    const asked = await finish(jobs, lessons.ask({ scope, stepIndex: 1, anchorStepId: 's2', question: '1+2 呢？' }))
    llm.setVerdict({ verdict: 'wrong', summary: '1+2=3。', fixes: [{ step: 's1', op: 'o1', replace: { t: 'math', tex: '1+2=3' } }] })
    const inAside = await finish(jobs, lessons.challenge({ scope, stepIndex: 1, anchorStepId: 's2', target: { stepId: 's1', asideId: asked.aside.id } }))
    assert.deepEqual(inAside.target, { asideId: asked.aside.id })
    const answers = (await lessons.get({ courseId, lessonId: lesson.id })).asides
    assert.equal(answers.find(aside => aside.id === asked.aside.id).steps[0].ops[0].tex, '1+2=3')
    assert.match(llm.calls.findLast(call => call.user.includes('<check_result>')).user, /<board_so_far>[\s\S]*F=-kx[\s\S]*1\+2=4/u, 'the answer sees the board up to that step')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('instant answers, shorts, answers the host does not keep, and boards still being written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-challenge-'))
  try {
    const { store, llm, jobs, lessons, studio, courseId, lesson, scope } = await setup(root)

    // An instant answer and a short are fixed where they are saved.
    const help = await finish(jobs, studio.assist({ mode: 'explain', request: '2+2？' }))
    llm.setVerdict({ verdict: 'wrong', summary: '2+2=4。', fixes: [{ step: 's2', op: 'o2', replace: { t: 'math', tex: '2+2=4' } }] })
    const thread = { kind: 'thread', id: help.threadId, turn: 0 }
    assert.equal((await finish(jobs, lessons.challenge({ scope: thread, stepIndex: 1, target: { stepId: 's2' } }))).fixes.length, 1)
    assert.equal((await store.readJson(store.paths.item('assist', help.threadId), null)).turns[0].board.steps[1].ops[0].tex, '2+2=4')
    const short = await finish(jobs, studio.makeShort({ topic: '1+1' }))
    llm.setVerdict({ verdict: 'wrong', summary: '1+1=2。', fixes: [{ step: 's2', op: 'o2', replace: { t: 'math', tex: '1+1=2' } }] })
    await finish(jobs, lessons.challenge({ scope: { kind: 'short', id: short.item.id }, stepIndex: 1, target: { stepId: 's2' } }))
    assert.equal((await store.readJson(store.paths.item('shorts', short.item.id), null)).board.steps[1].ops[0].tex, '1+1=2')

    // An answer the host does not keep comes whole, and its fixes name the
    // classroom's own ids; nothing is stored.
    llm.setVerdict(user => ({ verdict: 'wrong', summary: '1+2=3。', fixes: [{ step: /"id":"(a1_s1)"/u.exec(user)[1], op: 'a1_o1', replace: { t: 'math', tex: '1+2=3' } }] }))
    const local = await finish(jobs, lessons.challenge({ scope: thread, stepIndex: 1, anchorStepId: 's2', target: { step: { id: 'a1_s1', say: '答案是 3。', ops: [{ id: 'a1_o1', t: 'math', tex: '1+2=4' }] } } }))
    assert.deepEqual(local.target, { local: true })
    assert.deepEqual(local.fixes.map(fix => [fix.step, fix.op, fix.replace.tex]), [['a1_s1', 'a1_o1', '1+2=3']])

    // A board still being written is fixed once it is saved.
    llm.hold()
    const { job: writing } = await lessons.prepare({ courseId, lessonId: lesson.id })
    for (let attempt = 0; attempt < 500 && jobs.get(writing.id).partialCount < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 2))
    llm.setVerdict({ verdict: 'wrong', summary: '0.05 m。', fixes: [{ step: 's2', op: 'o3', replace: { t: 'p', text: '$x = 0.05$ m' } }] })
    const pending = lessons.challenge({ scope: { ...scope, jobId: writing.id }, stepIndex: 1, target: { stepId: 's2' } })
    for (let attempt = 0; attempt < 500 && jobs.get(pending.id).partialCount < 1; attempt += 1) await new Promise(resolve => setTimeout(resolve, 2))
    assert.equal(jobs.get(pending.id).status, 'running', 'the answer is on the board while the fix waits for the board')
    llm.release()
    const fixedLater = await finish(jobs, pending)
    assert.deepEqual(fixedLater.fixes.map(fix => fix.op), ['o3'])
    assert.equal((await store.readJson(store.paths.board(courseId, lesson.id), null)).steps[1].ops[0].fixed.was, '$x = 0.5$ m')
    jobs.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the challenge endpoint checks what it is given', async () => {
  const seen = []
  const routes = createRoutes({ lessons: { challenge: request => { seen.push(request); return { id: 'job_x' } } } })
  const scope = { kind: 'lesson', courseId: newId('crs'), lessonId: newId('les') }
  await routes['lesson/challenge']({ scope, stepIndex: 2, anchorStepId: 's3', target: { stepId: 's3' }, note: '不对' })
  await routes['lesson/challenge']({ scope, target: { stepId: 's1', asideId: newId('asd') } })
  await routes['lesson/challenge']({ scope, target: { step: { id: 'a1_s1', ops: [] } }, note: 5 })
  assert.deepEqual(seen.map(request => [request.target, request.note]), [[{ stepId: 's3' }, '不对'], [{ stepId: 's1', asideId: seen[1].target.asideId }, ''], [{ step: { id: 'a1_s1', ops: [] } }, '']])
  assert.throws(() => routes['lesson/challenge']({ scope, target: { stepId: 'x1' } }), error => error.code === 'invalid')
  assert.throws(() => routes['lesson/challenge']({ scope, target: { stepId: 's1', asideId: '../evil' } }), error => error.code === 'invalid')
  assert.throws(() => routes['lesson/challenge']({ scope: { kind: 'other' }, target: { stepId: 's1' } }), error => error.code === 'invalid')
})
