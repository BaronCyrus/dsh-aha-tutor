// Course packs: one JSON file that carries a course (and optionally the
// learner's progress and generated lesson boards) between installations.
// Import never trusts the file: everything is re-normalized and given new ids
// so a pack can be imported twice without clobbering the first copy.

import { normalizeBoard } from './board-script.js'
import { COURSE_SCHEMA_VERSION, normalizeBlueprint, normalizeCards, normalizeCheatsheet, normalizePractice, text } from './course-model.js'
import { newId } from './ids.js'

export const COURSEPACK_FORMAT = 'aha-tutor.coursepack'
export const COURSEPACK_VERSION = 1
export const COURSEPACK_MAX_BYTES = 8 * 1024 * 1024

// cards: the whole-course deck of versions before 1.10; unitCards: each
// unit's deck by unit id. Decks travel without their review state.
export function exportCoursePack({ course, progress, boards = {}, practice = {}, sheets = {}, cards = [], unitCards = {} }, { includeProgress = false, app = {} } = {}) {
  return {
    format: COURSEPACK_FORMAT,
    version: COURSEPACK_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: app.name ?? 'dsh-aha-tutor', version: app.version ?? null },
    course: {
      title: course.title,
      subtitle: course.subtitle,
      emoji: course.emoji,
      summary: course.summary,
      level: course.level,
      language: course.language,
      goal: course.goal,
      units: course.units,
      projects: course.projects,
    },
    boards,
    practice,
    sheets,
    cards,
    unitCards,
    progress: includeProgress ? progress ?? null : null,
  }
}

// Errors carry a code: 'pack-too-large', 'pack-too-new', or 'bad-pack'.
export function parseCoursePack(input) {
  let pack = input
  if (typeof input === 'string') {
    if (input.length > COURSEPACK_MAX_BYTES) throw packError('pack-too-large', 'course pack is too large')
    try {
      pack = JSON.parse(input)
    } catch {
      throw packError('bad-pack', 'course pack is not valid JSON')
    }
  }
  if (pack?.format !== COURSEPACK_FORMAT) throw packError('bad-pack', 'not a course pack')
  if (!Number.isInteger(pack.version) || pack.version > COURSEPACK_VERSION) throw packError('pack-too-new', 'course pack was made by a newer version of the plugin')
  return pack
}

function packError(code, message) {
  return Object.assign(new Error(message), { code })
}

// Returns { course, boards, practice, sheets, cards, unitCards, progress } with fresh ids.
// Lesson-keyed maps are re-keyed to the new lesson ids.
export function importCoursePack(input, { now = new Date() } = {}) {
  const pack = parseCoursePack(input)
  const blueprint = normalizeBlueprint(stripIds(pack.course), { language: pack.course?.language })
  const lessonIdMap = mapLessonIds(pack.course, blueprint)
  const unitIdMap = mapUnitIds(pack.course, blueprint)
  const conceptIdMap = mapConceptIds(pack.course, blueprint)

  const course = {
    id: newId('crs'),
    schemaVersion: COURSE_SCHEMA_VERSION,
    ...blueprint,
    goal: text(pack.course?.goal, 1000),
    status: 'ready',
    origin: { kind: 'pack', importedAt: now.toISOString(), app: text(pack.app?.name, 60) },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  const conceptIds = [...conceptIdMap.values()]
  const remapConcepts = ids => (Array.isArray(ids) ? ids : []).map(id => conceptIdMap.get(id)).filter(Boolean)

  const boards = {}
  for (const [oldId, board] of Object.entries(pack.boards ?? {})) {
    const newLessonId = lessonIdMap.get(oldId)
    if (!newLessonId) continue
    try {
      const remapped = { ...board, steps: (board.steps ?? []).map(step => (step.check ? { ...step, check: { ...step.check, conceptIds: remapConcepts(step.check.conceptIds) } } : step)) }
      boards[newLessonId] = normalizeBoard(remapped, { conceptIds })
    } catch {
      // A broken board is regenerated on demand.
    }
  }

  const practice = {}
  for (const [oldId, set] of Object.entries(pack.practice ?? {})) {
    const newLessonId = lessonIdMap.get(oldId)
    if (!newLessonId) continue
    const items = (set?.items ?? []).map(item => ({ ...item, conceptIds: remapConcepts(item.conceptIds) }))
    const normalized = normalizePractice({ items }, conceptIds)
    if (normalized.items.length) practice[newLessonId] = normalized
  }

  const sheets = {}
  for (const [oldId, sheet] of Object.entries(pack.sheets ?? {})) {
    const newUnitId = unitIdMap.get(oldId)
    if (!newUnitId) continue
    try {
      sheets[newUnitId] = normalizeCheatsheet(sheet)
    } catch {
      // Regenerated on demand.
    }
  }

  const cards = normalizeCards(pack.cards ?? [])
  const unitCards = {}
  for (const [oldId, deck] of Object.entries(pack.unitCards ?? {})) {
    const newUnitId = unitIdMap.get(oldId)
    const unitDeck = newUnitId ? normalizeCards(deck) : []
    if (unitDeck.length) unitCards[newUnitId] = unitDeck
  }
  const progress = pack.progress ? remapProgress(pack.progress, lessonIdMap, conceptIdMap) : null
  return { course, boards, practice, sheets, cards, unitCards, progress }
}

function stripIds(course) {
  return {
    ...course,
    units: (course?.units ?? []).map(unit => ({
      ...unit,
      id: undefined,
      lectures: (unit.lectures ?? []).map(lecture => ({
        ...lecture,
        id: undefined,
        lessons: (lecture.lessons ?? []).map(lesson => ({
          ...lesson,
          id: undefined,
          concepts: (lesson.concepts ?? []).map(concept => ({ ...concept, id: undefined })),
        })),
      })),
    })),
    projects: (course?.projects ?? []).map(project => ({ ...project, id: undefined })),
  }
}

// normalizeBlueprint keeps order and drops invalid entries the same way for
// both the original and the stripped copy, so positions line up as long as
// the original was itself normalized. Match by position and title.
function zipLessons(original, normalized) {
  const pairs = []
  const flat = course => (course?.units ?? []).flatMap(unit => (unit.lectures ?? []).flatMap(lecture => lecture.lessons ?? []))
  const before = flat(original).filter(lesson => text(lesson?.title, 120))
  const after = flat(normalized)
  after.forEach((lesson, index) => {
    const source = before[index]
    if (source && text(source.title, 120) === lesson.title) pairs.push([source, lesson])
  })
  return pairs
}

function mapLessonIds(original, normalized) {
  const map = new Map()
  for (const [source, lesson] of zipLessons(original, normalized)) if (typeof source.id === 'string') map.set(source.id, lesson.id)
  return map
}

function mapConceptIds(original, normalized) {
  const map = new Map()
  for (const [source, lesson] of zipLessons(original, normalized)) {
    ;(source.concepts ?? []).forEach((concept, index) => {
      if (typeof concept?.id === 'string' && lesson.concepts[index]) map.set(concept.id, lesson.concepts[index].id)
    })
  }
  return map
}

function mapUnitIds(original, normalized) {
  const map = new Map()
  const before = (original?.units ?? []).filter(unit => text(unit?.title, 120))
  normalized.units.forEach((unit, index) => {
    const source = before[index]
    if (source && typeof source.id === 'string' && text(source.title, 120) === unit.title) map.set(source.id, unit.id)
  })
  return map
}

function remapProgress(progress, lessonIdMap, conceptIdMap) {
  const lessons = {}
  for (const [id, value] of Object.entries(progress.lessons ?? {})) {
    const mapped = lessonIdMap.get(id)
    if (mapped && value && typeof value === 'object') lessons[mapped] = { status: ['new', 'learning', 'done'].includes(value.status) ? value.status : 'new', stepIndex: Number(value.stepIndex) || 0, completedAt: value.completedAt ?? null }
  }
  const concepts = {}
  for (const [id, value] of Object.entries(progress.concepts ?? {})) {
    const mapped = conceptIdMap.get(id)
    if (mapped && value && typeof value === 'object') concepts[mapped] = { ...value, id: mapped, history: [] }
  }
  return { lessons, concepts, cards: {}, projects: {}, events: [] }
}
