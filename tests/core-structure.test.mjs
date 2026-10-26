import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boardToMarkdown, boardToPlainText, estimateSpeechMs, normalizeBoard, stepTiming } from '../src/core/board-script.js'
import { exportCoursePack, importCoursePack, parseCoursePack } from '../src/core/coursepack.js'
import {
  blueprintDiff,
  shortCourseTitle,
  blueprintOutline,
  diffIsEmpty,
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
import { addDays, buildPlan, daysBetween, mergeAgenda, planCalendar, toDay } from '../src/core/planner.js'

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
  // A figure is kept only when it is an SVG; the client sanitizes it.
  assert.match(normalizeItem({ kind: 'number', prompt: '面积？', answer: 12, svg: '<svg viewBox="0 0 10 10"><rect width="4" height="3"/></svg>' }).svg, /^<svg /u)
  assert.equal(normalizeItem({ kind: 'number', prompt: '面积？', answer: 12, svg: '<img src="x">' }).svg, undefined)
})

test('a question with several right options takes several answers, whatever the model called it', () => {
  const options = ['2', '4', '9', '15']
  // A choice whose key lists two options.
  const listed = normalizeItem({ kind: 'choice', prompt: '下列哪些是偶数？', options, answer: [0, 1] })
  assert.deepEqual([listed.kind, listed.answer], ['multi', ['a', 'b']])
  // A prompt that asks for several, with one right option (不定项).
  const told = normalizeItem({ kind: 'choice', prompt: '（多选）下列哪些是完全平方数？', options, answer: 'C' })
  assert.deepEqual([told.kind, told.answer], ['multi', ['c']])
  // Kinds and answers as models write them.
  const named = normalizeItem({ type: 'multi_select', question: 'Select all even numbers.', options, answer: 'A, B' })
  assert.deepEqual([named.kind, named.prompt, named.answer], ['multi', 'Select all even numbers.', ['a', 'b']])
  assert.deepEqual(normalizeItem({ kind: '多选题', prompt: 'Q', options, answer: ['A.', '(B)', 'b'] }).answer, ['a', 'b'])
  // A "multiple choice" question is the usual one-answer kind.
  const single = normalizeItem({ kind: 'multiple_choice', prompt: '哪个是质数？', options: ['4', '7', '9'], answer: 'B.' })
  assert.deepEqual([single.kind, single.answer], ['choice', 'b'])
  // An option whose text holds a comma is still one answer.
  assert.equal(normalizeItem({ kind: 'choice', prompt: '方程的解是？', options: ['3, 4', '5, 6'], answer: '3, 4' }).answer, 'a')
})

test('lists name a course by its main title', () => {
  assert.equal(shortCourseTitle('贝叶斯思维：一次阳性，你真的病了吗？'), '贝叶斯思维')
  assert.equal(shortCourseTitle('Bayesian thinking: one positive test'), 'Bayesian thinking')
  assert.equal(shortCourseTitle('简谐运动'), '简谐运动')
  assert.equal(shortCourseTitle('：没有主标题'), '：没有主标题')
})

test('a blueprint still being written yields its outline so far', () => {
  const partial = '好的：```json\n{"title":"配方法","units":[{"title":"认识完全平方","lectures":[{"title":"展开与配方","lessons":[{"title":"完全平方公式","estMinutes":12},{"title":"补全正方形","concepts":["配方"'
  assert.deepEqual(blueprintOutline(extractJson(partial)), {
    title: '配方法',
    units: [{ title: '认识完全平方', lectures: [{ title: '展开与配方', lessons: ['完全平方公式', '补全正方形'] }] }],
  })
  assert.deepEqual(blueprintOutline({}), { title: '', units: [] })
})

test('a revision lists added, removed, renamed and changed lessons', () => {
  const lesson = (id, title, estMinutes = 10) => ({ id, title, estMinutes, objectives: [], concepts: [] })
  const before = { title: '配方法', units: [{ id: 'unt_aaaaaa1', title: '一', lectures: [{ lessons: [lesson('les_aaaaaa1', '甲'), lesson('les_aaaaaa2', '乙'), lesson('les_aaaaaa3', '丙'), lesson('les_aaaaaa4', '戊')] }] }] }
  const after = { title: '配方法', units: [
    { id: 'unt_aaaaaa1', title: '一', lectures: [{ lessons: [lesson('les_aaaaaa1', '甲'), lesson('les_aaaaaa2', '乙（改）'), lesson('les_aaaaaa3', '丙', 20), lesson('les_bbbbbb1', '丁')] }] },
    { id: 'unt_bbbbbb1', title: '二', lectures: [] },
  ] }
  const diff = blueprintDiff(before, after)
  assert.deepEqual(diff.added, [{ title: '丁', unit: '一' }])
  assert.deepEqual(diff.removed, [{ title: '戊', unit: '一' }])
  assert.deepEqual(diff.renamed, [{ from: '乙', to: '乙（改）', unit: '一' }])
  assert.deepEqual(diff.changed, [{ title: '丙', unit: '一' }])
  assert.deepEqual([diff.unitsAdded, diff.unitsRemoved, diff.title], [['二'], [], null])
  assert.equal(diffIsEmpty(diff), false)
  assert.equal(diffIsEmpty(blueprintDiff(before, before)), true)
})

test('a board keeps one written-working check and asks later ones for the answer only', () => {
  const work = normalizeItem({ kind: 'work', prompt: '配方解 $x^2+6x=7$', answer: '$x^2+6x+9=16$\n$(x+3)^2=16$\n$x=1$ 或 $x=-7$', rubric: ['两边加 9', '开平方取正负'] })
  assert.equal(work.kind, 'work')
  assert.deepEqual(work.rubric, ['两边加 9', '开平方取正负'])
  assert.match(work.answer, /\(x\+3\)\^2=16/u)
  const board = normalizeBoard({ steps: [
    { say: '例题。', ops: [{ t: 'p', text: '例' }], check: { kind: 'work', prompt: '自己解一题', answer: '过程' } },
    { say: '再来。', ops: [{ t: 'p', text: '再' }], check: { kind: 'work', prompt: '再解一题', answer: '过程' } },
  ] })
  assert.deepEqual(board.steps.map(step => step.check.kind), ['work', 'short'])
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
    courses: [{ id: 'crs_a', title: 'A', emoji: '🎲', deadline: '2026-10-23', lessons: Array.from({ length: 6 }, (_, index) => ({ id: `l${index}`, title: `L${index}`, minutes: 25 })) }],
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
  assert.deepEqual(plan.days.flatMap(day => day.items).find(item => item.kind === 'lesson')?.courseEmoji, '🎲', 'lessons carry the course emoji for compact labels')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30)
  assert.equal(toDay(new Date(2026, 0, 5)), '2026-01-05')
})

test('time studied today comes off today\'s list instead of pulling more in', () => {
  const today = '2026-10-19'
  const course = { id: 'crs_a', title: 'A', lessons: Array.from({ length: 4 }, (_, index) => ({ id: `l${index}`, title: `L${index}`, minutes: 20 })) }
  const settings = { weeklyMinutes: 140, studyDays: [0, 1, 2, 3, 4, 5, 6] }
  assert.equal(buildPlan({ today, settings, courses: [course] }).days[0].day, today)
  const spent = buildPlan({ today, settings, courses: [course], spentToday: 20 })
  assert.equal(spent.days[0].day, '2026-10-20', 'a full day gets nothing more')
  const wider = { weeklyMinutes: 280, studyDays: settings.studyDays }
  assert.equal(buildPlan({ today, settings: wider, courses: [course], spentToday: 25 }).days[0].day, '2026-10-20', 'a lesson that no longer fits is not forced in once the learner has studied')
  const roomy = buildPlan({ today, settings: wider, courses: [course], spentToday: 15 })
  assert.equal(roomy.days[0].day, today)
  assert.deepEqual(roomy.days[0].items.map(item => item.refId), ['l0'])
})

test('the plan calendar keeps past days as planned and ticks what was done', () => {
  const today = '2026-10-21'
  const lesson = id => ({ kind: 'lesson', refId: id, courseId: 'crs_aaaaaa', title: id, minutes: 20 })
  const review = id => ({ kind: 'review', refId: id, courseId: 'crs_aaaaaa', title: id, minutes: 5 })
  assert.deepEqual(mergeAgenda([lesson('a')], [lesson('a'), lesson('b')]).map(item => item.refId), ['a', 'b'])
  const calendar = planCalendar({
    today,
    agenda: { '2026-10-19': [lesson('a'), review('crs_aaaaaa:k1'), review('crs_aaaaaa:k2')], '2026-10-20': [lesson('b')], [today]: [lesson('x')], '2026-10-25': [lesson('future')] },
    plan: { days: [{ day: '2026-10-20', items: [lesson('stale')] }, { day: today, items: [lesson('c')] }, { day: '2026-10-22', items: [lesson('d'), { kind: 'exam', refId: 'e1', title: 'exam', minutes: 0 }] }] },
    done: {
      lessons: new Map([['a', { day: '2026-10-19', item: lesson('a') }], ['z', { day: '2026-10-20', item: lesson('z') }], ['later', { day: '2026-10-30', item: lesson('later') }]]),
      reviews: new Map([['crs_aaaaaa:k1', '2026-10-19'], ['crs_aaaaaa:k2', '2026-10-21']]),
    },
    checks: [{ refId: 'b', day: '2026-10-20', item: lesson('b') }, { refId: 'x', day: '2026-10-22', item: lesson('x') }],
  })
  const byDay = Object.fromEntries(calendar.days.map(entry => [entry.day, entry.items.map(item => `${item.refId}:${item.checked}`)]))
  assert.deepEqual(byDay['2026-10-19'], ['a:auto', 'crs_aaaaaa:k1:auto', 'crs_aaaaaa:k2:false'], 'a review counts on the day it was done only')
  assert.deepEqual(byDay['2026-10-20'], ['b:manual', 'z:auto'], 'a lesson done on an unplanned day still shows there')
  assert.deepEqual(byDay[today], ['x:false', 'c:false'])
  assert.deepEqual(byDay['2026-10-22'], ['d:false', 'e1:false'], 'future days and exams are never ticked')
  assert.equal(byDay['2026-10-25'], undefined, 'only past agendas are kept')
  assert.equal(byDay['2026-10-30'], undefined)
  assert.deepEqual(calendar.today.map(item => item.refId), ['x', 'c'])
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
  assert.throws(() => parseCoursePack('{"format":"other"}'), error => error.code === 'bad-pack' && /not a course pack/u.test(error.message))
  assert.throws(() => parseCoursePack('{"format":"aha-tutor.coursepack","version":99}'), error => error.code === 'pack-too-new')
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
