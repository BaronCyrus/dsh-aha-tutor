// Course structure: normalizers turn model output (or edited client data)
// into the stored shape, and helpers answer questions about a course and its
// progress. Every limit here protects the UI and the token budget.

import { newId } from './ids.js'
import { normalizePlot } from './plot.js'

export const COURSE_SCHEMA_VERSION = 1
export const LIMITS = Object.freeze({
  questions: 6,
  options: 5,
  units: 12,
  lecturesPerUnit: 8,
  lessonsPerLecture: 8,
  lessons: 120,
  objectives: 5,
  concepts: 6,
  projects: 3,
  milestones: 6,
  rubric: 8,
  starterFiles: 12,
  starterFileBytes: 64 * 1024,
  practiceItems: 12,
  quizItems: 30,
  options4: 6,
  cards: 60,
  libraryCards: 300,
  sheetSections: 24,
  sheetItems: 16,
})

export function text(value, max = 400) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\u0000/gu, '').trim().slice(0, max)
}

function list(value, max, mapper) {
  return (Array.isArray(value) ? value : []).slice(0, max).map(mapper).filter(Boolean)
}

function strings(value, max, length = 200) {
  return list(value, max, item => text(typeof item === 'object' ? item?.text ?? item?.name ?? item?.title : item, length) || null)
}

function minutes(value, fallback = 15) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(90, Math.max(5, number)) : fallback
}

const EMOJI = /\p{Extended_Pictographic}/u

function emoji(value) {
  const match = EMOJI.exec(String(value ?? ''))
  return match ? match[0] : '📘'
}

// ── intake questionnaire ────────────────────────────────────────────────────

export function normalizeQuestionnaire(raw) {
  const source = Array.isArray(raw) ? raw : raw?.questions
  const questions = list(source, LIMITS.questions, (question, index) => {
    const prompt = text(question?.prompt ?? question?.question ?? question?.title, 200)
    if (!prompt) return null
    const options = list(question?.options, LIMITS.options, (option, optionIndex) => {
      const label = text(typeof option === 'string' ? option : option?.label ?? option?.title, 80)
      if (!label) return null
      return { id: String.fromCharCode(97 + optionIndex), label, detail: text(option?.detail ?? option?.description, 160) }
    })
    if (options.length < 2) return null
    return {
      id: `q${index + 1}`,
      prompt,
      topic: text(question?.topic ?? question?.key, 40),
      multi: question?.multi === true || question?.multiple === true,
      options,
    }
  })
  return { questions: questions.map((question, index) => ({ ...question, id: `q${index + 1}` })) }
}

export function intakeSummary(questionnaire, answers) {
  const lines = []
  for (const question of questionnaire?.questions ?? []) {
    const answer = answers?.[question.id]
    if (!answer) continue
    const picked = (answer.choice ?? [])
      .map(id => question.options.find(option => option.id === id))
      .filter(Boolean)
      .map(option => (option.detail ? `${option.label}（${option.detail}）` : option.label))
    const other = text(answer.other, 300)
    if (other) picked.push(other)
    if (picked.length) lines.push(`- ${question.prompt}：${picked.join('；')}`)
  }
  return lines.join('\n')
}

// ── blueprint ───────────────────────────────────────────────────────────────

function normalizeConcepts(raw, fallbackName) {
  const concepts = list(raw, LIMITS.concepts, item => {
    const name = text(typeof item === 'string' ? item : item?.name ?? item?.title, 80)
    if (!name) return null
    return { id: typeof item?.id === 'string' && /^cpt_[a-z0-9]+$/u.test(item.id) ? item.id : newId('cpt'), name }
  })
  if (!concepts.length && fallbackName) concepts.push({ id: newId('cpt'), name: text(fallbackName, 80) })
  return concepts
}

function keepId(value, prefix) {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{6,40}$`, 'u').test(value) ? value : newId(prefix)
}

// How a lesson treats its idea: a feel for it first, then a precise
// statement, a derivation, its use on problems, or going beyond the basics.
// It shapes the board and shows beside the lesson.
export const LESSON_DEPTHS = Object.freeze(['intuition', 'definition', 'derivation', 'application', 'extension'])

export function normalizeLesson(raw) {
  const title = text(raw?.title, 120)
  if (!title) return null
  return {
    id: keepId(raw?.id, 'les'),
    title,
    summary: text(raw?.summary ?? raw?.description, 300),
    objectives: strings(raw?.objectives ?? raw?.goals, LIMITS.objectives),
    concepts: normalizeConcepts(raw?.concepts, title),
    estMinutes: minutes(raw?.estMinutes ?? raw?.minutes),
    kind: ['lesson', 'remedial', 'review', 'challenge'].includes(raw?.kind) ? raw.kind : 'lesson',
    ...(LESSON_DEPTHS.includes(raw?.depth) ? { depth: raw.depth } : {}),
  }
}

export function normalizeUnits(rawUnits) {
  let lessonBudget = LIMITS.lessons
  return list(rawUnits, LIMITS.units, unit => {
    const title = text(unit?.title, 120)
    if (!title) return null
    const lectures = list(unit?.lectures, LIMITS.lecturesPerUnit, lecture => {
      const lectureTitle = text(lecture?.title, 120)
      if (!lectureTitle) return null
      const lessons = list(lecture?.lessons, LIMITS.lessonsPerLecture, lesson => {
        if (lessonBudget <= 0) return null
        const normalized = normalizeLesson(lesson)
        if (normalized) lessonBudget -= 1
        return normalized
      })
      if (!lessons.length) return null
      return { id: keepId(lecture?.id, 'lec'), title: lectureTitle, summary: text(lecture?.summary, 300), lessons }
    })
    if (!lectures.length) return null
    return {
      id: keepId(unit?.id, 'unt'),
      title,
      summary: text(unit?.summary, 400),
      objectives: strings(unit?.objectives, LIMITS.objectives),
      lectures,
    }
  })
}

export function normalizeProject(raw) {
  const title = text(raw?.title, 120)
  if (!title) return null
  const kind = ['code', 'writing', 'analysis', 'design', 'practice', 'other'].includes(raw?.kind) ? raw.kind : 'other'
  const starterFiles = list(raw?.starterFiles ?? raw?.files, LIMITS.starterFiles, file => {
    const path = safeRelativePath(file?.path ?? file?.name)
    if (!path) return null
    const content = String(file?.content ?? '').slice(0, LIMITS.starterFileBytes)
    return { path, content }
  })
  return {
    id: keepId(raw?.id, 'prj'),
    title,
    kind,
    brief: text(raw?.brief ?? raw?.description, 2000),
    skills: strings(raw?.skills, 8, 80),
    milestones: list(raw?.milestones, LIMITS.milestones, (item, index) => {
      const milestone = text(typeof item === 'string' ? item : item?.title, 160)
      return milestone ? { id: `m${index + 1}`, title: milestone, detail: text(item?.detail, 600) } : null
    }),
    rubric: list(raw?.rubric, LIMITS.rubric, (item, index) => {
      const criterion = text(typeof item === 'string' ? item : item?.criterion ?? item?.title, 160)
      if (!criterion) return null
      const points = Math.round(Number(item?.points))
      return { id: `r${index + 1}`, criterion, points: Number.isFinite(points) && points > 0 ? Math.min(100, points) : 10, detail: text(item?.detail, 400) }
    }),
    starterFiles,
    unitId: typeof raw?.unitId === 'string' ? raw.unitId : null,
  }
}

// Relative POSIX path that stays inside the project directory and is a valid
// file name on Windows and macOS alike.
export function safeRelativePath(value) {
  const raw = String(value ?? '').replace(/\\/gu, '/').trim()
  if (!raw || raw.startsWith('/') || /^[a-z]:/iu.test(raw)) return null
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.length > 6) return null
  for (const part of parts) {
    if (part === '..' || /[<>:"|?*\u0000-\u001f]/u.test(part) || /[. ]$/u.test(part)) return null
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu.test(part)) return null
    if (part.length > 80) return null
  }
  return parts.join('/')
}

export function normalizeBlueprint(raw, { language } = {}) {
  const units = normalizeUnits(raw?.units)
  if (!units.length) throw new Error('blueprint has no usable units')
  return {
    title: text(raw?.title, 120) || units[0].title,
    subtitle: text(raw?.subtitle ?? raw?.tagline, 200),
    emoji: emoji(raw?.emoji),
    summary: text(raw?.summary ?? raw?.description, 1200),
    level: text(raw?.level, 40),
    language: text(raw?.language ?? language, 20) || 'zh-CN',
    units,
    projects: list(raw?.projects, LIMITS.projects, normalizeProject),
  }
}

// The main title of "主标题：副标题" / "Title: subtitle", for compact labels.
export function shortCourseTitle(title) {
  const value = text(title, 200)
  const cut = value.search(/[：:]/u)
  return cut > 0 ? value.slice(0, cut).trim() : value
}

// The titles of a blueprint that is still being written (repaired from a
// truncated stream), so the learner can watch the outline grow.
export function blueprintOutline(raw) {
  const units = list(raw?.units, LIMITS.units, unit => {
    const title = text(unit?.title, 120)
    if (!title) return null
    const lectures = list(unit?.lectures, LIMITS.lecturesPerUnit, lecture => {
      const lessons = strings(lecture?.lessons, LIMITS.lessonsPerLecture, 120)
      const name = text(lecture?.title, 120)
      return name || lessons.length ? { title: name, lessons } : null
    })
    return { title, lectures }
  })
  return { title: text(raw?.title, 120), units }
}

// ── practice, checks, cards, sheets ─────────────────────────────────────────

// "short" and "work" (a written-out working) are graded by the model.
const ITEM_KINDS = ['choice', 'multi', 'blank', 'number', 'short', 'work', 'order']
// A question with several right options takes several answers, whatever
// the model called it: a kind like "multi-select" or 多选, a choice whose key
// lists two or more options, or a prompt that asks for several. Kept as a
// single choice it would say 多选 and take one answer.
const MULTI_KIND = /multi.?(?:select|answer|response)|select.?all|checkbox|多选|不定项/iu
const MULTI_PROMPT = /多选|不定项|选出所有|所有正确|select all|all that apply|more than one (?:answer|option)/iu

export function normalizeItem(raw, index = 0, conceptIds = []) {
  const named = String(raw?.kind ?? raw?.type ?? '').trim().toLowerCase()
  const kind = ITEM_KINDS.includes(named) ? named : raw?.options ? (MULTI_KIND.test(named) ? 'multi' : 'choice') : 'short'
  const prompt = text(raw?.prompt ?? raw?.question, 2000)
  if (!prompt) return null
  const item = {
    id: typeof raw?.id === 'string' && /^[a-z0-9_-]{1,24}$/iu.test(raw.id) ? raw.id : `i${index + 1}`,
    kind,
    prompt,
    explanation: text(raw?.explanation, 2000),
    hints: strings(raw?.hints, 3, 400),
    difficulty: Math.min(3, Math.max(1, Math.round(Number(raw?.difficulty) || 2))),
    conceptIds: (Array.isArray(raw?.conceptIds) ? raw.conceptIds : []).filter(id => conceptIds.includes(id)).slice(0, 4),
  }
  // An optional figure; the client draws it only through the SVG allow-list.
  // A graph of formulas is a plot the client computes (without sliders).
  const figure = text(raw?.svg ?? raw?.figure, 16000)
  if (/^<svg[\s>]/iu.test(figure)) item.svg = figure
  else if (raw?.plot && typeof raw.plot === 'object') {
    const plot = normalizePlot(raw.plot)
    if (plot) item.plot = plot
  }
  if (kind === 'choice' || kind === 'multi' || kind === 'order') {
    item.options = list(raw?.options, LIMITS.options4, (option, optionIndex) => {
      const label = text(typeof option === 'string' ? option : option?.text ?? option?.label, 400)
      return label ? { id: String.fromCharCode(97 + optionIndex), text: label } : null
    })
    if (item.options.length < 2) return null
    const ids = item.options.map(option => option.id)
    const toId = value => {
      if (typeof value === 'number') return ids[value] ?? null
      const raw = String(value ?? '').trim().toLowerCase()
      if (ids.includes(raw)) return raw
      // "A." or "(A)" for option a
      const letter = /^[(（[]?([a-z])[)）\].．、:：]?$/u.exec(raw)?.[1]
      if (letter && ids.includes(letter)) return letter
      const byText = item.options.find(option => option.text.toLowerCase() === raw)
      return byText ? byText.id : null
    }
    // The options an answer names, also as one string like "A, C" or "A、C"
    // (unless that string is an option itself).
    const keysOf = value => {
      if (Array.isArray(value)) return [...new Set(value.map(toId).filter(Boolean))]
      const whole = toId(value)
      if (whole || typeof value !== 'string') return whole ? [whole] : []
      return [...new Set(value.split(/[,，、;；/]/u).map(toId).filter(Boolean))]
    }
    if (kind === 'choice') {
      const keys = keysOf(raw?.answer)
      if (!keys.length) return null
      if (keys.length > 1 || MULTI_PROMPT.test(prompt)) {
        item.kind = 'multi'
        item.answer = keys
      } else {
        item.answer = keys[0]
      }
    } else {
      item.answer = kind === 'multi' ? keysOf(raw?.answer) : (Array.isArray(raw?.answer) ? raw.answer : [raw?.answer]).map(toId).filter(Boolean)
      if (!item.answer.length) return null
    }
  } else if (kind === 'number') {
    item.answer = Number(raw?.answer)
    if (!Number.isFinite(item.answer)) return null
    const tolerance = Number(raw?.tolerance)
    if (Number.isFinite(tolerance) && tolerance >= 0) item.tolerance = tolerance
    item.unit = text(raw?.unit, 20)
  } else if (kind === 'blank') {
    item.answer = strings(Array.isArray(raw?.answer) ? raw.answer : [raw?.answer], 6, 200)
    if (!item.answer.length) return null
  } else {
    item.answer = text(raw?.answer ?? raw?.reference, 3000)
    item.rubric = strings(raw?.rubric, 6, 300)
  }
  return item
}

// max: a lesson's practice by default; a unit quiz may hold LIMITS.quizItems.
export function normalizePractice(raw, conceptIds = [], max = LIMITS.practiceItems) {
  const items = list(raw?.items ?? raw, max, (item, index) => normalizeItem(item, index, conceptIds))
  return { items: items.map((item, index) => ({ ...item, id: `i${index + 1}` })) }
}

// A one-page handout of a lesson, from its board: what it covered, the key
// points each in one line, a worked example, common mistakes, a glossary and
// a few questions to check oneself. Text may hold $…$ math.
export function normalizeHandout(raw) {
  const points = list(raw?.points ?? raw?.keyPoints, 6, point => {
    const title = text(typeof point === 'string' ? point : point?.title ?? point?.point, 160)
    return title ? { title, oneLine: text(point?.oneLine ?? point?.summary, 300), detail: text(point?.detail, 600) } : null
  })
  if (!points.length) throw new Error('the handout has no key points')
  const example = raw?.example && typeof raw.example === 'object' ? {
    problem: text(raw.example.problem ?? raw.example.question, 800),
    steps: strings(raw.example.steps, 10, 400),
    answer: text(raw.example.answer, 300),
  } : null
  return {
    title: text(raw?.title, 160),
    summary: text(raw?.summary ?? raw?.overview, 800),
    points,
    example: example?.problem ? example : null,
    mistakes: list(raw?.mistakes, 5, item => {
      const mistake = text(typeof item === 'string' ? item : item?.mistake, 300)
      return mistake ? { mistake, fix: text(item?.fix ?? item?.instead, 300) } : null
    }),
    glossary: list(raw?.glossary, 10, item => {
      const term = text(item?.term, 80)
      return term ? { term, meaning: text(item?.meaning ?? item?.definition, 300) } : null
    }),
    questions: list(raw?.questions ?? raw?.selfCheck, 5, item => {
      const question = text(typeof item === 'string' ? item : item?.question, 400)
      return question ? { question, answer: text(item?.answer, 400) } : null
    }),
  }
}

// max: a deck's cards by default; more may be read to be thinned out later.
export function normalizeCards(raw, max = LIMITS.cards) {
  return list(raw?.cards ?? raw, max, (card, index) => {
    const front = text(card?.front ?? card?.q ?? card?.question, 600)
    const back = text(card?.back ?? card?.a ?? card?.answer, 1500)
    if (!front || !back) return null
    return { id: `c${index + 1}`, front, back, tag: text(card?.tag ?? card?.topic, 60) }
  }).map((card, index) => ({ ...card, id: `c${index + 1}` }))
}

const SHEET_KINDS = ['definition', 'formula', 'fact', 'tip', 'pitfall', 'example', 'compare']

export function normalizeCheatsheet(raw) {
  const sections = list(raw?.sections, LIMITS.sheetSections, (section, index) => {
    const title = text(section?.title, 120)
    if (!title) return null
    const items = list(section?.items, LIMITS.sheetItems, item => {
      const body = text(typeof item === 'string' ? item : item?.text ?? item?.body, 800)
      const tex = text(item?.tex ?? item?.latex, 400)
      if (!body && !tex) return null
      const page = Math.round(Number(item?.cite?.page ?? item?.page))
      return {
        kind: SHEET_KINDS.includes(item?.kind) ? item.kind : 'fact',
        title: text(item?.title ?? item?.term, 120),
        text: body,
        tex,
        cite: Number.isFinite(page) && page > 0 ? { page, source: text(item?.cite?.source ?? item?.source, 120) } : null,
      }
    })
    if (!items.length) return null
    return { id: `sec${index + 1}`, title, items, related: strings(section?.related, 4, 120) }
  })
  if (!sections.length) throw new Error('cheatsheet has no sections')
  return {
    title: text(raw?.title, 160),
    sections: sections.map((section, index) => ({ ...section, id: `sec${index + 1}` })),
    layout: { columns: 3, fontSize: 12, highlight: true, order: sections.map((_, index) => `sec${index + 1}`) },
  }
}

// ── queries ─────────────────────────────────────────────────────────────────

export function flattenLessons(course) {
  const rows = []
  for (const unit of course?.units ?? []) {
    for (const lecture of unit.lectures ?? []) {
      for (const lesson of lecture.lessons ?? []) rows.push({ unit, lecture, lesson, index: rows.length })
    }
  }
  return rows
}

// What a revision changes, lesson by lesson: lessons the teacher left alone
// keep their ids, so anything without a match was added or removed.
export function blueprintDiff(before, after) {
  const lessonsOf = course => {
    const map = new Map()
    for (const unit of course?.units ?? []) for (const lecture of unit.lectures ?? []) for (const lesson of lecture.lessons ?? []) map.set(lesson.id, { lesson, unit: unit.title })
    return map
  }
  const shape = lesson => JSON.stringify([lesson.summary ?? '', lesson.objectives ?? [], lesson.estMinutes ?? 0, (lesson.concepts ?? []).map(concept => concept.name), lesson.depth ?? ''])
  const old = lessonsOf(before)
  const next = lessonsOf(after)
  const added = []
  const renamed = []
  const changed = []
  for (const [id, entry] of next) {
    const was = old.get(id)
    if (!was) added.push({ title: entry.lesson.title, unit: entry.unit })
    else if (was.lesson.title !== entry.lesson.title) renamed.push({ from: was.lesson.title, to: entry.lesson.title, unit: entry.unit })
    else if (shape(was.lesson) !== shape(entry.lesson) || was.unit !== entry.unit) changed.push({ title: entry.lesson.title, unit: entry.unit })
  }
  const removed = [...old].filter(([id]) => !next.has(id)).map(([, entry]) => ({ title: entry.lesson.title, unit: entry.unit }))
  const beforeUnits = new Set((before?.units ?? []).map(unit => unit.id))
  const afterUnits = new Set((after?.units ?? []).map(unit => unit.id))
  return {
    title: (before?.title ?? '') !== (after?.title ?? '') ? { from: before?.title ?? '', to: after?.title ?? '' } : null,
    unitsAdded: (after?.units ?? []).filter(unit => !beforeUnits.has(unit.id)).map(unit => unit.title),
    unitsRemoved: (before?.units ?? []).filter(unit => !afterUnits.has(unit.id)).map(unit => unit.title),
    added,
    removed,
    renamed,
    changed,
  }
}

export function diffIsEmpty(diff) {
  return !diff.title && !diff.unitsAdded.length && !diff.unitsRemoved.length && !diff.added.length && !diff.removed.length && !diff.renamed.length && !diff.changed.length
}

export function findLesson(course, lessonId) {
  return flattenLessons(course).find(row => row.lesson.id === lessonId) ?? null
}

// The concepts a unit teaches, each once, in teaching order.
export function unitConcepts(unit) {
  const seen = new Map()
  for (const lecture of unit?.lectures ?? []) {
    for (const lesson of lecture.lessons ?? []) {
      for (const concept of lesson.concepts ?? []) if (!seen.has(concept.id)) seen.set(concept.id, concept)
    }
  }
  return [...seen.values()]
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// How long a unit quiz is: at least one question per concept, more for the
// key ones, usually 10 to 30. The model picks the number inside the range.
export function unitQuizRange(unit) {
  const concepts = unitConcepts(unit).length
  const min = clamp(concepts, 10, LIMITS.quizItems)
  return { min, max: clamp(Math.max(min + 5, Math.round(concepts * 1.5)), min, LIMITS.quizItems) }
}

// How many flashcards a unit's deck has: two to four per concept.
export function unitCardRange(unit) {
  const concepts = unitConcepts(unit).length
  const min = clamp(concepts * 2, 8, LIMITS.cards)
  return { min, max: clamp(concepts * 4, min, LIMITS.cards) }
}

// How many flashcards a stretch of a material gets (one part of a long one,
// about 20,000 characters, or a short one whole): the model gives each key
// point it finds two to four cards; the range keeps that in line with the
// length, up to a card per 300 characters of dense text.
export function partCardRange(chars) {
  const min = clamp(Math.round(chars / 2000), 4, LIMITS.cards)
  return { min, max: clamp(Math.round(chars / 300), min, LIMITS.cards) }
}

// How long a quiz on a material is, by its length: 5 to 30 questions, about
// 5–10 for a short handout.
export function materialQuizRange(chars) {
  const min = clamp(Math.round(chars / 4000), 5, 20)
  return { min, max: clamp(Math.round(chars / 2000), Math.max(min, 10), LIMITS.quizItems) }
}

// One part's share of a range spread over `parts` parts, at least one.
export function shareRange(range, parts) {
  const count = Math.max(1, parts)
  return { min: Math.max(1, Math.floor(range.min / count)), max: Math.max(1, Math.ceil(range.max / count)) }
}

// At most `max` entries of a list, spread evenly over it, so that cutting
// it never drops only its end (the last lessons or pages it covers).
export function thinEvenly(entries, max) {
  if (entries.length <= max) return entries
  return Array.from({ length: Math.max(0, max) }, (_, index) => entries[Math.floor(((index + 0.5) * entries.length) / max)])
}

// At most `max` entries of several lists, shared out in turns so that every
// list keeps its share, each thinned evenly; the lists keep their order.
export function takeEvenly(lists, max) {
  const taken = lists.map(() => 0)
  let left = max
  let more = true
  while (left > 0 && more) {
    more = false
    for (const [index, entries] of lists.entries()) {
      if (left > 0 && taken[index] < entries.length) {
        taken[index] += 1
        left -= 1
        more = true
      }
    }
  }
  return lists.flatMap((entries, index) => thinEvenly(entries, taken[index]))
}

// Cards from the parts of a material with each question asked once: a card
// whose front an earlier one already asks, spacing and punctuation aside,
// is left out.
export function uniqueCards(lists) {
  const seen = new Set()
  return lists.map(cards => cards.filter(card => {
    const key = String(card.front).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }))
}

export function conceptIndex(course) {
  const index = new Map()
  for (const { lesson } of flattenLessons(course)) {
    for (const concept of lesson.concepts ?? []) index.set(concept.id, { ...concept, lessonId: lesson.id })
  }
  return index
}

export function lessonStatus(progress, lessonId) {
  return progress?.lessons?.[lessonId]?.status ?? 'new'
}

export function courseProgress(course, progress) {
  const rows = flattenLessons(course)
  const done = rows.filter(row => lessonStatus(progress, row.lesson.id) === 'done')
  const minutesLeft = rows
    .filter(row => lessonStatus(progress, row.lesson.id) !== 'done')
    .reduce((sum, row) => sum + (row.lesson.estMinutes || 15), 0)
  return {
    total: rows.length,
    done: done.length,
    percent: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
    minutesLeft,
  }
}

export function nextLesson(course, progress) {
  const rows = flattenLessons(course)
  return rows.find(row => lessonStatus(progress, row.lesson.id) === 'learning')
    ?? rows.find(row => lessonStatus(progress, row.lesson.id) === 'new')
    ?? null
}

export function lessonAfter(course, lessonId) {
  const rows = flattenLessons(course)
  const index = rows.findIndex(row => row.lesson.id === lessonId)
  return index >= 0 ? rows[index + 1] ?? null : null
}

// Insert a remedial lesson right after `afterLessonId` in the same lecture.
export function insertLesson(course, afterLessonId, lesson) {
  const normalized = normalizeLesson(lesson)
  if (!normalized) throw new Error('invalid lesson')
  for (const unit of course.units) {
    for (const lecture of unit.lectures) {
      const index = lecture.lessons.findIndex(item => item.id === afterLessonId)
      if (index >= 0) {
        lecture.lessons.splice(index + 1, 0, normalized)
        return normalized
      }
    }
  }
  throw new Error('lesson not found')
}

// Compact outline for prompts.
export function outlineForPrompt(course, { withIds = false, maxChars = 6000 } = {}) {
  const lines = []
  course?.units?.forEach((unit, unitIndex) => {
    lines.push(`Unit ${unitIndex + 1}: ${unit.title}${withIds ? ` [${unit.id}]` : ''}`)
    unit.lectures.forEach((lecture, lectureIndex) => {
      lines.push(`  Lecture ${unitIndex + 1}.${lectureIndex + 1}: ${lecture.title}`)
      lecture.lessons.forEach(lesson => {
        lines.push(`    - ${lesson.title}${withIds ? ` [${lesson.id}]` : ''}`)
      })
    })
  })
  const outline = lines.join('\n')
  return outline.length > maxChars ? `${outline.slice(0, maxChars)}\n…` : outline
}
