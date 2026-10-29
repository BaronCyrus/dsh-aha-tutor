// Browser ↔ host contract. One channel, many endpoints; every payload is
// validated here before it reaches a service. Results use DSH's RPC shape:
// { ok: true, value } or { ok: false, error: { code, message, details } }.
// Only messages written for users leave the host.

import { TutorError } from './generate.js'
import { publicCode, publicMessage } from './jobs.js'
import { MAX_SPEECH_BYTES } from './speech.js'

const ID = prefix => new RegExp(`^${prefix}_[a-z0-9]{6,40}$`, 'u')
const IDS = { crs: ID('crs'), les: ID('les'), unt: ID('unt'), prj: ID('prj'), mat: ID('mat'), job: ID('job'), thd: ID('thd'), sht: ID('sht'), chs: ID('chs'), dck: ID('dck'), exm: ID('exm'), nte: ID('nte'), asd: ID('asd'), evd: ID('evd') }

function need(payload, key, prefix) {
  const value = payload?.[key]
  if (typeof value !== 'string' || !IDS[prefix].test(value)) throw new TutorError('invalid', `Invalid ${key}`)
  return value
}

function optional(payload, key, prefix) {
  return payload?.[key] === undefined || payload?.[key] === null ? undefined : need(payload, key, prefix)
}

function idList(value, prefix, max = 8) {
  return (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && IDS[prefix].test(item)).slice(0, max)
}

// A board scope may name the job still writing that board (the one the
// classroom follows); the service checks that the job belongs to it.
function scopeOf(payload) {
  const scope = payload?.scope ?? {}
  const jobId = optional(scope, 'jobId', 'job')
  const writing = jobId ? { jobId } : {}
  if (scope.kind === 'lesson') return { kind: 'lesson', courseId: need(scope, 'courseId', 'crs'), lessonId: need(scope, 'lessonId', 'les'), ...writing }
  if (scope.kind === 'thread') return { kind: 'thread', id: need(scope, 'id', 'thd'), turn: Number(scope.turn) || 0, ...writing }
  if (scope.kind === 'short') return { kind: 'short', id: need(scope, 'id', 'sht'), ...writing }
  throw new TutorError('invalid', 'Invalid board scope')
}

// The step a learner challenges: one of the board's own steps, a step of an
// answer kept with the lesson, or a step the classroom holds itself (checked
// op by op by the service).
function challengeTarget(payload) {
  const target = payload?.target && typeof payload.target === 'object' ? payload.target : {}
  if (target.step && typeof target.step === 'object') return { step: target.step }
  if (typeof target.stepId !== 'string' || !/^s\d{1,4}$/u.test(target.stepId)) throw new TutorError('invalid', 'Invalid step')
  return { stepId: target.stepId, ...(target.asideId === undefined ? {} : { asideId: need(target, 'asideId', 'asd') }) }
}

// A practice or quiz question the learner challenges, named by where it is
// kept: a lesson's practice, a unit quiz, a quiz from the library, or the
// check of a lesson step.
function itemSource(payload) {
  const source = payload?.source && typeof payload.source === 'object' ? payload.source : {}
  const itemId = () => {
    if (typeof source.itemId !== 'string' || !/^[a-z0-9_-]{1,24}$/iu.test(source.itemId)) throw new TutorError('invalid', 'Invalid question')
    return source.itemId
  }
  if (source.kind === 'practice') return { kind: 'practice', courseId: need(source, 'courseId', 'crs'), lessonId: need(source, 'lessonId', 'les'), itemId: itemId() }
  if (source.kind === 'quiz') return { kind: 'quiz', courseId: need(source, 'courseId', 'crs'), unitId: need(source, 'unitId', 'unt'), itemId: itemId() }
  if (source.kind === 'deck') return { kind: 'deck', deckId: need(source, 'deckId', 'dck'), itemId: itemId() }
  if (source.kind === 'check') {
    if (typeof source.stepId !== 'string' || !/^s\d{1,4}$/u.test(source.stepId)) throw new TutorError('invalid', 'Invalid step')
    return { kind: 'check', courseId: need(source, 'courseId', 'crs'), lessonId: need(source, 'lessonId', 'les'), stepId: source.stepId }
  }
  throw new TutorError('invalid', 'Invalid question')
}

// The learner's answer to a challenged question (an option id, a list of
// them, or text) and the grade they were shown.
function answerOf(value) {
  if (typeof value === 'string') return value.slice(0, 4000)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^[a-z]$/u.test(id)).slice(0, 12) : ''
}

// The question a recorded answer was given to, where its course keeps it,
// and the answer, so that a fix of the question can grade it again. Null
// for anything else: the answer is recorded without them.
function answeredItem(payload, courseId) {
  if (!payload?.source || payload.source.kind === 'deck') return null
  try {
    const source = itemSource(payload)
    return source.courseId === courseId ? { source, response: answerOf(payload.response) } : null
  } catch {
    return null
  }
}

function shownGrade(value) {
  const grade = value && typeof value === 'object' ? value : {}
  const words = (key, max) => (typeof grade[key] === 'string' ? grade[key].slice(0, max) : '')
  return { score: Math.min(1, Math.max(0, Number(grade.score) || 0)), correct: grade.correct === true, partial: grade.partial === true, feedback: words('feedback', 1200), wrongStep: words('wrongStep', 400), fix: words('fix', 400) }
}

const ITEM_KINDS = { sheets: 'chs', decks: 'dck', assist: 'thd', shorts: 'sht' }
const GRADES = ['again', 'hard', 'good', 'easy']
const STYLES = ['analogy', 'visual', 'example', 'simpler', 'deeper']

export function createRoutes({ courses, lessons, learner, studio, projects, jobs, settings, tts, plugin, info, speechInput }) {
  return {
    'app/info': () => info(),

    'job/get': payload => jobs.get(need(payload, 'id', 'job'), { since: Math.max(0, Number(payload.since) || 0) }) ?? { status: 'missing' },
    'job/cancel': payload => jobs.cancel(need(payload, 'id', 'job')),

    'course/list': () => courses.list(),
    'course/get': payload => courses.get({ courseId: need(payload, 'courseId', 'crs') }),
    'course/start': payload => ({ job: courses.startCraft({ goal: payload.goal, materialIds: idList(payload.materialIds, 'mat'), quick: payload.quick === true, web: payload.web === true, language: typeof payload.language === 'string' ? payload.language.slice(0, 12) : undefined }) }),
    'course/proposal-apply': payload => courses.applyProposal({ courseId: need(payload, 'courseId', 'crs') }),
    'course/proposal-discard': payload => courses.discardProposal({ courseId: need(payload, 'courseId', 'crs') }),
    'course/rework-lesson': payload => ({ job: courses.reworkLesson({ courseId: need(payload, 'courseId', 'crs'), lesson: payload.lesson, unitTitle: payload.unitTitle, lectureTitle: payload.lectureTitle, mode: payload.mode === 'split' ? 'split' : 'deepen' }) }),
    'course/intake': payload => ({ job: courses.submitIntake({ courseId: need(payload, 'courseId', 'crs'), answers: payload.answers, timeline: payload.timeline, size: payload.size, weeklyMinutes: payload.weeklyMinutes, deadline: payload.deadline }) }),
    'course/revise': payload => ({ job: courses.revise({ courseId: need(payload, 'courseId', 'crs'), instruction: payload.instruction }) }),
    'course/add-materials': payload => ({ job: courses.addMaterials({ courseId: need(payload, 'courseId', 'crs'), materialIds: idList(payload.materialIds, 'mat', 12), instruction: payload.instruction }) }),
    'course/save-blueprint': payload => courses.saveBlueprint({ courseId: need(payload, 'courseId', 'crs'), blueprint: payload.blueprint }),
    'course/confirm': payload => ({ job: courses.confirm({ courseId: need(payload, 'courseId', 'crs') }) }),
    'course/update': payload => courses.update({ courseId: need(payload, 'courseId', 'crs'), title: payload.title, archived: payload.archived, settings: payload.settings }),
    'course/remove': payload => courses.remove({ courseId: need(payload, 'courseId', 'crs') }),
    'course/export': async payload => courses.exportPack({ courseId: need(payload, 'courseId', 'crs'), includeProgress: payload.includeProgress === true, appVersion: (await info()).version }),
    'course/import': payload => {
      if (typeof payload.json !== 'string') throw new TutorError('invalid', 'Choose a course pack file')
      return courses.importPack({ json: payload.json })
    },
    'course/card-session': payload => lessons.cardSession({ courseId: need(payload, 'courseId', 'crs') }),
    'course/card-review': payload => {
      if (!GRADES.includes(payload.grade)) throw new TutorError('invalid', 'Invalid grade')
      return lessons.reviewCard({ courseId: need(payload, 'courseId', 'crs'), unitId: optional(payload, 'unitId', 'unt'), cardId: String(payload.cardId ?? '').slice(0, 12), grade: payload.grade })
    },

    'lesson/get': payload => lessons.get({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les') }),
    'lesson/prepare': payload => lessons.prepare({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), force: payload.force === true, style: payload.style }),
    'lesson/ask': payload => ({ job: lessons.ask({ scope: scopeOf(payload), stepIndex: payload.stepIndex, question: payload.question, anchorStepId: payload.anchorStepId }) }),
    'lesson/reexplain': payload => ({ job: lessons.reexplain({ scope: scopeOf(payload), stepIndex: payload.stepIndex, style: STYLES.includes(payload.style) ? payload.style : 'example', anchorStepId: payload.anchorStepId }) }),
    'lesson/challenge': payload => ({ job: lessons.challenge({ scope: scopeOf(payload), stepIndex: payload.stepIndex, anchorStepId: payload.anchorStepId, target: challengeTarget(payload), note: typeof payload.note === 'string' ? payload.note : '' }) }),
    'lesson/record': payload => lessons.record({
      courseId: need(payload, 'courseId', 'crs'),
      lessonId: optional(payload, 'lessonId', 'les'),
      item: answeredItem(payload, need(payload, 'courseId', 'crs')),
      conceptIds: (Array.isArray(payload.conceptIds) ? payload.conceptIds : []).filter(id => /^cpt_[a-z0-9]{6,40}$/u.test(String(id))).slice(0, 8),
      evidence: {
        kind: payload.evidence?.kind,
        score: payload.evidence?.score,
        confidence: payload.evidence?.confidence,
        hintsUsed: payload.evidence?.hintsUsed,
        timeMs: payload.evidence?.timeMs,
        expectedMs: payload.evidence?.expectedMs,
        errorTag: typeof payload.evidence?.errorTag === 'string' ? payload.evidence.errorTag.slice(0, 80) : undefined,
        rating: payload.evidence?.rating,
      },
    }),
    'lesson/grade': payload => lessons.grade({ item: payload.item, response: payload.response, language: typeof payload.language === 'string' ? payload.language.slice(0, 12) : undefined }),
    'item/challenge': payload => ({ job: lessons.challengeItem({ source: itemSource(payload), response: answerOf(payload.response), shown: shownGrade(payload.shown), evidenceId: optional(payload, 'evidenceId', 'evd'), note: typeof payload.note === 'string' ? payload.note : '' }) }),
    'lesson/correct': payload => ({ job: lessons.correct({ scope: scopeOf(payload), stepIndex: payload.stepIndex, anchorStepId: payload.anchorStepId, item: payload.item, response: payload.response, grade: payload.grade }) }),
    'lesson/position': payload => lessons.savePosition({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), stepIndex: payload.stepIndex }),
    'lesson/complete': payload => lessons.complete({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), selfRating: Number(payload.selfRating) || undefined }),
    'lesson/handout': payload => lessons.handout({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), force: payload.force === true }),
    'lesson/practice': payload => lessons.practice({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les') }),
    'unit/sheet': payload => lessons.unitSheet({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), force: payload.force === true }),
    'unit/sheet-layout': payload => lessons.saveSheetLayout({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), layout: payload.layout }),
    'unit/quiz': payload => lessons.unitQuiz({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), force: payload.force === true }),
    'unit/cards': payload => lessons.unitCards({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt') }),

    'profile/get': () => learner.getProfile(),
    'profile/save': payload => learner.saveProfile({ name: payload.name, background: payload.background, goals: payload.goals, strengths: payload.strengths, weaknesses: payload.weaknesses, preferences: payload.preferences, notes: payload.notes }),
    'profile/clear': () => learner.clearProfile(),
    'profile/remove-note': payload => learner.removeNote({ id: need(payload, 'id', 'nte') }),
    'plan/get': payload => learner.plan({ today: payload.today }),
    'plan/check': payload => learner.check({ today: payload.today, day: payload.day, item: payload.item }),
    'plan/uncheck': payload => learner.uncheck({ today: payload.today, day: String(payload.day ?? '').slice(0, 10), refId: String(payload.refId ?? '').slice(0, 80) }),
    'plan/settings': payload => learner.savePlanSettings({ weeklyMinutes: payload.weeklyMinutes, studyDays: payload.studyDays }),
    'plan/add-exam': payload => learner.addExam({ title: payload.title, day: payload.day, courseId: payload.courseId }),
    'plan/remove-exam': payload => learner.removeExam({ id: need(payload, 'id', 'exm') }),
    'review/session': payload => learner.reviewSession({ courseId: optional(payload, 'courseId', 'crs') }),

    'material/upload': payload => ({ job: studio.upload({ name: payload.name, base64: payload.base64 }) }),
    'material/url': payload => ({ job: studio.addUrl({ url: payload.url }) }),
    'material/list': () => studio.listMaterials(),
    'material/search': payload => studio.searchMaterials({ query: typeof payload.query === 'string' ? payload.query : '' }),
    'material/get': payload => studio.getMaterial({ id: need(payload, 'id', 'mat') }),
    'material/rename': payload => studio.renameMaterial({ id: need(payload, 'id', 'mat'), title: payload.title }),
    'material/remove': payload => studio.removeMaterial({ id: need(payload, 'id', 'mat') }),
    'material/digest': payload => ({ job: studio.digest({ id: need(payload, 'id', 'mat') }) }),
    'studio/sheet': payload => ({ job: studio.makeSheet({ materialIds: idList(payload.materialIds, 'mat'), focus: payload.focus }) }),
    'studio/notes': payload => ({ job: studio.makeNotes({ materialIds: idList(payload.materialIds, 'mat') }) }),
    'studio/cards': payload => ({ job: studio.makeCards({ materialIds: idList(payload.materialIds, 'mat'), count: payload.count }) }),
    'studio/quiz': payload => ({ job: studio.makeQuiz({ materialIds: idList(payload.materialIds, 'mat'), count: payload.count }) }),
    'items/list': payload => {
      if (!ITEM_KINDS[payload.kind]) throw new TutorError('invalid', 'Unknown collection')
      return studio.listItems({ kind: payload.kind })
    },
    'items/get': payload => {
      const prefix = ITEM_KINDS[payload.kind]
      if (!prefix) throw new TutorError('invalid', 'Unknown collection')
      return studio.getItem({ kind: payload.kind, id: need(payload, 'id', prefix) })
    },
    'items/remove': payload => {
      const prefix = ITEM_KINDS[payload.kind]
      if (!prefix) throw new TutorError('invalid', 'Unknown collection')
      return studio.removeItem({ kind: payload.kind, id: need(payload, 'id', prefix) })
    },
    'items/sheet-layout': payload => studio.saveStandaloneLayout({ id: need(payload, 'id', 'chs'), layout: payload.layout }),
    'items/card-review': payload => {
      if (!GRADES.includes(payload.grade)) throw new TutorError('invalid', 'Invalid grade')
      return studio.reviewDeckCard({ id: need(payload, 'id', 'dck'), cardId: String(payload.cardId ?? '').slice(0, 12), grade: payload.grade })
    },
    'assist/ask': payload => ({ job: studio.assist({ mode: payload.mode, request: payload.request, materialIds: idList(payload.materialIds, 'mat'), threadId: optional(payload, 'threadId', 'thd'), newThreadId: optional(payload, 'newThreadId', 'thd') }) }),
    'short/make': payload => ({ job: studio.makeShort({ topic: payload.topic, url: typeof payload.url === 'string' && payload.url.trim() ? payload.url.trim().slice(0, 2000) : undefined, newId: optional(payload, 'newId', 'sht') }) }),

    'project/get': payload => projects.get({ courseId: need(payload, 'courseId', 'crs'), projectId: need(payload, 'projectId', 'prj') }),
    'project/open': payload => projects.openWorkspace({ courseId: need(payload, 'courseId', 'crs'), projectId: need(payload, 'projectId', 'prj') }),
    'project/submit': payload => ({ job: projects.submit({ courseId: need(payload, 'courseId', 'crs'), projectId: need(payload, 'projectId', 'prj'), notes: payload.notes, includeWorkspace: payload.includeWorkspace !== false }) }),

    'tts/speak': async payload => {
      const textValue = typeof payload.text === 'string' ? payload.text.slice(0, 4000) : ''
      const result = await tts.speak({ text: textValue, provider: payload.provider })
      return { base64: result.audio.toString('base64'), mime: result.mime, cached: result.cached === true }
    },

    // Voice questions: whether DSH's Voice Input can transcribe now, and the
    // base64 route for hosts without HTTP routes.
    'speech/status': () => speechInput.status(),
    'speech/transcribe': async payload => {
      const encoded = typeof payload.base64 === 'string' ? payload.base64 : ''
      if (encoded.length > Math.ceil(MAX_SPEECH_BYTES / 3) * 4) throw new TutorError('speech-too-long', 'The recording is too long')
      const audio = Buffer.from(encoded, 'base64')
      if (!encoded || audio.toString('base64') !== encoded) throw new TutorError('speech-audio', 'The recording could not be read')
      return speechInput.transcribe({ audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) })
    },

    'settings/get': () => settings.get(),
    'settings/save': payload => settings.save(payload.settings ?? {}),
    'settings/set-key': payload => settings.setKey({ provider: payload.provider, key: payload.key }),
    'settings/clear-key': payload => settings.clearKey({ provider: payload.provider }),
    'models/list': () => settings.models(),

    'plugin/version': payload => plugin.read({ force: payload.force === true }),
    'plugin/update': () => plugin.update(),
  }
}

export const isOwner = peer => peer === undefined || peer?.principal?.kind === 'owner' || peer?.kind === 'owner'

export function createRpcHandler(routes, { logger, checkPeer = isOwner } = {}) {
  return async (endpoint, payload, signal, peer) => {
    if (!checkPeer(peer)) return failure('forbidden', 'Not allowed')
    const route = Object.hasOwn(routes, endpoint) ? routes[endpoint] : undefined
    if (!route) return failure('unknown-endpoint', 'Unknown request')
    try {
      const value = await route(payload && typeof payload === 'object' ? payload : {}, signal)
      return { ok: true, value: value ?? null }
    } catch (error) {
      if (signal?.aborted) throw error
      const known = ['TutorError', 'MaterialError', 'TtsError'].includes(error?.name)
      if (!known) logger?.warn?.('aha-tutor %s failed: %s', endpoint, error?.message)
      return failure(publicCode(error), publicMessage(error))
    }
  }
}

function failure(code, message) {
  return { ok: false, error: { code: `aha-tutor/${code}`, message, details: {} } }
}
