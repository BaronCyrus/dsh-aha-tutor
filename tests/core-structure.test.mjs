import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boardToMarkdown, boardToPlainText, estimateSpeechMs, normalizeBoard, stepTiming } from '../src/core/board-script.js'
import { exportCoursePack, importCoursePack, parseCoursePack } from '../src/core/coursepack.js'
import {
  courseProgress,
  findLesson,
  insertLesson,
  intakeSummary,
  lessonAfter,
  nextLesson,
  normalizeBlueprint,
  normalizeCheatsheet,
  normalizeItem,
  normalizePractice,
  normalizeQuestionnaire,
  outlineForPrompt,
  safeRelativePath,
} from '../src/core/course-model.js'
import { assertId, isId, newId } from '../src/core/ids.js'
import { extractJson, parseJsonLines, repairTruncated } from '../src/core/json-extract.js'
import { addDays, buildPlan, daysBetween, toDay } from '../src/core/planner.js'

const rawBlueprint = {
  title: '数据分析入门',
  emoji: '📊 data',
  units: [
    {
      title: '描述统计',
      lectures: [
        { title: '集中趋势', lessons: [{ title: '均值与中位数', estMinutes: 20, concepts: ['均值', { name: '中位数' }] }, { title: '众数', minutes: 500 }] },
        { title: '', lessons: [{ title: 'dropped lecture' }] },
      ],
    },
    { title: '空单元', lectures: [] },
    { title: '推断统计', lectures: [{ title: '置信区间', lessons: [{ title: '点估计' }, { title: '' }] }] },
  ],
  projects: [{ title: '销售分析', kind: 'code', starterFiles: [{ path: 'data/sales.csv', content: 'a,b' }, { path: '../escape.txt', content: 'x' }, { path: 'CON.txt', content: 'x' }] }],
}

test('ids are file-name safe and validated', () => {
  const id = newId('crs')
  assert.ok(isId(id, 'crs'))
  assert.ok(!isId(id, 'les'))
  assert.ok(!isId('../crs_abcdef', 'crs'))
  assert.throws(() => assertId('crs_..', 'crs'))
  assert.throws(() => newId('BAD'))
})

test('extractJson recovers fenced, prose-wrapped, trailing-comma and truncated JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('Here you go: {"a":[1,2,],} thanks'), { a: [1, 2] })
  assert.deepEqual(extractJson('{"units":[{"title":"A"},{"title":"B","lessons":[{"title":"x"'), { units: [{ title: 'A' }, { title: 'B', lessons: [{ title: 'x' }] }] })
  assert.deepEqual(repairTruncated('{"a":"x","b":[1,2'), { a: 'x', b: [1, 2] })
  assert.throws(() => extractJson(''), /empty/)
  assert.throws(() => extractJson('no json here'), /did not contain/)
  const lines = parseJsonLines('{"say":"a"}\nnot json\n{"say":"b"}\n{"say":', { final: false })
  assert.equal(lines.items.length, 2)
  assert.equal(lines.rest, '{"say":')
})

test('questionnaire normalization keeps 2+ options and renumbers', () => {
  const result = normalizeQuestionnaire({ questions: [
    { prompt: '', options: ['a', 'b'] },
    { prompt: '你的基础？', options: ['零基础', { label: '会一点', detail: '学过 Python' }] },
    { prompt: '只有一个选项', options: ['x'] },
  ] })
  assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0].id, 'q1')
  assert.equal(result.questions[0].options[1].detail, '学过 Python')
  const summary = intakeSummary(result, { q1: { choice: ['b'], other: '用过 Excel' } })
  assert.match(summary, /会一点（学过 Python）；用过 Excel/)
})

test('blueprint normalization drops empty parts, clamps minutes and sanitizes project files', () => {
  const blueprint = normalizeBlueprint(rawBlueprint)
  assert.equal(blueprint.units.length, 2)
  assert.equal(blueprint.emoji, '📊')
  const firstLessons = blueprint.units[0].lectures[0].lessons
  assert.equal(firstLessons[0].concepts.length, 2)
  assert.equal(firstLessons[1].estMinutes, 90)
  assert.equal(firstLessons[1].concepts[0].name, '众数')
  assert.equal(blueprint.units[1].lectures[0].lessons.length, 1)
  assert.deepEqual(blueprint.projects[0].starterFiles.map(file => file.path), ['data/sales.csv'])
  assert.throws(() => normalizeBlueprint({ units: [] }), /no usable units/)
  assert.equal(safeRelativePath('a\\b.txt'), 'a/b.txt')
  assert.equal(safeRelativePath('C:/x.txt'), null)
  assert.equal(safeRelativePath('bad:name.txt'), null)
  assert.equal(safeRelativePath('trailing.'), null)
})

test('course queries walk lessons in order and report progress', () => {
  const course = { ...normalizeBlueprint(rawBlueprint), id: 'crs_test01' }
  const first = course.units[0].lectures[0].lessons[0]
  const progress = { lessons: { [first.id]: { status: 'done' } } }
  assert.equal(courseProgress(course, progress).done, 1)
  assert.equal(courseProgress(course, progress).total, 3)
  assert.equal(nextLesson(course, progress).lesson.title, '众数')
  assert.equal(lessonAfter(course, first.id).lesson.title, '众数')
  assert.equal(findLesson(course, first.id).unit.title, '描述统计')
  const added = insertLesson(course, first.id, { title: '补救：中位数再讲一遍', kind: 'remedial' })
  assert.equal(course.units[0].lectures[0].lessons[1].id, added.id)
  assert.match(outlineForPrompt(course, { withIds: true }), /补救/)
})

test('practice items normalize answers by id, index or text', () => {
  const choice = normalizeItem({ kind: 'choice', prompt: 'Q', options: ['x', 'y', 'z'], answer: 1 })
  assert.equal(choice.answer, 'b')
  const byText = normalizeItem({ prompt: 'Q', options: ['alpha', 'beta'], answer: 'Beta' })
  assert.equal(byText.kind, 'choice')
  assert.equal(byText.answer, 'b')
  assert.equal(normalizeItem({ kind: 'choice', prompt: 'Q', options: ['x', 'y'], answer: 'nope' }), null)
  const number = normalizeItem({ kind: 'number', prompt: 'g?', answer: '9.81', tolerance: 0.1 })
  assert.equal(number.answer, 9.81)
  const practice = normalizePractice({ items: [{ prompt: 'explain', kind: 'short', answer: 'because', conceptIds: ['cpt_x', 'cpt_unknown'] }] }, ['cpt_x'])
  assert.deepEqual(practice.items[0].conceptIds, ['cpt_x'])
})

test('cheatsheet normalization requires sections with items', () => {
  const sheet = normalizeCheatsheet({ title: 'T', sections: [{ title: 'A', items: [{ kind: 'formula', tex: 'a^2+b^2=c^2', page: 12 }, ''] }, { title: 'empty', items: [] }] })
  assert.equal(sheet.sections.length, 1)
  assert.equal(sheet.sections[0].items[0].cite.page, 12)
  assert.deepEqual(sheet.layout.order, ['sec1'])
  assert.throws(() => normalizeCheatsheet({ sections: [] }), /no sections/)
})

test('board normalization maps aliases, renumbers ops and repoints marks', () => {
  const board = normalizeBoard({ title: 'SHM', steps: [
    { say: '先看回复力。', ops: [{ type: 'heading', text: '回复力' }, { t: 'formula', tex: 'F=-kx', text: 'F = −kx', id: 'f' }] },
    { narration: '注意负号。', board: [{ t: 'highlight', ref: 'f', style: 'circle' }, { t: 'mark', ref: 'missing' }, { t: 'svg', svg: '<div>not svg</div>' }] },
    { say: '', ops: [] },
    { say: '小测验', check: { kind: 'choice', prompt: '负号表示？', options: ['方向相反', '大小为负'], answer: 0 } },
  ] })
  assert.equal(board.steps.length, 3)
  assert.deepEqual(board.steps[0].ops.map(op => op.id), ['o1', 'o2'])
  assert.equal(board.steps[1].ops.length, 1)
  assert.equal(board.steps[1].ops[0].ref, 'o2')
  assert.equal(board.steps[2].check.answer, 'a')
  assert.throws(() => normalizeBoard({ steps: [] }), /no steps/)
  const timing = stepTiming(board.steps[0])
  assert.ok(timing.durationMs >= timing.speechMs)
  assert.ok(estimateSpeechMs('这是一个测试句子') > 1000)
  assert.match(boardToPlainText(board), /F=-kx/)
  assert.match(boardToMarkdown(board), /### 回复力/)
})

test('animations keep an SVG poster for places scripts cannot run', () => {
  const html = '<!doctype html><canvas></canvas><script>/* loop */</script>'
  const poster = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
  const board = normalizeBoard({ steps: [{ say: '看动画。', ops: [
    { t: 'anim', html, poster, height: 9999 },
    { t: 'animation', html, poster: '<img src=x onerror=alert(1)>' },
    { t: 'anim', html, poster: `<svg>${'x'.repeat(60 * 1024)}</svg>` },
  ] }] })
  const [kept, notSvg, tooBig] = board.steps[0].ops
  assert.equal(kept.poster, poster)
  assert.equal(kept.height, 520)
  assert.equal(notSvg.t, 'anim')
  assert.equal(notSvg.poster, '')
  assert.equal(tooBig.poster, '')
})

test('planner spreads lessons over study days, keeps review time and flags deadlines', () => {
  const today = '2026-10-19' // a Monday
  const plan = buildPlan({
    today,
    settings: { weeklyMinutes: 150, studyDays: [1, 3, 5] },
    courses: [{ id: 'crs_a', title: 'A', deadline: '2026-10-23', lessons: Array.from({ length: 6 }, (_, index) => ({ id: `l${index}`, title: `L${index}`, minutes: 25 })) }],
    reviews: [{ id: 'r1', title: 'review', dueDay: today, minutes: 10 }],
    exams: [{ id: 'e1', title: 'midterm', day: '2026-10-30' }],
  })
  assert.equal(plan.dailyMinutes, 50)
  assert.equal(plan.days[0].day, today)
  assert.equal(plan.days[0].items[0].kind, 'review')
  assert.ok(plan.days.every(day => [1, 3, 5].includes(new Date(`${day.day}T12:00:00`).getDay()) || day.items.every(item => item.kind === 'exam')))
  assert.equal(plan.warnings[0].kind, 'deadline-at-risk')
  assert.ok(plan.warnings[0].neededWeeklyMinutes > 150)
  assert.ok(plan.days.some(day => day.items.some(item => item.kind === 'exam')))
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30)
  assert.equal(toDay(new Date(2026, 0, 5)), '2026-01-05')
})

test('course packs round-trip with fresh ids and remapped progress', () => {
  const course = { id: 'crs_orig01', ...normalizeBlueprint(rawBlueprint), goal: '学数据分析' }
  const lesson = course.units[0].lectures[0].lessons[0]
  const concept = lesson.concepts[0]
  const pack = exportCoursePack({
    course,
    progress: { lessons: { [lesson.id]: { status: 'done' } }, concepts: { [concept.id]: { pKnown: 0.8 } } },
    boards: { [lesson.id]: { steps: [{ say: 'hi', ops: [{ t: 'p', text: 'x' }], check: { kind: 'choice', prompt: '?', options: ['a', 'b'], answer: 'a', conceptIds: [concept.id] } }] } },
    practice: { [lesson.id]: { items: [{ kind: 'blank', prompt: '?', answer: ['x'], conceptIds: [concept.id] }] } },
    sheets: { [course.units[0].id]: { sections: [{ title: 'S', items: ['fact'] }] } },
  }, { includeProgress: true })
  const imported = importCoursePack(JSON.stringify(pack))
  assert.notEqual(imported.course.id, course.id)
  const newLesson = imported.course.units[0].lectures[0].lessons[0]
  const newConcept = newLesson.concepts[0]
  assert.notEqual(newLesson.id, lesson.id)
  assert.equal(imported.progress.lessons[newLesson.id].status, 'done')
  assert.equal(imported.progress.concepts[newConcept.id].pKnown, 0.8)
  assert.deepEqual(imported.boards[newLesson.id].steps[0].check.conceptIds, [newConcept.id])
  assert.deepEqual(imported.practice[newLesson.id].items[0].conceptIds, [newConcept.id])
  assert.ok(imported.sheets[imported.course.units[0].id])
  assert.throws(() => parseCoursePack('{"format":"other"}'), /not a course pack/)
  assert.throws(() => parseCoursePack('{oops'), /not valid JSON/)
  assert.throws(() => parseCoursePack({ format: 'aha-tutor.coursepack', version: 99 }), /newer version/)
})

test('ops keep the sentence they are written during, and steps the goal they serve', () => {
  const board = normalizeBoard({ steps: [
    { say: '先看公式。它说明方向相反。最后看图。', goal: 1, ops: [{ t: 'math', tex: 'F=-kx', at: 0 }, { t: 'p', text: '负号' }, { t: 'p', text: '方向', at: '1' }, { t: 'p', text: '回退', at: 0 }, { t: 'p', text: '图', at: 2 }] },
    { say: '回顾。', goal: 'x', ops: [{ t: 'note', text: '要点' }] },
  ] })
  assert.deepEqual(board.steps[0].ops.map(op => op.at), [0, 0, 1, 1, 2], 'missing ones repeat, and an op never goes back')
  assert.equal(board.steps[0].goal, 1)
  assert.equal(board.steps[1].ops[0].at, undefined, 'a step without any "at" stays unsynced')
  assert.equal(board.steps[1].goal, undefined)
})
