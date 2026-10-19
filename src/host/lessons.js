// The classroom: lesson boards generated on demand (and the next one
// prefetched), raised-hand questions, re-explanations, understanding checks
// feeding the mastery model, and adaptive follow-ups when a lesson ends.

import { boardToPlainText } from '../core/board-script.js'
import { conceptIndex, findLesson, insertLesson, lessonAfter, normalizeCards, normalizeCheatsheet, normalizePractice, outlineForPrompt, text } from '../core/course-model.js'
import { assertId, newId } from '../core/ids.js'
import { applyEvidence, createConceptState, masteryPercent, recommendNext } from '../core/mastery.js'
import { createCard, gradeFromScore, review } from '../core/srs.js'
import { masteryFor, passagesFor, readMaterials, readProfile, readProgress } from './context.js'
import { generateJson, generateSteps, TutorError } from './generate.js'
import { askPrompt, cheatsheetPrompt, flashcardsPrompt, gradePrompt, lessonPrompt, quizPrompt, reexplainPrompt } from './prompts.js'

const EVENTS_KEPT = 200
// Questions and re-explanations kept per lesson, replayed where they were asked.
const ASIDES_KEPT = 30
const STEP_ID = /^s\d{1,4}$/u

export function createLessons({ store, llm, jobs, courses, learner, now = () => new Date() }) {
  const stamp = () => now().toISOString()

  async function context(courseId, lessonId) {
    const course = await courses.readCourse(courseId)
    const row = findLesson(course, assertId(lessonId, 'les'))
    if (!row) throw new TutorError('not-found', 'Lesson not found')
    return { course, row }
  }

  async function get({ courseId, lessonId }) {
    const { course, row } = await context(courseId, lessonId)
    const [board, practice, progress, asides] = await Promise.all([
      store.readJson(store.paths.board(courseId, lessonId), null),
      store.readJson(store.paths.practice(courseId, lessonId), null),
      readProgress(store, courseId),
      store.readJson(store.paths.asides(courseId, lessonId), null),
    ])
    return {
      courseId,
      language: course.language,
      unit: { id: row.unit.id, title: row.unit.title },
      lecture: { id: row.lecture.id, title: row.lecture.title },
      lesson: row.lesson,
      board,
      practice,
      asides: Array.isArray(asides?.items) ? asides.items : [],
      state: progress.lessons?.[lessonId] ?? { status: 'new', stepIndex: 0 },
      next: lessonAfter(course, lessonId)?.lesson ?? null,
      job: jobs.running(`board:${courseId}:${lessonId}`),
      mastery: Object.fromEntries(row.lesson.concepts.map(concept => [concept.id, masteryPercent(progress.concepts?.[concept.id] ?? createConceptState(concept.id, concept.name))])),
    }
  }

  async function buildBoard({ course, row, signal, onStep, directive, style }) {
    const progress = await readProgress(store, course.id)
    const profile = await readProfile(store)
    const materials = await readMaterials(store, course.materialIds ?? [])
    const query = `${row.lesson.title} ${row.lesson.objectives.join(' ')} ${row.lesson.concepts.map(concept => concept.name).join(' ')}`
    const rows = conceptIndex(course)
    const lessonsInOrder = [...new Set([...rows.values()].map(concept => concept.lessonId))]
    const previousId = lessonsInOrder[lessonsInOrder.indexOf(row.lesson.id) - 1]
    const previous = previousId ? findLesson(course, previousId)?.lesson : null
    const kindDirective = row.lesson.kind === 'remedial' ? 'remediate' : row.lesson.kind === 'review' ? 'review' : row.lesson.kind === 'challenge' ? 'challenge' : undefined
    const prompt = lessonPrompt({
      course,
      unit: row.unit,
      lecture: row.lecture,
      lesson: row.lesson,
      language: course.language,
      learner: { profile, mastery: masteryFor(course, progress, row.lesson.id) },
      passages: passagesFor(materials, query, 8000),
      previous: previous ? `${previous.title}: ${previous.summary}` : '',
      directive: directive ?? kindDirective,
      style,
    })
    return generateSteps(llm, {
      purpose: 'teach',
      prompt,
      maxTokens: 14000,
      signal,
      conceptIds: row.lesson.concepts.map(concept => concept.id),
      onStep,
      minSteps: 3,
    })
  }

  // Generate (or regenerate) a lesson board; steps stream into the job.
  async function prepare({ courseId, lessonId, force = false, style }) {
    const { course, row } = await context(courseId, lessonId)
    ensurePractice(course, row)
    // Regenerating replaces a board that is still being written, and drops
    // the questions asked about the old one.
    if (force) {
      jobs.cancelKey(`board:${courseId}:${lessonId}`)
      await store.writeJson(store.paths.asides(courseId, lessonId), { items: [] })
    }
    if (!force) {
      const existing = await store.readJson(store.paths.board(courseId, lessonId), null)
      if (existing) {
        prefetchNext(course, lessonId)
        return { board: existing }
      }
    }
    const job = jobs.start('lesson/board', async api => {
      api.progress(0, 1, 'writing')
      const board = await buildBoard({ course, row, signal: api.signal, onStep: step => api.push(step), style: text(style, 300) || undefined })
      const saved = { ...board, title: board.title || row.lesson.title, lessonId, createdAt: stamp() }
      await store.writeJson(store.paths.board(courseId, lessonId), saved)
      api.progress(1, 1, 'done')
      prefetchNext(course, lessonId)
      return { board: saved }
    }, { key: `board:${courseId}:${lessonId}`, meta: { courseId, lessonId } })
    return { job }
  }

  // Quietly prepare the following lesson so it starts instantly.
  function prefetchNext(course, lessonId) {
    const next = lessonAfter(course, lessonId)
    if (!next) return
    const key = `board:${course.id}:${next.lesson.id}`
    if (jobs.running(key)) return
    store.exists(store.paths.board(course.id, next.lesson.id)).then(exists => {
      if (exists || jobs.running(key)) return
      jobs.start('lesson/prefetch', async api => {
        const board = await buildBoard({ course, row: next, signal: api.signal, onStep: step => api.push(step) })
        const saved = { ...board, title: board.title || next.lesson.title, lessonId: next.lesson.id, createdAt: stamp() }
        await store.writeJson(store.paths.board(course.id, next.lesson.id), saved)
        return { board: saved }
      }, { key, meta: { courseId: course.id, lessonId: next.lesson.id, prefetch: true } })
    }).catch(() => undefined)
  }

  // Resolve the board a question refers to: a course lesson, an assist thread
  // or an explainer short.
  async function scopeBoard(scope) {
    if (scope?.kind === 'lesson') {
      const { course, row } = await context(scope.courseId, scope.lessonId)
      const board = await store.readJson(store.paths.board(course.id, row.lesson.id), null)
      return { course, lesson: row.lesson, board, language: course.language }
    }
    if (scope?.kind === 'thread' || scope?.kind === 'short') {
      const kind = scope.kind === 'thread' ? 'assist' : 'shorts'
      const item = await store.readJson(store.paths.item(kind, scope.id), null)
      if (!item) throw new TutorError('not-found', 'Not found')
      const board = scope.kind === 'thread' ? item.turns?.[Math.max(0, Math.min(item.turns.length - 1, Number(scope.turn) || 0))]?.board : item.board
      return { course: null, lesson: { title: item.title, objectives: [] }, board, language: item.language }
    }
    throw new TutorError('invalid', 'Unknown board')
  }

  // A lesson keeps its questions and re-explanations, so they are still on
  // the board (and in the classroom's transcript) when the learner comes back.
  // The job saves them itself: leaving mid-answer loses nothing.
  async function keepAside(scope, aside) {
    if (scope?.kind !== 'lesson') return null
    const saved = { id: newId('asd'), ...aside, at: stamp() }
    await store.updateJson(store.paths.asides(scope.courseId, scope.lessonId), null, value => ({
      items: [...(Array.isArray(value?.items) ? value.items : []), saved].slice(-ASIDES_KEPT),
    }))
    return saved
  }

  const anchorFor = (board, stepIndex, anchorStepId) => (STEP_ID.test(String(anchorStepId)) ? anchorStepId : board?.steps?.[Math.max(0, Number(stepIndex) || 0)]?.id ?? 's1')

  function ask({ scope, stepIndex = 0, question, anchorStepId }) {
    const request = text(question, 1500)
    if (!request) throw new TutorError('invalid', 'Type your question')
    return jobs.start('lesson/ask', async api => {
      const { course, lesson, board, language } = await scopeBoard(scope)
      const profile = await readProfile(store)
      const boardSoFar = board ? boardToPlainText(board, { uptoStep: Number(stepIndex) || 0, maxChars: 6000 }) : ''
      const answer = await generateSteps(llm, {
        purpose: 'quick',
        prompt: askPrompt({ course, lesson, language, boardSoFar, question: request, learner: { profile } }),
        maxTokens: 5000,
        signal: api.signal,
        conceptIds: lesson?.concepts?.map(concept => concept.id) ?? [],
        onStep: step => api.push(step),
      })
      const aside = await keepAside(scope, { kind: 'question', question: request, anchorStepId: anchorFor(board, stepIndex, anchorStepId), steps: answer.steps })
      if (scope.kind === 'lesson') await logEvent(scope.courseId, { type: 'question', lessonId: scope.lessonId, text: request.slice(0, 200) })
      return { steps: answer.steps, aside }
    })
  }

  function reexplain({ scope, stepIndex = 0, style = 'example', anchorStepId }) {
    return jobs.start('lesson/reexplain', async api => {
      const { course, lesson, board, language } = await scopeBoard(scope)
      if (!board?.steps?.length) throw new TutorError('invalid', 'Nothing to re-explain yet')
      const index = Math.min(board.steps.length - 1, Math.max(0, Number(stepIndex) || 0))
      const step = boardToPlainText({ steps: [board.steps[index]] }, { maxChars: 3000 })
      const answer = await generateSteps(llm, {
        purpose: 'teach',
        prompt: reexplainPrompt({ lesson, language, step, boardSoFar: boardToPlainText(board, { uptoStep: index, maxChars: 5000 }), style }),
        maxTokens: 6000,
        signal: api.signal,
        conceptIds: lesson?.concepts?.map(concept => concept.id) ?? [],
        onStep: next => api.push(next),
      })
      const aside = await keepAside(scope, { kind: 'reexplain', style, anchorStepId: anchorFor(board, index, anchorStepId), steps: answer.steps })
      if (scope.kind === 'lesson' && course) {
        const conceptIds = lesson.concepts.map(concept => concept.id)
        await record({ courseId: course.id, lessonId: lesson.id, conceptIds, evidence: { kind: 'reexplain' } })
      }
      return { steps: answer.steps, aside }
    })
  }

  // Apply one piece of evidence to the concepts it covers.
  async function record({ courseId, lessonId, conceptIds = [], evidence = {} }) {
    const course = await courses.readCourse(courseId)
    const index = conceptIndex(course)
    const ids = (Array.isArray(conceptIds) && conceptIds.length ? conceptIds : findLesson(course, lessonId)?.lesson.concepts.map(concept => concept.id) ?? [])
      .filter(id => index.has(id))
      .slice(0, 8)
    const at = now().getTime()
    const next = await store.updateJson(store.paths.progress(courseId), null, progress => {
      const value = progress ?? { courseId, lessons: {}, concepts: {}, reviews: {}, practice: {}, projects: {}, events: [] }
      value.concepts ??= {}
      value.reviews ??= {}
      for (const id of ids) {
        const state = value.concepts[id] ?? createConceptState(id, index.get(id).name)
        value.concepts[id] = applyEvidence(state, evidence, at)
        if (evidence.kind !== 'reexplain' && evidence.kind !== 'self' && Number.isFinite(Number(evidence.score))) {
          const card = value.reviews[id] ?? createCard(id, at)
          value.reviews[id] = review(card, gradeFromScore(Number(evidence.score), evidence.confidence), at)
        }
      }
      pushEvent(value, { type: 'evidence', lessonId: lessonId ?? null, conceptIds: ids, kind: evidence.kind ?? 'practice', score: evidence.score ?? null, confidence: evidence.confidence ?? null, at: new Date(at).toISOString() })
      return value
    })
    const states = ids.map(id => next.concepts[id]).filter(Boolean)
    return {
      mastery: Object.fromEntries(states.map(state => [state.id, masteryPercent(state)])),
      recommendation: recommendNext(states),
    }
  }

  async function grade({ item, response, language = 'zh-CN' }) {
    if (!item?.prompt) throw new TutorError('invalid', 'Missing question')
    const answer = text(response, 4000)
    if (!answer) return { score: 0, verdict: 'incorrect', feedback: '', errorTag: '', misconception: false }
    const result = await generateJson(llm, {
      purpose: 'quick',
      prompt: gradePrompt({ item: { prompt: text(item.prompt, 2000), answer: text(item.answer, 3000), rubric: Array.isArray(item.rubric) ? item.rubric.map(entry => text(entry, 300)) : [] }, response: answer, language }),
      maxTokens: 1200,
      normalize: raw => ({
        score: Math.min(1, Math.max(0, Number(raw?.score) || 0)),
        verdict: ['correct', 'partial', 'incorrect'].includes(raw?.verdict) ? raw.verdict : Number(raw?.score) >= 0.8 ? 'correct' : Number(raw?.score) >= 0.4 ? 'partial' : 'incorrect',
        feedback: text(raw?.feedback, 1200),
        errorTag: text(raw?.errorTag, 80),
        misconception: raw?.misconception === true,
      }),
    })
    return result
  }

  async function savePosition({ courseId, lessonId, stepIndex = 0 }) {
    assertId(lessonId, 'les')
    await store.updateJson(store.paths.progress(assertId(courseId, 'crs')), null, progress => {
      const value = progress ?? { courseId, lessons: {}, concepts: {}, reviews: {}, events: [] }
      value.lessons ??= {}
      const current = value.lessons[lessonId] ?? { status: 'new' }
      value.lessons[lessonId] = {
        ...current,
        status: current.status === 'done' ? 'done' : 'learning',
        stepIndex: Math.max(0, Math.min(500, Math.round(Number(stepIndex) || 0))),
        startedAt: current.startedAt ?? stamp(),
        lastAt: stamp(),
      }
      value.lastLessonId = lessonId
      return value
    })
    return { ok: true }
  }

  // Finish a lesson; adapt the course if the evidence says so.
  async function complete({ courseId, lessonId, selfRating }) {
    const { course, row } = await context(courseId, lessonId)
    if (selfRating) await record({ courseId, lessonId, evidence: { kind: 'self', rating: selfRating } })
    const progress = await store.updateJson(store.paths.progress(courseId), null, value => {
      const next = value ?? { courseId, lessons: {}, concepts: {}, reviews: {}, events: [] }
      next.lessons ??= {}
      next.lessons[lessonId] = { ...(next.lessons[lessonId] ?? {}), status: 'done', completedAt: stamp() }
      pushEvent(next, { type: 'lesson-done', lessonId, title: row.lesson.title, at: stamp() })
      return next
    })
    const states = row.lesson.concepts.map(concept => progress.concepts?.[concept.id]).filter(Boolean)
    const recommendation = recommendNext(states)
    let inserted = null
    const alreadyRemedial = row.lesson.kind === 'remedial'
    if (recommendation.action === 'remediate' && !alreadyRemedial) {
      const weak = row.lesson.concepts.filter(concept => recommendation.conceptIds.includes(concept.id))
      inserted = insertLesson(course, lessonId, {
        title: `${course.language?.startsWith('zh') ? '巩固：' : 'Revisit: '}${weak.map(concept => concept.name).join(course.language?.startsWith('zh') ? '、' : ', ') || row.lesson.title}`,
        summary: row.lesson.summary,
        objectives: row.lesson.objectives,
        concepts: weak,
        estMinutes: Math.min(15, row.lesson.estMinutes || 12),
        kind: 'remedial',
      })
      await courses.saveCourse(course)
    }
    learner.noteLesson({ course, lesson: row.lesson, states }).catch(() => undefined)
    return { recommendation, inserted, next: lessonAfter(course, lessonId)?.lesson ?? null }
  }

  // Practice for one lesson. The first unit's comes with the course; a later
  // lecture gets practice for all its lessons at once, in the background when
  // one of them is opened (prepare) or right away when it is practised. The
  // job result maps every lesson of the lecture to its set.
  async function practice({ courseId, lessonId }) {
    const { course, row } = await context(courseId, lessonId)
    const existing = await store.readJson(store.paths.practice(courseId, lessonId), null)
    if (existing) return { practice: existing }
    return { job: lecturePractice(course, row) }
  }

  function lecturePractice(course, row) {
    return jobs.start('lesson/practice', async api => {
      const missing = []
      for (const lesson of row.lecture.lessons) if (!(await store.exists(store.paths.practice(course.id, lesson.id)))) missing.push(lesson)
      const written = missing.length ? await courses.writeLecturePractice({ course, lecture: row.lecture, lessons: missing, signal: api.signal }) : {}
      const sets = {}
      for (const lesson of row.lecture.lessons) sets[lesson.id] = written[lesson.id] ?? await store.readJson(store.paths.practice(course.id, lesson.id), null)
      if (!Object.values(sets).some(Boolean)) throw new TutorError('bad-output', 'No practice items came back. Try again.')
      return { sets }
    }, { key: `practice:${course.id}:${row.lecture.id}`, meta: { courseId: course.id, lectureId: row.lecture.id } })
  }

  // Opening a lesson prepares its lecture's practice in the background.
  function ensurePractice(course, row) {
    store.exists(store.paths.practice(course.id, row.lesson.id)).then(exists => {
      if (!exists && !jobs.running(`practice:${course.id}:${row.lecture.id}`)) lecturePractice(course, row)
    }).catch(() => undefined)
  }

  async function unitSheet({ courseId, unitId, force = false }) {
    const course = await courses.readCourse(courseId)
    const unit = course.units?.find(item => item.id === assertId(unitId, 'unt'))
    if (!unit) throw new TutorError('not-found', 'Unit not found')
    if (!force) {
      const existing = await store.readJson(store.paths.sheet(courseId, unitId), null)
      if (existing) return { sheet: existing }
    }
    const job = jobs.start('unit/sheet', async api => {
      const materials = await readMaterials(store, course.materialIds ?? [])
      const outline = outlineForPrompt({ units: [unit] })
      const sheet = await generateJson(llm, {
        purpose: 'teach',
        prompt: cheatsheetPrompt({ scopeTitle: `${course.title} — ${unit.title}`, outline, passages: passagesFor(materials, outline, 9000), language: course.language }),
        maxTokens: 9000,
        signal: api.signal,
        normalize: normalizeCheatsheet,
      })
      const saved = { ...sheet, title: sheet.title || unit.title, unitId, createdAt: stamp() }
      await store.writeJson(store.paths.sheet(courseId, unitId), saved)
      return { sheet: saved }
    }, { key: `sheet:${courseId}:${unitId}`, meta: { courseId, unitId } })
    return { job }
  }

  async function saveSheetLayout({ courseId, unitId, layout }) {
    const path = store.paths.sheet(assertId(courseId, 'crs'), assertId(unitId, 'unt'))
    const saved = await store.updateJson(path, null, sheet => {
      if (!sheet) throw new TutorError('not-found', 'Cheat sheet not found')
      sheet.layout = cleanLayout(layout, sheet)
      return sheet
    })
    return { sheet: saved }
  }

  async function unitQuiz({ courseId, unitId, force = false }) {
    const course = await courses.readCourse(courseId)
    const unit = course.units?.find(item => item.id === assertId(unitId, 'unt'))
    if (!unit) throw new TutorError('not-found', 'Unit not found')
    if (!force) {
      const existing = await store.readJson(store.paths.unitQuiz(courseId, unitId), null)
      if (existing) return { quiz: existing }
    }
    const job = jobs.start('unit/quiz', async api => {
      const concepts = unit.lectures.flatMap(lecture => lecture.lessons.flatMap(lesson => lesson.concepts))
      const quiz = await generateJson(llm, {
        purpose: 'teach',
        prompt: quizPrompt({ scopeTitle: `${course.title} — ${unit.title}`, outline: outlineForPrompt({ units: [unit] }), concepts: concepts.map(concept => `${concept.id}=${concept.name}`).join(', '), language: course.language, count: 10 }),
        maxTokens: 9000,
        signal: api.signal,
        normalize: raw => {
          const set = normalizePractice(raw, concepts.map(concept => concept.id))
          if (set.items.length < 3) throw new Error('quiz too short')
          return set
        },
      })
      const saved = { unitId, ...quiz, createdAt: stamp() }
      await store.writeJson(store.paths.unitQuiz(courseId, unitId), saved)
      return { quiz: saved }
    }, { key: `quiz:${courseId}:${unitId}`, meta: { courseId, unitId } })
    return { job }
  }

  async function flashcards({ courseId, force = false }) {
    const course = await courses.readCourse(courseId)
    if (!force) {
      const existing = await store.readJson(store.paths.cards(courseId), null)
      if (existing?.cards?.length) return { deck: existing }
    }
    const job = jobs.start('course/cards', async api => {
      const materials = await readMaterials(store, course.materialIds ?? [])
      const outline = outlineForPrompt(course)
      const cards = await generateJson(llm, {
        purpose: 'teach',
        prompt: flashcardsPrompt({ scopeTitle: course.title, outline, passages: passagesFor(materials, outline, 6000), language: course.language, count: 30 }),
        maxTokens: 8000,
        signal: api.signal,
        normalize: raw => {
          const value = normalizeCards(raw)
          if (!value.length) throw new Error('no cards')
          return value
        },
      })
      const deck = { cards, srs: {}, createdAt: stamp() }
      await store.writeJson(store.paths.cards(courseId), deck)
      return { deck }
    }, { key: `cards:${courseId}`, meta: { courseId } })
    return { job }
  }

  async function reviewCard({ courseId, cardId, grade: answer }) {
    const deck = await store.updateJson(store.paths.cards(assertId(courseId, 'crs')), null, value => {
      if (!value?.cards?.some(card => card.id === cardId)) throw new TutorError('not-found', 'Card not found')
      value.srs ??= {}
      value.srs[cardId] = review(value.srs[cardId] ?? createCard(cardId, now().getTime()), answer, now().getTime())
      return value
    })
    return { srs: deck.srs[cardId] }
  }

  async function logEvent(courseId, event) {
    await store.updateJson(store.paths.progress(courseId), null, value => {
      const next = value ?? { courseId, lessons: {}, concepts: {}, reviews: {}, events: [] }
      pushEvent(next, { ...event, at: stamp() })
      return next
    }).catch(() => undefined)
  }

  return Object.freeze({ get, prepare, ask, reexplain, record, grade, savePosition, complete, practice, unitSheet, saveSheetLayout, unitQuiz, flashcards, reviewCard })
}

function pushEvent(progress, event) {
  progress.events ??= []
  progress.events.push(event)
  if (progress.events.length > EVENTS_KEPT) progress.events.splice(0, progress.events.length - EVENTS_KEPT)
}

export function cleanLayout(layout, sheet) {
  const sectionIds = sheet.sections.map(section => section.id)
  const order = (Array.isArray(layout?.order) ? layout.order : []).filter(id => sectionIds.includes(id))
  for (const id of sectionIds) if (!order.includes(id)) order.push(id)
  const hidden = (Array.isArray(layout?.hidden) ? layout.hidden : []).filter(id => sectionIds.includes(id))
  return {
    columns: Math.min(4, Math.max(1, Math.round(Number(layout?.columns) || 3))),
    fontSize: Math.min(16, Math.max(8, Math.round(Number(layout?.fontSize) || 12))),
    highlight: layout?.highlight !== false,
    order,
    hidden,
  }
}
