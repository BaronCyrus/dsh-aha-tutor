// Course crafting and the course library: intake questionnaire → blueprint →
// revisions → confirmation (practice sets and project briefs) → ready.

import { exportCoursePack, importCoursePack } from '../core/coursepack.js'
import {
  COURSE_SCHEMA_VERSION,
  courseProgress,
  flattenLessons,
  intakeSummary,
  nextLesson,
  normalizeBlueprint,
  normalizePractice,
  normalizeProject,
  normalizeQuestionnaire,
  outlineForPrompt,
  text,
} from '../core/course-model.js'
import { assertId, newId } from '../core/ids.js'
import { emptyProgress, materialImages, materialsSummary, passagesFor, readMaterials, readProfile, readProgress } from './context.js'
import { generateJson, TutorError } from './generate.js'
import { blueprintPrompt, detectLanguage, practicePrompt, projectsPrompt, questionnairePrompt, revisePrompt } from './prompts.js'

const TIMELINES = ['intensive', 'balanced', 'relaxed']

export function createCourses({ store, llm, jobs, now = () => new Date() }) {
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
    const [progress, intake] = await Promise.all([readProgress(store, courseId), store.readJson(store.paths.intake(courseId), null)])
    const boards = new Set(await store.listIds(store.paths.boardsDir(courseId), 'les'))
    const practice = new Set(await store.listIds(store.paths.practiceDir(courseId), 'les'))
    const sheets = new Set(await store.listIds(store.paths.sheetsDir(courseId), 'unt'))
    return {
      course,
      progress,
      intake,
      jobs: {
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
  function startCraft({ goal, materialIds = [], quick = false, language }) {
    const cleanGoal = text(goal, 2000)
    if (!cleanGoal && !materialIds.length) throw new TutorError('invalid', 'Tell me what you want to learn')
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
      if (quick) return { courseId, questionnaire: null }
      const profile = await readProfile(store)
      const questionnaire = await generateJson(llm, {
        purpose: 'teach',
        prompt: questionnairePrompt({ goal: draft.goal, language: draft.language, materialsSummary: materialsSummary(materials), profile }),
        maxTokens: 3000,
        signal: api.signal,
        normalize: raw => {
          const value = normalizeQuestionnaire(raw)
          if (!value.questions.length) throw new Error('no questions')
          return value
        },
      })
      await store.writeJson(store.paths.intake(courseId), { questionnaire, answers: {}, at: stamp() })
      api.progress(1, 2, 'questions')
      return { courseId, questionnaire }
    }, { meta: { courseId } })
  }

  // Step 2: answers → blueprint.
  function submitIntake({ courseId, answers = {}, timeline = 'balanced', weeklyMinutes, deadline }) {
    assertId(courseId, 'crs')
    return jobs.start('craft/blueprint', async api => {
      const course = await readCourse(courseId)
      const intake = (await store.readJson(store.paths.intake(courseId), null)) ?? { questionnaire: null, answers: {} }
      const cleanAnswers = sanitizeAnswers(intake.questionnaire, answers)
      await store.writeJson(store.paths.intake(courseId), { ...intake, answers: cleanAnswers, at: stamp() })
      const materials = await readMaterials(store, course.materialIds ?? [])
      const profile = await readProfile(store)
      const settings = {
        timeline: TIMELINES.includes(timeline) ? timeline : 'balanced',
        weeklyMinutes: clampMinutes(weeklyMinutes),
        deadline: /^\d{4}-\d{2}-\d{2}$/u.test(String(deadline ?? '')) ? deadline : null,
      }
      api.progress(0, 1, 'blueprint')
      const blueprint = await generateJson(llm, {
        purpose: 'teach',
        prompt: blueprintPrompt({
          goal: course.goal,
          language: course.language,
          intake: intakeSummary(intake.questionnaire, cleanAnswers),
          materialsSummary: materialsSummary(materials),
          profile,
          timeline: settings.timeline,
          weeklyMinutes: settings.weeklyMinutes,
        }),
        images: llm.supportsImages?.('teach') ? await materialImages(store, materials) : undefined,
        maxTokens: 16000,
        signal: api.signal,
        normalize: raw => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language })),
      })
      const next = { ...course, ...blueprint, language: course.language, status: 'blueprint', settings }
      await saveCourse(next)
      api.progress(1, 1, 'blueprint')
      return { course: next }
    }, { key: `blueprint:${courseId}`, meta: { courseId } })
  }

  function revise({ courseId, instruction }) {
    const request = text(instruction, 1500)
    if (!request) throw new TutorError('invalid', 'Describe the change you want')
    return jobs.start('craft/revise', async api => {
      const course = await readCourse(courseId)
      if (!course.units) throw new TutorError('invalid', 'There is no blueprint to revise yet')
      const current = { title: course.title, subtitle: course.subtitle, emoji: course.emoji, summary: course.summary, level: course.level, units: course.units, projects: course.projects }
      const revised = await generateJson(llm, {
        purpose: 'teach',
        prompt: revisePrompt({ blueprint: current, instruction: request, language: course.language }),
        maxTokens: 16000,
        signal: api.signal,
        normalize: raw => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language })),
      })
      const next = { ...course, ...revised, language: course.language, status: course.status === 'ready' ? 'ready' : 'blueprint' }
      await saveCourse(next)
      return { course: next }
    }, { key: `blueprint:${courseId}`, meta: { courseId } })
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

  // Step 3: confirm → project briefs and practice for every lecture.
  function confirm({ courseId }) {
    return jobs.start('craft/confirm', async api => {
      const course = await readCourse(courseId)
      if (!course.units) throw new TutorError('invalid', 'Generate a blueprint first')
      const lectures = course.units.flatMap(unit => unit.lectures.map(lecture => ({ unit, lecture })))
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
            const query = lecture.lessons.map(lesson => `${lesson.title} ${lesson.objectives.join(' ')}`).join(' ')
            const sets = await generateJson(llm, {
              purpose: 'teach',
              prompt: practicePrompt({ course, lecture, lessons: lecture.lessons, language: course.language, passages: passagesFor(materials, query, 5000) }),
              maxTokens: 9000,
              signal: api.signal,
              normalize: raw => raw?.lessons ?? raw,
            })
            for (const lesson of lecture.lessons) {
              const conceptIds = lesson.concepts.map(concept => concept.id)
              const set = normalizePractice(sets?.[lesson.id] ?? sets?.[lesson.title] ?? { items: [] }, conceptIds)
              if (set.items.length) await store.writeJson(store.paths.practice(course.id, lesson.id), { lessonId: lesson.id, ...set, createdAt: stamp() })
            }
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
    const imported = importCoursePack(json)
    const { course } = imported
    await saveCourse(course)
    for (const [lessonId, board] of Object.entries(imported.boards)) await store.writeJson(store.paths.board(course.id, lessonId), board)
    for (const [lessonId, set] of Object.entries(imported.practice)) await store.writeJson(store.paths.practice(course.id, lessonId), { lessonId, ...set })
    for (const [unitId, sheet] of Object.entries(imported.sheets)) await store.writeJson(store.paths.sheet(course.id, unitId), sheet)
    if (imported.cards.length) await store.writeJson(store.paths.cards(course.id), { cards: imported.cards, srs: {} })
    await store.writeJson(store.paths.progress(course.id), { ...emptyProgress(course.id), ...(imported.progress ?? {}), courseId: course.id })
    return summary(course.id)
  }

  return Object.freeze({ list, get, summary, readCourse, saveCourse, startCraft, submitIntake, revise, saveBlueprint, confirm, update, remove, exportPack, importPack })
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
