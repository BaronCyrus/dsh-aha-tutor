// The recent evidence behind each concept's mastery, kept so that an answer
// graded wrongly can be graded again exactly: the concept and its review
// card go back to how they were before that answer, take it with its new
// score, then take every later answer again, in order and at its own time.

import { applyEvidence, createConceptState } from './mastery.js'
import { createCard, gradeFromScore, review } from './srs.js'

export const EVIDENCE_KEPT = 50

const scored = evidence => evidence?.kind !== 'reexplain' && evidence?.kind !== 'self' && Number.isFinite(Number(evidence?.score))
// A concept's state without its history (the history is rebuilt on replay).
const withoutHistory = ({ history, ...state }) => state

// One piece of evidence applied to a concept and its review card (an
// answer with a score also schedules the concept's next review).
export function takeEvidence(state, card, evidence, at) {
  const next = applyEvidence(state, evidence, at)
  if (!scored(evidence)) return { state: next, card }
  return { state: next, card: review(card ?? createCard(state.id, at), gradeFromScore(Number(evidence.score), evidence.confidence), at) }
}

// What a concept was before a piece of evidence (null: not seen yet).
export function stateBefore(state, card) {
  return { state: state ? withoutHistory(state) : null, card: card ?? null }
}

// entry: { id, at (ISO), lessonId, conceptIds, evidence, before: { [conceptId]: stateBefore } }
export function logEvidence(progress, entry) {
  progress.evidenceLog = [...(Array.isArray(progress.evidenceLog) ? progress.evidenceLog : []), entry].slice(-EVIDENCE_KEPT)
}

// Grade a logged answer again. patch changes its evidence (a new score, and
// no error tag once it is right). Every piece of evidence adds one line to a
// concept's history, so the lines from that answer on are the last ones and
// are written again. known(conceptId) gives a concept's name, or null for
// one the course no longer has. Returns the concepts it changed, or null
// when the answer is no longer in the log or has no score.
export function correctEvidence(progress, id, patch, { known = conceptId => conceptId, at = new Date().toISOString() } = {}) {
  const log = Array.isArray(progress.evidenceLog) ? progress.evidenceLog : []
  const index = log.findIndex(entry => entry.id === id)
  if (index < 0) return null
  const entry = log[index]
  const evidence = { ...entry.evidence, ...patch }
  if (!scored(entry.evidence) || !scored(evidence)) return null
  const later = log.slice(index + 1)
  progress.concepts ??= {}
  progress.reviews ??= {}
  const changed = []
  for (const conceptId of entry.conceptIds ?? []) {
    const name = known(conceptId)
    if (name === null || name === undefined) continue
    const after = later.filter(item => item.conceptIds?.includes(conceptId))
    const history = progress.concepts[conceptId]?.history ?? []
    const base = entry.before?.[conceptId]
    let state = { ...(base?.state ?? createConceptState(conceptId, name)), history: history.slice(0, Math.max(0, history.length - 1 - after.length)) }
    let card = base?.card ?? null
    ;({ state, card } = takeEvidence(state, card, evidence, Date.parse(entry.at)))
    for (const item of after) {
      item.before = { ...item.before, [conceptId]: stateBefore(state, card) }
      ;({ state, card } = takeEvidence(state, card, item.evidence, Date.parse(item.at)))
    }
    progress.concepts[conceptId] = state
    if (card) progress.reviews[conceptId] = card
    changed.push(conceptId)
  }
  entry.corrected = { score: entry.corrected?.score ?? entry.evidence.score, at }
  entry.evidence = evidence
  return { conceptIds: changed }
}
