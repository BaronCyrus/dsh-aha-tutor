// The mistake book of a course: each of its questions the learner did not
// get fully right (wrong, or only partly right), kept with a copy of the
// question as it was answered and the answers given to it since. A mistake
// is due again from the day after its last wrong answer, and resolved by a
// right answer on a later day than that one; a wrong answer after that
// opens it again. Days are the learner's own calendar days. Pure functions
// over plain data, so the browser reads a book by the same rules.

import { cleanResponse, earlierGrade, responseText } from './item-fix.js'
import { addDays, parseDay, toDay } from './planner.js'

// Mistakes kept per course: every open one first, then the latest resolved.
export const MISTAKES_KEPT = 200
// Answers kept per mistake (its last wrong answer always stays).
export const ATTEMPTS_KEPT = 12
// Due mistakes in one round of redoing them.
export const MISTAKE_ROUND = 10

const time = value => Date.parse(value)
const round2 = value => Math.round(value * 100) / 100

// Whether an answer was right, as the learner was told (correct), else by
// its score.
export function answeredRight(grade) {
  if (typeof grade?.correct === 'boolean') return grade.correct
  return Number(grade?.score) >= 0.8
}

// A short fingerprint of what a question asks and accepts. A question
// written anew in the same place (a board written again) gets another one,
// so its answers are not taken for answers to the question the learner got
// wrong there.
export function itemSig(item) {
  const content = JSON.stringify([
    item?.kind ?? '',
    item?.prompt ?? '',
    (Array.isArray(item?.options) ? item.options : []).map(option => option?.text ?? ''),
    item?.answer ?? null,
    item?.tolerance ?? null,
    item?.unit ?? null,
  ])
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

// An answer as a mistake keeps it.
function attemptOf(answer) {
  return {
    id: typeof answer.id === 'string' && answer.id ? answer.id : null,
    at: answer.at,
    score: round2(Math.min(1, Math.max(0, Number(answer.score) || 0))),
    correct: answeredRight(answer),
    response: answer.response ?? '',
  }
}

// A mistake as the book shows it, worked out from its answers: how often it
// went wrong, the last wrong answer, the moment it is due again, and when a
// right answer on a later day resolved it (null while it is open). Null
// once no answer to it is wrong any more (all of them graded again).
export function mistakeState(entry) {
  const attempts = Array.isArray(entry?.attempts) ? entry.attempts : []
  const last = attempts.findLastIndex(attempt => !attempt.correct)
  if (last < 0) return null
  const wrong = attempts[last]
  const day = toDay(new Date(wrong.at))
  const resolving = attempts.slice(last + 1).find(attempt => attempt.correct && toDay(new Date(attempt.at)) > day)
  return {
    wrong: (Number(entry.wrongBefore) || 0) + attempts.filter(attempt => !attempt.correct).length,
    lastWrongAt: wrong.at,
    response: wrong.response,
    score: wrong.score,
    dueAt: parseDay(addDays(day, 1)).toISOString(),
    resolvedAt: resolving?.at ?? null,
  }
}

// The open mistakes due again by now: the longest due first, then the one
// that went wrong first.
export function dueMistakes(entries, now = Date.now()) {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, state: mistakeState(entry) }))
    .filter(({ state }) => state && !state.resolvedAt && time(state.dueAt) <= now)
    .sort((a, b) => time(a.state.dueAt) - time(b.state.dueAt) || time(a.state.lastWrongAt) - time(b.state.lastWrongAt))
    .map(({ entry }) => entry)
}

// A mistake with its answers in time order and at most ATTEMPTS_KEPT of
// them: the oldest go first (counted in wrongBefore when wrong), never the
// last wrong one.
function settle(entry, attempts) {
  const list = [...attempts].sort((a, b) => time(a.at) - time(b.at))
  let wrongBefore = Number(entry.wrongBefore) || 0
  while (list.length > ATTEMPTS_KEPT) {
    const drop = list.findLastIndex(attempt => !attempt.correct) === 0 ? 1 : 0
    if (!list[drop].correct) wrongBefore += 1
    list.splice(drop, 1)
  }
  const firstWrong = list.find(attempt => !attempt.correct)?.at ?? null
  const firstAt = entry.firstAt && (!firstWrong || time(entry.firstAt) <= time(firstWrong)) ? entry.firstAt : firstWrong
  return { ...entry, firstAt, wrongBefore, attempts: list }
}

// The book within MISTAKES_KEPT, without the mistakes none of whose answers
// is wrong any more. In its own order.
function kept(book) {
  const live = book.map(entry => ({ entry, state: mistakeState(entry) })).filter(({ state }) => state)
  if (live.length <= MISTAKES_KEPT) return live.map(({ entry }) => entry)
  const rank = ({ state }) => (state.resolvedAt ? [1, -time(state.resolvedAt)] : [0, -time(state.lastWrongAt)])
  const ranked = [...live].sort((a, b) => {
    const [groupA, ageA] = rank(a)
    const [groupB, ageB] = rank(b)
    return groupA - groupB || ageA - ageB
  })
  const keep = new Set(ranked.slice(0, MISTAKES_KEPT).map(({ entry }) => entry))
  return live.map(({ entry }) => entry).filter(entry => keep.has(entry))
}

// An answer to a question its course keeps: { key (see itemKey), sig (see
// itemSig), source, lessonId, unitId, conceptIds, id (its evidence id), at,
// score, correct, response }. A wrong one makes the question a mistake
// (item: the question as answered, needed only then). Every answer to a
// mistake is kept with it, but a right one once it is resolved. Returns
// the book, or null when the answer changes nothing in it.
export function noteAnswer(entries, answer, item = null) {
  const book = Array.isArray(entries) ? entries : []
  const attempt = attemptOf(answer)
  const index = book.findIndex(entry => entry.key === answer.key && entry.sig === answer.sig)
  if (index < 0) {
    if (attempt.correct || !item) return null
    return kept([...book, settle({ key: answer.key, sig: answer.sig, source: answer.source ?? null, lessonId: answer.lessonId ?? null, unitId: answer.unitId ?? null, conceptIds: answer.conceptIds ?? [], item, firstAt: null, wrongBefore: 0 }, [attempt])])
  }
  const entry = book[index]
  if (attempt.id && entry.attempts.some(existing => existing.id === attempt.id)) return null
  if (attempt.correct && mistakeState(entry)?.resolvedAt) return null
  const next = settle({ ...entry, ...(answer.conceptIds?.length ? { conceptIds: answer.conceptIds } : {}) }, [...entry.attempts, attempt])
  return kept(book.map((existing, position) => (position === index ? next : existing)))
}

// A question a check fixed (before → item; fixed: whether the check
// changed it at all), or answers to it the check graded again. Its
// mistakes take the fixed question, and their answers are graded again: by
// answers ([{ id, at, response, score, correct }], new grades by evidence
// id: the challenged answer, and earlier ones a grader looked at again),
// else, when the question changed, by its key. An answer graded again into
// a wrong one makes the question a mistake if it was none (place: its
// source, lessonId, unitId and conceptIds). Returns the book, or null when
// nothing in it changes.
export function fixMistakes(entries, { key, before, item, fixed = true, verdict = 'wrong', answers = [], place = {} }) {
  const book = Array.isArray(entries) ? entries : []
  const was = itemSig(before)
  const sig = itemSig(item)
  const graded = new Map(answers.filter(answer => answer.id).map(answer => [answer.id, answer]))
  let found = false
  const next = book.map(entry => {
    if (entry.key !== key || (entry.sig !== was && entry.sig !== sig)) return entry
    found = true
    const attempts = entry.attempts.map(attempt => {
      const given = attempt.id ? graded.get(attempt.id) : null
      if (given) {
        const regraded = attemptOf({ ...given, id: attempt.id, at: attempt.at, response: attempt.response })
        return { ...attempt, score: regraded.score, correct: regraded.correct }
      }
      const again = fixed ? earlierGrade(item, attempt.response, { verdict, score: attempt.score }) : null
      return again ? { ...attempt, score: round2(again.score), correct: again.correct } : attempt
    })
    const held = new Set(attempts.map(attempt => attempt.id).filter(Boolean))
    const added = answers.filter(answer => answer.id && !held.has(answer.id) && !answeredRight(answer)).map(attemptOf)
    return settle({ ...entry, sig, item: fixed ? item : entry.item }, [...attempts, ...added])
  })
  if (!found) {
    const wrong = answers.filter(answer => !answeredRight(answer)).map(attemptOf)
    if (!wrong.length) return null
    next.push(settle({ key, sig, source: place.source ?? null, lessonId: place.lessonId ?? null, unitId: place.unitId ?? null, conceptIds: place.conceptIds ?? item?.conceptIds ?? [], item, firstAt: null, wrongBefore: 0 }, wrong))
  }
  const result = kept(next)
  return JSON.stringify(result) === JSON.stringify(book) ? null : result
}

const clip = (value, max) => {
  const chars = [...String(value ?? '').replace(/\s+/gu, ' ').trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

// The book as the course page lists it: each mistake with its state, the
// question it asks (its figure left out) and the last wrong answer in
// words. Open ones first, in the order rounds take them; then the resolved
// ones, the latest first.
export function listMistakes(entries) {
  const rows = (Array.isArray(entries) ? entries : []).map(entry => {
    const state = mistakeState(entry)
    if (!state) return null
    const item = entry.item ?? {}
    return {
      key: entry.key,
      sig: entry.sig,
      source: entry.source ?? null,
      lessonId: entry.lessonId ?? null,
      unitId: entry.unitId ?? null,
      kind: item.kind ?? '',
      prompt: item.prompt ?? '',
      figure: Boolean(item.svg || item.plot),
      answer: clip(responseText(item, cleanResponse(item, state.response)), 120),
      wrong: state.wrong,
      lastWrongAt: state.lastWrongAt,
      dueAt: state.dueAt,
      resolvedAt: state.resolvedAt,
    }
  }).filter(Boolean)
  const open = rows.filter(row => !row.resolvedAt).sort((a, b) => time(a.dueAt) - time(b.dueAt) || time(a.lastWrongAt) - time(b.lastWrongAt))
  const resolved = rows.filter(row => row.resolvedAt).sort((a, b) => time(b.resolvedAt) - time(a.resolvedAt))
  return [...open, ...resolved]
}
