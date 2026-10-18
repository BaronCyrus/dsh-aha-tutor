// Spaced repetition for flashcards and concept reviews (SM-2 with the usual
// four answer buttons). Dates are ISO strings so the state is plain JSON.

export const GRADES = Object.freeze(['again', 'hard', 'good', 'easy'])
const GRADE_QUALITY = Object.freeze({ again: 1, hard: 3, good: 4, easy: 5 })
const DAY_MS = 24 * 60 * 60 * 1000
const MIN_EASE = 1.3
const MAX_INTERVAL_DAYS = 365

export function createCard(id, now = Date.now()) {
  return {
    id,
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: new Date(now).toISOString(),
    lastReviewedAt: null,
  }
}

export function review(card, grade, now = Date.now()) {
  if (!GRADES.includes(grade)) throw new TypeError(`grade must be one of ${GRADES.join(', ')}`)
  const quality = GRADE_QUALITY[grade]
  const next = { ...card }
  next.ease = Math.max(MIN_EASE, round2(card.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))

  if (grade === 'again') {
    next.reps = 0
    next.lapses = card.lapses + 1
    next.intervalDays = 0
    // Relearn in ten minutes rather than tomorrow.
    next.dueAt = new Date(now + 10 * 60 * 1000).toISOString()
  } else {
    next.reps = card.reps + 1
    let interval
    if (next.reps === 1) interval = grade === 'easy' ? 3 : 1
    else if (next.reps === 2) interval = grade === 'hard' ? 3 : 6
    else interval = Math.round(card.intervalDays * next.ease)
    if (grade === 'hard') interval = Math.max(1, Math.round(interval * 0.8))
    if (grade === 'easy' && next.reps > 1) interval = Math.round(interval * 1.3)
    next.intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval))
    next.dueAt = new Date(now + next.intervalDays * DAY_MS).toISOString()
  }
  next.lastReviewedAt = new Date(now).toISOString()
  return next
}

export function isDue(card, now = Date.now()) {
  return Date.parse(card?.dueAt ?? 0) <= now
}

export function dueCards(cards, now = Date.now()) {
  return (cards || [])
    .filter(card => isDue(card, now))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
}

// Map a mastery check result onto a review grade, so concepts the learner
// struggled with come back sooner.
export function gradeFromScore(score, confidence) {
  if (score < 0.5) return 'again'
  if (score < 0.8 || confidence === 'guess') return 'hard'
  if (score >= 0.95 && confidence === 'sure') return 'easy'
  return 'good'
}

function round2(value) {
  return Math.round(value * 100) / 100
}
