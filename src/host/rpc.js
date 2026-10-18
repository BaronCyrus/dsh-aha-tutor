// Browser ↔ host contract. One channel, many endpoints; every payload is
// validated here before it reaches a service. Results use DSH's RPC shape:
// { ok: true, value } or { ok: false, error: { code, message, details } }.
// Only messages written for users leave the host.

import { TutorError } from './generate.js'
import { publicMessage } from './jobs.js'

const ID = prefix => new RegExp(`^${prefix}_[a-z0-9]{6,40}$`, 'u')
const IDS = { crs: ID('crs'), les: ID('les'), unt: ID('unt'), prj: ID('prj'), mat: ID('mat'), job: ID('job'), thd: ID('thd'), sht: ID('sht'), chs: ID('chs'), dck: ID('dck'), exm: ID('exm'), nte: ID('nte') }

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

function scopeOf(payload) {
  const scope = payload?.scope ?? {}
  if (scope.kind === 'lesson') return { kind: 'lesson', courseId: need(scope, 'courseId', 'crs'), lessonId: need(scope, 'lessonId', 'les') }
  if (scope.kind === 'thread') return { kind: 'thread', id: need(scope, 'id', 'thd'), turn: Number(scope.turn) || 0 }
  if (scope.kind === 'short') return { kind: 'short', id: need(scope, 'id', 'sht') }
  throw new TutorError('invalid', 'Invalid board scope')
}

const ITEM_KINDS = { sheets: 'chs', decks: 'dck', assist: 'thd', shorts: 'sht' }
const GRADES = ['again', 'hard', 'good', 'easy']
const STYLES = ['analogy', 'visual', 'example', 'simpler', 'deeper']

export function createRoutes({ courses, lessons, learner, studio, projects, jobs, settings, tts, plugin, info }) {
  return {
    'app/info': () => info(),

    'job/get': payload => jobs.get(need(payload, 'id', 'job'), { since: Math.max(0, Number(payload.since) || 0) }) ?? { status: 'missing' },
    'job/cancel': payload => jobs.cancel(need(payload, 'id', 'job')),

    'course/list': () => courses.list(),
    'course/get': payload => courses.get({ courseId: need(payload, 'courseId', 'crs') }),
    'course/start': payload => ({ job: courses.startCraft({ goal: payload.goal, materialIds: idList(payload.materialIds, 'mat'), quick: payload.quick === true, language: typeof payload.language === 'string' ? payload.language.slice(0, 12) : undefined }) }),
    'course/intake': payload => ({ job: courses.submitIntake({ courseId: need(payload, 'courseId', 'crs'), answers: payload.answers, timeline: payload.timeline, weeklyMinutes: payload.weeklyMinutes, deadline: payload.deadline }) }),
    'course/revise': payload => ({ job: courses.revise({ courseId: need(payload, 'courseId', 'crs'), instruction: payload.instruction }) }),
    'course/save-blueprint': payload => courses.saveBlueprint({ courseId: need(payload, 'courseId', 'crs'), blueprint: payload.blueprint }),
    'course/confirm': payload => ({ job: courses.confirm({ courseId: need(payload, 'courseId', 'crs') }) }),
    'course/update': payload => courses.update({ courseId: need(payload, 'courseId', 'crs'), title: payload.title, archived: payload.archived, settings: payload.settings }),
    'course/remove': payload => courses.remove({ courseId: need(payload, 'courseId', 'crs') }),
    'course/export': async payload => courses.exportPack({ courseId: need(payload, 'courseId', 'crs'), includeProgress: payload.includeProgress === true, appVersion: (await info()).version }),
    'course/import': payload => {
      if (typeof payload.json !== 'string') throw new TutorError('invalid', 'Choose a course pack file')
      return courses.importPack({ json: payload.json })
    },
    'course/cards': payload => lessons.flashcards({ courseId: need(payload, 'courseId', 'crs'), force: payload.force === true }),
    'course/card-review': payload => {
      if (!GRADES.includes(payload.grade)) throw new TutorError('invalid', 'Invalid grade')
      return lessons.reviewCard({ courseId: need(payload, 'courseId', 'crs'), cardId: String(payload.cardId ?? '').slice(0, 12), grade: payload.grade })
    },

    'lesson/get': payload => lessons.get({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les') }),
    'lesson/prepare': payload => lessons.prepare({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), force: payload.force === true, style: payload.style }),
    'lesson/ask': payload => ({ job: lessons.ask({ scope: scopeOf(payload), stepIndex: payload.stepIndex, question: payload.question }) }),
    'lesson/reexplain': payload => ({ job: lessons.reexplain({ scope: scopeOf(payload), stepIndex: payload.stepIndex, style: STYLES.includes(payload.style) ? payload.style : 'example' }) }),
    'lesson/record': payload => lessons.record({
      courseId: need(payload, 'courseId', 'crs'),
      lessonId: optional(payload, 'lessonId', 'les'),
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
    'lesson/position': payload => lessons.savePosition({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), stepIndex: payload.stepIndex }),
    'lesson/complete': payload => lessons.complete({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les'), selfRating: Number(payload.selfRating) || undefined }),
    'lesson/practice': payload => lessons.practice({ courseId: need(payload, 'courseId', 'crs'), lessonId: need(payload, 'lessonId', 'les') }),
    'unit/sheet': payload => lessons.unitSheet({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), force: payload.force === true }),
    'unit/sheet-layout': payload => lessons.saveSheetLayout({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), layout: payload.layout }),
    'unit/quiz': payload => lessons.unitQuiz({ courseId: need(payload, 'courseId', 'crs'), unitId: need(payload, 'unitId', 'unt'), force: payload.force === true }),

    'profile/get': () => learner.getProfile(),
    'profile/save': payload => learner.saveProfile({ background: payload.background, goals: payload.goals, strengths: payload.strengths, weaknesses: payload.weaknesses, preferences: payload.preferences, notes: payload.notes }),
    'profile/clear': () => learner.clearProfile(),
    'profile/remove-note': payload => learner.removeNote({ id: need(payload, 'id', 'nte') }),
    'plan/get': payload => learner.plan({ today: payload.today }),
    'plan/settings': payload => learner.savePlanSettings({ weeklyMinutes: payload.weeklyMinutes, studyDays: payload.studyDays }),
    'plan/add-exam': payload => learner.addExam({ title: payload.title, day: payload.day, courseId: payload.courseId }),
    'plan/remove-exam': payload => learner.removeExam({ id: need(payload, 'id', 'exm') }),
    'review/session': () => learner.reviewSession(),

    'material/upload': payload => ({ job: studio.upload({ name: payload.name, base64: payload.base64 }) }),
    'material/url': payload => ({ job: studio.addUrl({ url: payload.url }) }),
    'material/list': () => studio.listMaterials(),
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
      return failure(known ? error.code ?? 'failed' : 'failed', known ? error.message : publicMessage(error))
    }
  }
}

function failure(code, message) {
  return { ok: false, error: { code: `aha-tutor/${code}`, message, details: {} } }
}
