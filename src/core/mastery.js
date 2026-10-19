// Concept mastery tracking: Bayesian Knowledge Tracing whose slip/guess
// parameters are adjusted by how the learner answered (confidence, hints,
// hesitation), so a lucky guess counts for little and a confident mistake
// is flagged as a likely misconception.

export const BKT_DEFAULTS = Object.freeze({
  pInit: 0.2,
  pTransit: 0.15,
  pSlip: 0.1,
  pGuess: 0.2,
})

export const MASTERY_LEVELS = Object.freeze([
  { id: 'struggling', min: 0 },
  { id: 'learning', min: 0.4 },
  { id: 'proficient', min: 0.7 },
  { id: 'mastered', min: 0.9 },
])

const CONFIDENCE = new Set(['sure', 'unsure', 'guess'])
const EVIDENCE_KINDS = new Set(['check', 'practice', 'quiz', 'project', 'flashcard', 'reexplain', 'self'])
const HISTORY_LIMIT = 50
const MISCONCEPTION_LIMIT = 10

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round4 = (value) => Math.round(value * 10000) / 10000

export function createConceptState(id, name = '', params = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('concept id must be a non-empty string')
  const pInit = clamp(Number(params.pInit ?? BKT_DEFAULTS.pInit), 0.01, 0.99)
  return {
    id,
    name: String(name || id),
    pKnown: pInit,
    attempts: 0,
    correct: 0,
    streak: 0,
    fragile: 0,
    reexplains: 0,
    lastSeenAt: null,
    misconceptions: [],
    history: [],
  }
}

// Evidence shape:
//   kind:       one of EVIDENCE_KINDS (default 'practice')
//   score:      0..1 (partial credit allowed); required except for 'reexplain'
//   confidence: 'sure' | 'unsure' | 'guess' (optional)
//   hintsUsed:  number of hints shown before answering
//   timeMs / expectedMs: answer time vs. expected time, for hesitation
//   errorTag:   short label of the mistake type, recorded for confident errors
//   rating:     1..5 self-rating, only for kind 'self'
export function applyEvidence(state, evidence, now = Date.now()) {
  const kind = EVIDENCE_KINDS.has(evidence?.kind) ? evidence.kind : 'practice'
  const next = {
    ...state,
    misconceptions: [...state.misconceptions],
    history: [...state.history],
    lastSeenAt: new Date(now).toISOString(),
  }

  if (kind === 'reexplain') {
    // Asking for another explanation is weak negative evidence and no learning step.
    next.reexplains += 1
    next.pKnown = round4(clamp(next.pKnown * 0.9, 0.01, 0.99))
    pushHistory(next, { kind, at: next.lastSeenAt, pKnown: next.pKnown })
    return next
  }

  if (kind === 'self') {
    const rating = clamp(Math.round(Number(evidence.rating) || 3), 1, 5)
    const target = (rating - 1) / 4
    next.pKnown = round4(clamp(next.pKnown * 0.8 + target * 0.2, 0.01, 0.99))
    pushHistory(next, { kind, rating, at: next.lastSeenAt, pKnown: next.pKnown })
    return next
  }

  const score = clamp(Number(evidence.score), 0, 1)
  if (!Number.isFinite(score)) throw new TypeError('evidence.score must be a number between 0 and 1')
  const confidence = CONFIDENCE.has(evidence.confidence) ? evidence.confidence : null
  const { pSlip, pGuess } = adjustedParams(evidence, confidence)
  const prior = next.pKnown

  // Partial credit: mix the posteriors for a correct and an incorrect observation.
  const pCorrect = prior * (1 - pSlip) + (1 - prior) * pGuess
  const posteriorIfCorrect = (prior * (1 - pSlip)) / pCorrect
  const posteriorIfWrong = (prior * pSlip) / (1 - pCorrect)
  const posterior = score * posteriorIfCorrect + (1 - score) * posteriorIfWrong
  const pTransit = kind === 'quiz' ? BKT_DEFAULTS.pTransit / 2 : BKT_DEFAULTS.pTransit
  next.pKnown = round4(clamp(posterior + (1 - posterior) * pTransit, 0.01, 0.99))

  next.attempts += 1
  const isCorrect = score >= 0.6
  if (isCorrect) {
    next.correct += 1
    next.streak += 1
    if (confidence === 'unsure' || confidence === 'guess') next.fragile += 1
  } else {
    next.streak = 0
    if (confidence === 'sure') {
      const tag = String(evidence.errorTag || 'confident-error').slice(0, 80)
      next.misconceptions = [tag, ...next.misconceptions.filter((item) => item !== tag)].slice(0, MISCONCEPTION_LIMIT)
    }
  }

  pushHistory(next, {
    kind,
    score: round4(score),
    confidence,
    at: next.lastSeenAt,
    pKnown: next.pKnown,
  })
  return next
}

function adjustedParams(evidence, confidence) {
  let pSlip = BKT_DEFAULTS.pSlip
  let pGuess = BKT_DEFAULTS.pGuess
  if (confidence === 'guess') pGuess = 0.5
  else if (confidence === 'unsure') pGuess = 0.32
  else if (confidence === 'sure') pSlip = 0.05

  const hints = clamp(Math.floor(Number(evidence.hintsUsed) || 0), 0, 5)
  pGuess += hints * 0.08

  const timeMs = Number(evidence.timeMs)
  const expectedMs = Number(evidence.expectedMs)
  if (timeMs > 0 && expectedMs > 0 && timeMs > expectedMs * 2) pGuess += 0.08

  return { pSlip: clamp(pSlip, 0.01, 0.4), pGuess: clamp(pGuess, 0.05, 0.65) }
}

function pushHistory(state, entry) {
  state.history.push(entry)
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT)
}

export function masteryPercent(state) {
  return Math.round(clamp(Number(state?.pKnown) || 0, 0, 1) * 100)
}

// Five stages for display: "none" until there is any evidence at all, then
// by the mastery thresholds above.
export const MASTERY_STAGES = Object.freeze(['none', 'weak', 'learning', 'proficient', 'mastered'])

export function masteryStage(state) {
  if (!state || (!state.attempts && !state.history?.length)) return 'none'
  return stageForPercent(masteryPercent(state))
}

export function stageForPercent(percent) {
  const value = Number(percent)
  if (!Number.isFinite(value)) return 'none'
  return value >= 90 ? 'mastered' : value >= 70 ? 'proficient' : value >= 40 ? 'learning' : 'weak'
}

export function masteryLevel(state) {
  const p = clamp(Number(state?.pKnown) || 0, 0, 1)
  let level = MASTERY_LEVELS[0].id
  for (const item of MASTERY_LEVELS) if (p >= item.min) level = item.id
  return level
}

// Decide what the tutor should do after a lesson or practice round.
//   remediate: a misconception or very low mastery needs a different explanation
//   review:    knowledge is there but fragile, revisit with fresh practice
//   challenge: everything is solid and fast, go deeper or skip ahead
//   advance:   continue with the next lesson
export function recommendNext(states, { passThreshold = 0.7 } = {}) {
  const list = (states || []).filter(Boolean)
  if (!list.length) return { action: 'advance', conceptIds: [], reason: 'no-evidence' }

  const misconceived = list.filter((state) => state.misconceptions.length && state.pKnown < 0.9)
  if (misconceived.length) {
    return { action: 'remediate', conceptIds: misconceived.map((state) => state.id), reason: 'misconception' }
  }
  const weak = list.filter((state) => state.attempts > 0 && state.pKnown < 0.4)
  if (weak.length) return { action: 'remediate', conceptIds: weak.map((state) => state.id), reason: 'low-mastery' }

  const shaky = list.filter((state) => state.pKnown < passThreshold || state.fragile > state.correct / 2)
  if (shaky.length) return { action: 'review', conceptIds: shaky.map((state) => state.id), reason: 'fragile' }

  const allMastered = list.every((state) => state.pKnown >= 0.9 && state.reexplains === 0)
  if (allMastered) return { action: 'challenge', conceptIds: list.map((state) => state.id), reason: 'mastered' }
  return { action: 'advance', conceptIds: [], reason: 'on-track' }
}

// Compact projection for prompts: tells the model where the learner stands
// without leaking the whole event history.
export function summarizeForPrompt(states, limit = 12) {
  return (states || [])
    .filter(Boolean)
    .sort((a, b) => a.pKnown - b.pKnown)
    .slice(0, limit)
    .map((state) => ({
      concept: state.name,
      mastery: masteryPercent(state),
      level: masteryLevel(state),
      misconceptions: state.misconceptions.slice(0, 3),
      fragile: state.fragile > 0,
    }))
}
