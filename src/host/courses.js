// Course crafting and the course library: intake questionnaire → blueprint →
// revisions → confirmation (practice sets and project briefs) → ready.

import { exportCoursePack, importCoursePack } from '../core/coursepack.js'
import {
  blueprintOutline,
  COURSE_SCHEMA_VERSION,
  courseProgress,
  flattenLessons,
  intakeSummary,
  nextLesson,
  normalizeBlueprint,
  normalizeLesson,
  normalizePractice,
  normalizeProject,
  normalizeQuestionnaire,
  outlineForPrompt,
  text,
} from '../core/course-model.js'
import { assertId, newId } from '../core/ids.js'
import { extractJson } from '../core/json-extract.js'
import { formatPassages, spreadPassages } from '../core/retrieval.js'
import { COURSE_MATERIALS, emptyProgress, materialImages, materialsSummary, passagesFor, readMaterials, readProfile, readProgress } from './context.js'
import { generateJson, streamCounter, TutorError } from './generate.js'
import { blueprintPrompt, detectLanguage, materialsRevisePrompt, practicePrompt, projectsPrompt, questionnairePrompt, revisePrompt, reworkPrompt } from './prompts.js'

const TIMELINES = ['intensive', 'balanced', 'relaxed']
const SIZES = ['auto', 'short', 'standard', 'full']

// The blueprint streams: count the lessons written so far (there is no total
// yet) and, at each new lesson, repair the text so far into an outline the
// learner can watch grow.
function outlineStream(api) {
  let soFar = ''
  const counter = streamCounter('"estMinutes"', count => {
    api.progress(count, 0, 'blueprint')
    try {
      api.preview(blueprintOutline(extractJson(soFar)))
    } catch {
      // not parseable yet; the next lesson will be
    }
  })
  return delta => {
    soFar += String(delta ?? '')
    counter(delta)
  }
}

// research: optional web research (research.js) run before the questions.
export function createCourses({ store, llm, jobs, research, now = () => new Date() }) {
  const stamp = () => now().toISOString()

  async function readCourse(courseId) {
    const course = await store.readJson(store.paths.course(assertId(courseId, 'crs')), null)
    if (!course) throw new TutorError('not-found', 'Course not found')
    return course
  }

  const saveCourse = course => store.writeJson(store.paths.course(course.id), { ...course, updatedAt: stamp() })

  async function summary(courseId) {
    const course = await store.readJson(store.paths.course(courseId), null)
    if (!course) return null
    const progress = await readProgress(store, courseId)
    const stats = course.units ? courseProgress(course, progress) : { total: 0, done: 0, percent: 0, minutesLeft: 0 }
    const next = course.units ? nextLesson(course, progress) : null
    return {
      id: course.id,
      title: course.title || course.goal,
      subtitle: course.subtitle ?? '',
      emoji: course.emoji ?? '📘',
      status: course.status,
      language: course.language,
      level: course.level ?? '',
      progress: stats,
      next: next ? { lessonId: next.lesson.id, title: next.lesson.title, unit: next.unit.title } : null,
      updatedAt: course.updatedAt,
      createdAt: course.createdAt,
      archived: course.archived === true,
      origin: course.origin?.kind ?? 'crafted',
    }
  }

  async function list() {
    const ids = await store.listIds(store.paths.courses(), 'crs')
    const rows = (await Promise.all(ids.map(id => summary(id).catch(() => null)))).filter(Boolean)
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async function get({ courseId }) {
    const course = await readCourse(courseId)
    const [progress, intake, proposal] = await Promise.all([readProgress(store, courseId), store.readJson(store.paths.intake(courseId), null), store.readJson(store.paths.proposal(courseId), null)])
    const boards = new Set(await store.listIds(store.paths.boardsDir(courseId), 'les'))
    const practice = new Set(await store.listIds(store.paths.practiceDir(courseId), 'les'))
    const sheets = new Set(await store.listIds(store.paths.sheetsDir(courseId), 'unt'))
    return {
      course,
      progress,
      intake,
      proposal,
      jobs: {
        questions: jobs.running(`questions:${courseId}`),
        blueprint: jobs.running(`blueprint:${courseId}`),
        confirm: jobs.running(`confirm:${courseId}`),
      },
      ready: {
        boards: [...boards],
        practice: [...practice],
        sheets: [...sheets],
      },
    }
  }

  // Step 1: create the draft and ask the intake questions (unless quick).
  function startCraft({ goal, materialIds = [], quick = false, language, web = false }) {
    const cleanGoal = text(goal, 2000)
    if (!cleanGoal && !materialIds.length) throw new TutorError('empty-goal', 'Tell me what you want to learn')
    const ids = materialIds.filter(id => /^mat_[a-z0-9]+$/u.test(id)).slice(0, 8)
    const courseId = newId('crs')
    return jobs.start('craft/start', async api => {
      api.progress(0, quick ? 1 : 2, 'questions')
      const materials = await readMaterials(store, ids)
      const draft = {
        id: courseId,
        schemaVersion: COURSE_SCHEMA_VERSION,
        status: 'intake',
        goal: cleanGoal || materials.map(item => item.meta.brief?.suggestedGoal || item.meta.title).join('; '),
        language: language || detectLanguage(`${cleanGoal} ${materials.map(item => item.meta.title).join(' ')}`),
        materialIds: ids,
        createdAt: stamp(),
      }
      await saveCourse(draft)
      // Look the subject up first, so the questions and the blueprint can use it.
      let found = null
      if (web && research) {
        api.progress(0, quick ? 1 : 2, 'research')
        found = await research.run({ goal: draft.goal, language: draft.language, signal: api.signal })
        api.progress(0, quick ? 1 : 2, 'questions')
      }
      if (quick) {
        if (found) await store.writeJson(store.paths.intake(courseId), { questionnaire: null, answers: {}, research: found, at: stamp() })
        return { courseId, questionnaire: null, research: found }
      }
      const profile = await readProfile(store)
      const questionnaire = await generateJson(llm, {
        purpose: 'teach',
        prompt: questionnairePrompt({ goal: draft.goal, language: draft.language, materialsSummary: materialsSummary(materials), profile, sources: found?.sources }),
        maxTokens: 3000,
        signal: api.signal,
        normalize: raw => {
          const value = normalizeQuestionnaire(raw)
          if (!value.questions.length) throw new Error('no questions')
          return value
        },
      })
      await store.writeJson(store.paths.intake(courseId), { questionnaire, answers: {}, ...(found ? { research: found } : {}), at: stamp() })
      api.progress(1, 2, 'questions')
      return { courseId, questionnaire, research: found }
    }, { key: `questions:${courseId}`, meta: { courseId } })
  }

  // Step 2: answers → blueprint.
  function submitIntake({ courseId, answers = {}, timeline = 'balanced', size = 'auto', weeklyMinutes, deadline }) {
    assertId(courseId, 'crs')
    return jobs.start('craft/blueprint', async api => {
      const course = await readCourse(courseId)
      const intake = (await store.readJson(store.paths.intake(courseId), null)) ?? { questionnaire: null, answers: {} }
      const cleanAnswers = sanitizeAnswers(intake.questionnaire, answers)
      await store.writeJson(store.paths.intake(courseId), { ...intake, answers: cleanAnswers, at: stamp() })
      if (course.materialIds?.length) api.progress(0, 0, 'materials')
      const materials = await readMaterials(store, course.materialIds ?? [])
      const profile = await readProfile(store)
      const settings = {
        timeline: TIMELINES.includes(timeline) ? timeline : 'balanced',
        size: SIZES.includes(size) ? size : 'auto',
        weeklyMinutes: clampMinutes(weeklyMinutes),
        deadline: /^\d{4}-\d{2}-\d{2}$/u.test(String(deadline ?? '')) ? deadline : null,
      }
      api.progress(0, 0, 'blueprint')
      const blueprint = await generateJson(llm, {
        purpose: 'teach',
        prompt: blueprintPrompt({
          goal: course.goal,
          language: course.language,
          intake: intakeSummary(intake.questionnaire, cleanAnswers),
          materialsSummary: materialsSummary(materials),
          profile,
          timeline: settings.timeline,
          size: settings.size,
          weeklyMinutes: settings.weeklyMinutes,
          sources: intake.research?.sources,
        }),
        images: llm.supportsImages?.('teach') ? await materialImages(store, materials) : undefined,
        maxTokens: 16000,
        signal: api.signal,
        onText: outlineStream(api),
        normalize: raw => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language })),
      })
      // The sources the design leaned on stay with the course, for the course page.
      const sources = intake.research?.sources ?? []
      const next = { ...course, ...blueprint, language: course.language, status: 'blueprint', settings, ...(sources.length ? { sources } : {}) }
      await saveCourse(next)
      return { course: next }
    }, { key: `blueprint:${courseId}`, meta: { courseId } })
  }

  function revise({ courseId, instruction }) {
    const request = text(instruction, 1500)
    if (!request) throw new TutorError('empty-change', 'Describe the change you want')
    return jobs.start('craft/revise', async api => {
      const course = await readCourse(courseId)
      if (!course.units) throw new TutorError('no-blueprint', 'There is no blueprint to revise yet')
      const current = { title: course.title, subtitle: course.subtitle, emoji: course.emoji, summary: course.summary, level: course.level, units: course.units, projects: course.projects }
      api.progress(0, 0, 'blueprint')
      const revised = await generateJson(llm, {
        purpose: 'teach',
        prompt: revisePrompt({ blueprint: current, instruction: request, language: course.language }),
        maxTokens: 16000,
        signal: api.signal,
        onText: streamCounter('"estMinutes"', count => api.progress(count, 0, 'blueprint')),
        normalize: raw => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language })),
      })
      // A revision is only proposed: the learner sees what changes first.
      const proposal = { instruction: request, at: stamp(), blueprint: revised }
      await store.writeJson(store.paths.proposal(courseId), proposal)
      return { course, proposal }
    }, { key: `blueprint:${courseId}`, meta: { courseId } })
  }

  // Materials added after the course was designed: the teacher proposes how
  // the outline should use them, as a revision the learner applies or
  // discards. Applying it attaches the materials, so lessons cite them.
  function addMaterials({ courseId, materialIds = [], instruction }) {
    const wanted = [...new Set(materialIds)].filter(id => /^mat_[a-z0-9]+$/u.test(id)).slice(0, COURSE_MATERIALS)
    if (!wanted.length) throw new TutorError('no-materials', 'Choose at least one material')
    const request = text(instruction, 600)
    return jobs.start('craft/revise', async api => {
      const course = await readCourse(courseId)
      if (!course.units) throw new TutorError('no-blueprint', 'There is no blueprint to revise yet')
      const known = course.materialIds ?? []
      const added = (await readMaterials(store, wanted.filter(id => !known.includes(id)))).slice(0, Math.max(0, COURSE_MATERIALS - known.length))
      if (!added.length) throw new TutorError(wanted.every(id => known.includes(id)) ? 'materials-known' : known.length >= COURSE_MATERIALS ? 'materials-full' : 'not-found', 'These materials cannot be added')
      const current = { title: course.title, subtitle: course.subtitle, emoji: course.emoji, summary: course.summary, level: course.level, units: course.units, projects: course.projects }
      const share = Math.floor(9000 / added.length)
      const passages = added.filter(item => item.chunks.length).map(item => formatPassages(spreadPassages(item.chunks, { maxChars: share, samples: 8 }), item.meta.title)).join('\n\n')
      api.progress(0, 0, 'blueprint')
      const revised = await generateJson(llm, {
        purpose: 'teach',
        prompt: materialsRevisePrompt({ blueprint: current, materials: materialsSummary(added), passages, instruction: request, language: course.language }),
        images: llm.supportsImages?.('teach') ? await materialImages(store, added) : undefined,
        maxTokens: 16000,
        signal: api.signal,
        onText: streamCounter('"estMinutes"', count => api.progress(count, 0, 'blueprint')),
        normalize: raw => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language })),
      })
      const proposal = { instruction: request, materials: added.map(item => ({ id: item.meta.id, title: item.meta.title })), at: stamp(), blueprint: revised }
      await store.writeJson(store.paths.proposal(courseId), proposal)
      return { course, proposal }
    }, { key: `blueprint:${courseId}`, meta: { courseId } })
  }

  async function applyProposal({ courseId }) {
    const course = await readCourse(courseId)
    const proposal = await store.readJson(store.paths.proposal(courseId), null)
    if (!proposal?.blueprint?.units) throw new TutorError('no-proposal', 'There is no proposed change')
    // Lessons the revision kept have the same ids, so their progress stays;
    // materials it was made from join the course.
    const materialIds = [...new Set([...(course.materialIds ?? []), ...(proposal.materials ?? []).map(item => item.id)])].slice(0, COURSE_MATERIALS)
    const next = { ...course, ...proposal.blueprint, language: course.language, status: course.status === 'ready' ? 'ready' : 'blueprint', ...(materialIds.length ? { materialIds } : {}) }
    await saveCourse(next)
    await store.removeDir(store.paths.proposal(courseId))
    return { course: next }
  }

  async function discardProposal({ courseId }) {
    assertId(courseId, 'crs')
    await store.removeDir(store.paths.proposal(courseId))
    return { ok: true }
  }

  // One lesson split in two or taken deeper. Nothing is saved: the editor
  // shows the result as an unsaved edit.
  function reworkLesson({ courseId, lesson: raw, unitTitle, lectureTitle, mode }) {
    const split = mode === 'split'
    const lesson = normalizeLesson(raw)
    if (!lesson) throw new TutorError('invalid', 'Unknown lesson')
    return jobs.start('craft/rework', async api => {
      const course = await readCourse(courseId)
      const lessons = await generateJson(llm, {
        purpose: 'teach',
        prompt: reworkPrompt({
          outline: outlineForPrompt(course, { maxChars: 4000 }),
          unitTitle: text(unitTitle, 120),
          lectureTitle: text(lectureTitle, 120),
          lesson: { title: lesson.title, summary: lesson.summary, objectives: lesson.objectives, concepts: lesson.concepts.map(concept => concept.name), estMinutes: lesson.estMinutes },
          mode: split ? 'split' : 'deepen',
          language: course.language,
        }),
        maxTokens: 3000,
        signal: api.signal,
        normalize: value => {
          const list = (Array.isArray(value?.lessons) ? value.lessons : [value]).map(entry => normalizeLesson({ ...entry, id: undefined })).filter(Boolean).slice(0, split ? 3 : 1)
          if (split ? list.length < 2 : !list.length) throw new Error('no usable lessons')
          return list
        },
      })
      return { lessons }
    }, { key: `rework:${courseId}:${lesson.id}`, meta: { courseId } })
  }

  // Manual edits from the blueprint editor.
  async function saveBlueprint({ courseId, blueprint }) {
    const course = await readCourse(courseId)
    const normalized = normalizeBlueprint({ ...blueprint, projects: blueprint?.projects ?? course.projects }, { language: course.language })
    normalized.projects = normalized.projects.map(project => ({ ...project, unitId: normalized.units.some(unit => unit.id === project.unitId) ? project.unitId : normalized.units[normalized.units.length - 1].id }))
    const next = { ...course, ...normalized, language: course.language }
    await saveCourse(next)
    return { course: next }
  }

  // Practice sets for some lessons of one lecture in one model call, each
  // saved as soon as it is checked. Returns { [lessonId]: saved set }.
  async function writeLecturePractice({ course, lecture, lessons = lecture.lessons, materials, signal }) {
    const query = lessons.map(lesson => `${lesson.title} ${lesson.objectives.join(' ')}`).join(' ')
    const sources = materials ?? await readMaterials(store, course.materialIds ?? [])
    const sets = await generateJson(llm, {
      purpose: 'teach',
      prompt: practicePrompt({ course, lecture, lessons, language: course.language, passages: passagesFor(sources, query, 5000) }),
      // 4–6 items per lesson with hints and explanations: room for all of them,
      // so the last lessons of a long lecture are not cut off.
      maxTokens: Math.min(16000, 3000 + lessons.length * 2600),
      signal,
      normalize: raw => raw?.lessons ?? raw,
    })
    const written = {}
    for (const lesson of lessons) {
      const raw = sets?.[lesson.id] ?? sets?.[lesson.title] ?? (lessons.length === 1 ? Object.values(sets ?? {})[0] : undefined)
      const set = normalizePractice(raw ?? { items: [] }, lesson.concepts.map(concept => concept.id))
      if (!set.items.length) continue
      written[lesson.id] = { lessonId: lesson.id, ...set, createdAt: stamp() }
      await store.writeJson(store.paths.practice(course.id, lesson.id), written[lesson.id])
    }
    return written
  }

  // Step 3: confirm → project briefs, and practice for the first unit. Later
  // lectures get theirs when one of their lessons is first opened
  // (lessons.practice), so confirming stays quick even for a long course.
  function confirm({ courseId }) {
    return jobs.start('craft/confirm', async api => {
      const course = await readCourse(courseId)
      if (!course.units) throw new TutorError('no-blueprint', 'Generate a blueprint first')
      const lectures = course.units.slice(0, 1).flatMap(unit => unit.lectures.map(lecture => ({ unit, lecture })))
      const total = lectures.length + (course.projects?.length ? 1 : 0)
      let done = 0
      const warnings = []
      const materials = await readMaterials(store, course.materialIds ?? [])
      api.progress(done, total, 'projects')

      if (course.projects?.length) {
        try {
          const expanded = await generateJson(llm, {
            purpose: 'teach',
            prompt: projectsPrompt({ course: { ...course, outline: outlineForPrompt(course) }, projects: course.projects, language: course.language }),
            maxTokens: 14000,
            signal: api.signal,
            normalize: raw => (Array.isArray(raw?.projects) ? raw.projects : []),
          })
          course.projects = course.projects.map(project => {
            const detail = expanded.find(item => item?.id === project.id) ?? expanded.find(item => text(item?.title, 120) === project.title)
            return detail ? normalizeProject({ ...project, ...detail, id: project.id, unitId: project.unitId }) ?? project : project
          })
        } catch (error) {
          if (api.signal.aborted) throw error
          warnings.push('projects')
        }
        done += 1
        api.progress(done, total, 'practice')
      }

      // Two lectures at a time: fast, and gentle with rate limits.
      const queue = [...lectures]
      const worker = async () => {
        while (queue.length) {
          api.signal.throwIfAborted()
          const { lecture } = queue.shift()
          try {
            await writeLecturePractice({ course, lecture, materials, signal: api.signal })
          } catch (error) {
            if (api.signal.aborted) throw error
            warnings.push(lecture.id)
          }
          done += 1
          api.progress(done, total, 'practice')
        }
      }
      await Promise.all([worker(), worker()])

      const next = { ...course, status: 'ready', confirmedAt: stamp() }
      await saveCourse(next)
      if (!(await store.exists(store.paths.progress(course.id)))) await store.writeJson(store.paths.progress(course.id), emptyProgress(course.id))
      return { course: next, warnings }
    }, { key: `confirm:${courseId}`, meta: { courseId } })
  }

  async function update({ courseId, title, archived, settings }) {
    const course = await readCourse(courseId)
    const next = { ...course }
    if (title !== undefined) next.title = text(title, 120) || course.title
    if (archived !== undefined) next.archived = archived === true
    if (settings && typeof settings === 'object') {
      next.settings = {
        ...course.settings,
        ...(settings.weeklyMinutes !== undefined ? { weeklyMinutes: clampMinutes(settings.weeklyMinutes) } : {}),
        ...(settings.deadline !== undefined ? { deadline: /^\d{4}-\d{2}-\d{2}$/u.test(String(settings.deadline)) ? settings.deadline : null } : {}),
      }
    }
    await saveCourse(next)
    return summary(courseId)
  }

  async function remove({ courseId }) {
    assertId(courseId, 'crs')
    await store.removeDir(store.paths.courseDir(courseId))
    return { removed: courseId }
  }

  async function exportPack({ courseId, includeProgress = false, appVersion }) {
    const course = await readCourse(courseId)
    const progress = await readProgress(store, courseId)
    const boards = {}
    const practice = {}
    const sheets = {}
    for (const { lesson } of flattenLessons(course)) {
      const board = await store.readJson(store.paths.board(courseId, lesson.id), null)
      if (board) boards[lesson.id] = board
      const set = await store.readJson(store.paths.practice(courseId, lesson.id), null)
      if (set) practice[lesson.id] = set
    }
    for (const unit of course.units ?? []) {
      const sheet = await store.readJson(store.paths.sheet(courseId, unit.id), null)
      if (sheet) sheets[unit.id] = sheet
    }
    const cards = (await store.readJson(store.paths.cards(courseId), null))?.cards ?? []
    const pack = exportCoursePack({ course, progress, boards, practice, sheets, cards }, { includeProgress: includeProgress === true, app: { version: appVersion } })
    return { fileName: `${safeFileName(course.title)}.aha-course.json`, json: JSON.stringify(pack) }
  }

  async function importPack({ json }) {
    let imported
    try {
      imported = importCoursePack(json)
    } catch (error) {
      // Only the pack reader's own errors are written for users.
      const known = ['bad-pack', 'pack-too-large', 'pack-too-new'].includes(error?.code)
      throw new TutorError(known ? error.code : 'bad-pack', known ? error.message : 'not a course pack')
    }
    const { course } = imported
    await saveCourse(course)
    for (const [lessonId, board] of Object.entries(imported.boards)) await store.writeJson(store.paths.board(course.id, lessonId), board)
    for (const [lessonId, set] of Object.entries(imported.practice)) await store.writeJson(store.paths.practice(course.id, lessonId), { lessonId, ...set })
    for (const [unitId, sheet] of Object.entries(imported.sheets)) await store.writeJson(store.paths.sheet(course.id, unitId), sheet)
    if (imported.cards.length) await store.writeJson(store.paths.cards(course.id), { cards: imported.cards, srs: {} })
    await store.writeJson(store.paths.progress(course.id), { ...emptyProgress(course.id), ...(imported.progress ?? {}), courseId: course.id })
    return summary(course.id)
  }

  return Object.freeze({ list, get, summary, readCourse, saveCourse, startCraft, submitIntake, revise, addMaterials, applyProposal, discardProposal, reworkLesson, saveBlueprint, writeLecturePractice, confirm, update, remove, exportPack, importPack })
}

function sanitizeAnswers(questionnaire, answers) {
  const clean = {}
  for (const question of questionnaire?.questions ?? []) {
    const answer = answers?.[question.id]
    if (!answer || typeof answer !== 'object') continue
    const valid = new Set(question.options.map(option => option.id))
    const choice = (Array.isArray(answer.choice) ? answer.choice : []).filter(id => valid.has(id)).slice(0, question.multi ? 5 : 1)
    const other = text(answer.other, 300)
    if (choice.length || other) clean[question.id] = { choice, other }
  }
  return clean
}

function clampMinutes(value) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? Math.min(3000, Math.max(30, number)) : null
}

// The model places projects by unit index; keep that placement after
// normalization assigned the units their ids.
function attachProjectUnits(raw, blueprint) {
  const rawProjects = Array.isArray(raw?.projects) ? raw.projects : []
  blueprint.projects = blueprint.projects.map(project => {
    if (project.unitId && blueprint.units.some(unit => unit.id === project.unitId)) return project
    const source = rawProjects.find(item => text(item?.title, 120) === project.title)
    const index = Math.round(Number(source?.unitIndex))
    const unit = blueprint.units[Number.isFinite(index) ? Math.min(blueprint.units.length - 1, Math.max(0, index)) : blueprint.units.length - 1]
    return { ...project, unitId: unit.id }
  })
  return blueprint
}

export function safeFileName(value) {
  const cleaned = String(value ?? 'course').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '').slice(0, 60)
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(cleaned) || !cleaned ? 'course' : cleaned
}
