// The learner across courses: a profile the tutor remembers (and the learner
// can edit or wipe), the study plan built from every active course, and the
// review queue fed by spaced repetition.

import { conceptIndex, findLesson, flattenLessons, text } from '../core/course-model.js'
import { newId } from '../core/ids.js'
import { masteryPercent } from '../core/mastery.js'
import { addDays, buildPlan, mergeAgenda, planCalendar, toDay } from '../core/planner.js'
import { EMPTY_PROFILE, readProfile, readProgress } from './context.js'
import { generateJson, TutorError } from './generate.js'
import { profilePrompt } from './prompts.js'

const PROFILE_REFRESH_MS = 10 * 60_000
const MAX_NOTES = 30

const AGENDA_DAYS = 180
const MAX_CHECKS = 1000

// A plan item as stored with the agenda or a tick: only what the calendar
// shows, every field capped.
function agendaItem(raw) {
  const kind = raw?.kind === 'lesson' || raw?.kind === 'review' ? raw.kind : null
  const refId = text(raw?.refId, 80)
  if (!kind || !refId) return null
  return {
    kind,
    refId,
    courseId: /^crs_[a-z0-9]{6,40}$/u.test(String(raw.courseId)) ? raw.courseId : null,
    title: text(raw.title, 160),
    courseTitle: text(raw.courseTitle, 160),
    courseEmoji: text(raw.courseEmoji, 8),
    minutes: Math.min(240, Math.max(0, Math.round(Number(raw.minutes) || 0))),
  }
}

export function createLearner({ store, llm, now = () => new Date(), logger }) {
  let lastRefresh = 0
  let refreshing = null

  async function getProfile() {
    return readProfile(store)
  }

  async function saveProfile(patch = {}) {
    return store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, current => cleanProfile({ ...current, ...patch, updatedAt: now().toISOString() }))
  }

  async function clearProfile() {
    await store.writeJson(store.paths.profile(), { ...EMPTY_PROFILE, updatedAt: now().toISOString() })
    return readProfile(store)
  }

  async function removeNote({ id }) {
    return store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, current => ({ ...current, notes: (current.notes ?? []).filter(note => note.id !== id) }))
  }

  // After a lesson, let the model refresh the profile — at most every ten
  // minutes and in the background, so lessons never wait for it.
  async function noteLesson({ course, lesson, states }) {
    if (refreshing || now().getTime() - lastRefresh < PROFILE_REFRESH_MS) return
    lastRefresh = now().getTime()
    refreshing = (async () => {
      const profile = await readProfile(store)
      const events = [
        `Finished "${lesson.title}" in the course "${course.title}".`,
        ...states.map(state => `Concept "${state.name}": mastery ${masteryPercent(state)}${state.misconceptions.length ? `, misconceptions: ${state.misconceptions.join('; ')}` : ''}${state.reexplains ? `, asked for ${state.reexplains} re-explanation(s)` : ''}`),
      ].join('\n')
      const update = await generateJson(llm, {
        purpose: 'quick',
        prompt: profilePrompt({ profile: { background: profile.background, goals: profile.goals, strengths: profile.strengths, weaknesses: profile.weaknesses, preferences: profile.preferences }, events, language: course.language }),
        maxTokens: 1500,
      })
      await store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, current => {
        const notes = [...(current.notes ?? [])]
        const note = text(update?.newNote, 200)
        if (note && !notes.some(item => item.text === note)) notes.push({ id: newId('nte'), text: note, source: 'auto', at: now().toISOString() })
        return cleanProfile({
          ...current,
          background: text(update?.background, 600) || current.background,
          goals: list(update?.goals) ?? current.goals,
          strengths: list(update?.strengths) ?? current.strengths,
          weaknesses: list(update?.weaknesses) ?? current.weaknesses,
          preferences: { ...current.preferences, ...(update?.preferences?.style ? { style: text(update.preferences.style, 120) } : {}) },
          notes: notes.slice(-MAX_NOTES),
          updatedAt: now().toISOString(),
        })
      })
    })().catch(error => logger?.debug?.('aha-tutor profile refresh skipped: %s', error?.message)).finally(() => { refreshing = null })
  }

  async function readPlanFile() {
    const plan = (await store.readJson(store.paths.plan(), null)) ?? {}
    return {
      settings: { weeklyMinutes: plan.settings?.weeklyMinutes ?? 300, studyDays: plan.settings?.studyDays ?? [1, 2, 3, 4, 5, 6, 0] },
      exams: Array.isArray(plan.exams) ? plan.exams : [],
      checks: Array.isArray(plan.checks) ? plan.checks : [],
      agenda: plan.agenda && typeof plan.agenda === 'object' ? plan.agenda : {},
    }
  }

  const validDay = value => (/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? '')) ? value : null)

  async function activeCourses() {
    const ids = await store.listIds(store.paths.courses(), 'crs')
    const result = []
    for (const id of ids) {
      const course = await store.readJson(store.paths.course(id), null)
      if (!course || course.status !== 'ready' || course.archived) continue
      result.push({ course, progress: await readProgress(store, id) })
    }
    return result
  }

  // The plan from today on, and a calendar of what was planned and done.
  // A lesson ticked by hand counts as done for planning; a review ticked by
  // hand leaves today's list only (its review schedule is untouched). Time
  // already studied today comes off today's list, so finishing an item does
  // not pull the next one in.
  async function plan({ today } = {}) {
    const file = await readPlanFile()
    const day = validDay(today) ?? toDay(now())
    const active = await activeCourses()
    const tickedLessons = new Set(file.checks.filter(check => check.kind === 'lesson' && check.day <= day).map(check => check.refId))
    const tickedToday = new Set(file.checks.filter(check => check.day === day).map(check => check.refId))
    const reviews = []
    const done = { lessons: new Map(), reviews: new Map() }
    for (const { course, progress } of active) {
      const label = { courseId: course.id, courseTitle: course.title, courseEmoji: course.emoji ?? '' }
      const index = conceptIndex(course)
      for (const [conceptId, card] of Object.entries(progress.reviews ?? {})) {
        const concept = index.get(conceptId)
        if (!concept) continue
        const id = `${course.id}:${conceptId}`
        if (card.lastReviewedAt) done.reviews.set(id, toDay(new Date(card.lastReviewedAt)))
        if (!tickedToday.has(id)) reviews.push({ id, ...label, title: concept.name, dueDay: toDay(new Date(card.dueAt)), minutes: 5 })
      }
      for (const { lesson } of flattenLessons(course)) {
        const record = progress.lessons?.[lesson.id]
        if (record?.status === 'done' && record.completedAt) done.lessons.set(lesson.id, { day: toDay(new Date(record.completedAt)), item: { kind: 'lesson', refId: lesson.id, title: lesson.title, minutes: lesson.estMinutes, ...label } })
      }
    }
    const spent = new Map()
    for (const { day: doneDay, item } of done.lessons.values()) if (doneDay === day) spent.set(item.refId, item.minutes)
    for (const item of file.agenda[day] ?? []) {
      if (item.kind === 'review' && (done.reviews.get(item.refId) === day || tickedToday.has(item.refId))) spent.set(item.refId, item.minutes)
    }
    for (const check of file.checks) if (check.day === day && check.item) spent.set(check.refId, check.item.minutes)
    const built = buildPlan({
      today: day,
      spentToday: [...spent.values()].reduce((sum, minutes) => sum + (Number(minutes) || 0), 0),
      settings: file.settings,
      courses: active.map(({ course, progress }) => ({
        id: course.id,
        title: course.title,
        emoji: course.emoji ?? '',
        deadline: course.settings?.deadline ?? null,
        lessons: flattenLessons(course).map(({ lesson }) => ({ id: lesson.id, title: lesson.title, minutes: lesson.estMinutes, done: progress.lessons?.[lesson.id]?.status === 'done' || tickedLessons.has(lesson.id) })),
      })),
      reviews,
      exams: file.exams.map(exam => ({ id: exam.id, title: exam.title, day: exam.day, courseId: exam.courseId ?? null })),
    })
    // Keep what is planned today, so it stays on today's list once done.
    // The file is written only when today's list or the kept days change.
    const planned = (built.days.find(entry => entry.day === day)?.items ?? []).filter(item => item.kind !== 'exam').map(agendaItem)
    const oldest = addDays(day, -AGENDA_DAYS)
    const merged = mergeAgenda(file.agenda[day] ?? [], planned).slice(0, 40)
    let agenda = file.agenda
    if (JSON.stringify(merged) !== JSON.stringify(file.agenda[day] ?? []) || Object.keys(file.agenda).some(key => key < oldest)) {
      const saved = await store.updateJson(store.paths.plan(), {}, current => {
        const kept = Object.fromEntries(Object.entries(current.agenda ?? {}).filter(([key]) => validDay(key) && key >= oldest))
        kept[day] = mergeAgenda(kept[day] ?? [], planned).slice(0, 40)
        return { ...current, agenda: kept }
      })
      agenda = saved.agenda
    }
    const calendar = planCalendar({ today: day, agenda, plan: built, done, checks: file.checks })
    return { settings: file.settings, exams: file.exams, plan: built, today: calendar.today, calendar: calendar.days }
  }

  // Tick an item by hand (on the day it belongs to), or take the tick back.
  async function check({ today, day, item }) {
    const current = validDay(today) ?? toDay(now())
    const when = validDay(day)
    const entry = agendaItem(item ?? {})
    if (!when || !entry || when > current) throw new TutorError('cannot-tick', 'Only today or an earlier day can be ticked')
    await store.updateJson(store.paths.plan(), {}, current => ({
      ...current,
      checks: [...(current.checks ?? []).filter(existing => !(existing.refId === entry.refId && existing.day === when)), { refId: entry.refId, kind: entry.kind, day: when, item: entry, at: now().toISOString() }].slice(-MAX_CHECKS),
    }))
    return plan({ today })
  }

  async function uncheck({ today, day, refId }) {
    await store.updateJson(store.paths.plan(), {}, current => ({ ...current, checks: (current.checks ?? []).filter(existing => !(existing.refId === refId && existing.day === day)) }))
    return plan({ today })
  }

  async function savePlanSettings({ weeklyMinutes, studyDays }) {
    await store.updateJson(store.paths.plan(), {}, current => ({
      ...current,
      settings: {
        weeklyMinutes: Math.min(3000, Math.max(30, Math.round(Number(weeklyMinutes) || 300))),
        studyDays: [...new Set((Array.isArray(studyDays) ? studyDays : []).map(Number).filter(value => value >= 0 && value <= 6))].sort(),
      },
    }))
    return plan()
  }

  async function addExam({ title, day, courseId }) {
    const name = text(title, 120)
    if (!name || !/^\d{4}-\d{2}-\d{2}$/u.test(String(day))) throw new TutorError('exam-incomplete', 'Exam needs a title and a date')
    await store.updateJson(store.paths.plan(), {}, current => ({
      ...current,
      exams: [...(current.exams ?? []), { id: newId('exm'), title: name, day, courseId: /^crs_[a-z0-9]+$/u.test(String(courseId)) ? courseId : null }].slice(-50),
    }))
    return plan()
  }

  async function removeExam({ id }) {
    await store.updateJson(store.paths.plan(), {}, current => ({ ...current, exams: (current.exams ?? []).filter(exam => exam.id !== id) }))
    return plan()
  }

  // Due concept reviews → a short mixed practice session.
  // Due reviews across all courses, or one course's only.
  async function reviewSession({ limit = 8, courseId } = {}) {
    const at = now().getTime()
    const items = []
    for (const { course, progress } of await activeCourses()) {
      if (courseId && course.id !== courseId) continue
      const index = conceptIndex(course)
      const due = Object.entries(progress.reviews ?? {})
        .filter(([id, card]) => index.has(id) && Date.parse(card.dueAt) <= at)
        .sort((a, b) => Date.parse(a[1].dueAt) - Date.parse(b[1].dueAt))
      for (const [conceptId] of due) {
        if (items.length >= limit) break
        const concept = index.get(conceptId)
        const lesson = findLesson(course, concept.lessonId)?.lesson
        const set = await store.readJson(store.paths.practice(course.id, concept.lessonId), null)
        const board = await store.readJson(store.paths.board(course.id, concept.lessonId), null)
        // Each with where it is kept, so a question the learner challenges
        // is fixed there.
        const candidates = [
          ...(set?.items ?? []).map(item => ({ item, source: { kind: 'practice', courseId: course.id, lessonId: concept.lessonId, itemId: item.id } })),
          ...(board?.steps ?? []).filter(step => step.check).map(step => ({ item: step.check, source: { kind: 'check', courseId: course.id, lessonId: concept.lessonId, stepId: step.id } })),
        ].filter(({ item }) => item.conceptIds?.includes(conceptId) && item.kind !== 'short' && item.kind !== 'work')
        const pick = candidates[Math.floor(Math.random() * candidates.length)]
        if (pick) items.push({ courseId: course.id, courseTitle: course.title, lessonId: concept.lessonId, lessonTitle: lesson?.title ?? '', conceptId, conceptName: concept.name, item: pick.item, source: pick.source })
      }
    }
    return { items }
  }

  return Object.freeze({ getProfile, saveProfile, clearProfile, removeNote, noteLesson, plan, check, uncheck, savePlanSettings, addExam, removeExam, reviewSession })
}

function list(value) {
  if (!Array.isArray(value)) return undefined
  return value.map(item => text(item, 160)).filter(Boolean).slice(0, 8)
}

function cleanProfile(profile) {
  return {
    background: text(profile.background, 600),
    goals: list(profile.goals) ?? [],
    strengths: list(profile.strengths) ?? [],
    weaknesses: list(profile.weaknesses) ?? [],
    preferences: {
      style: text(profile.preferences?.style, 120),
      pace: ['slow', 'normal', 'fast'].includes(profile.preferences?.pace) ? profile.preferences.pace : 'normal',
    },
    notes: (Array.isArray(profile.notes) ? profile.notes : [])
      .map(note => ({ id: /^nte_[a-z0-9]+$/u.test(String(note?.id)) ? note.id : newId('nte'), text: text(note?.text, 200), source: note?.source === 'user' ? 'user' : 'auto', at: note?.at ?? null }))
      .filter(note => note.text)
      .slice(-MAX_NOTES),
    updatedAt: profile.updatedAt ?? null,
  }
}
