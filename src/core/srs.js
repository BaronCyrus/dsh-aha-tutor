// Spaced repetition for flashcards and concept reviews (SM-2 with the usual
// four answer buttons). Dates are ISO strings so the state is plain JSON.
//
// Answers less than SITTING_MS after the one before belong to the same
// sitting, so an evening of lesson, practice and quiz is one sitting. Its
// first answer schedules the next review. A right answer after that is
// practice, not another spaced review: it leaves the schedule as it is, or a
// few right answers in a row would push the next review out by months. Only
// the first miss of a sitting is a lapse; a later miss brings the card back
// in ten minutes without lowering its ease again.

export const GRADES = Object.freeze(['again', 'hard', 'good', 'easy'])
const GRADE_QUALITY = Object.freeze({ again: 1, hard: 3, good: 4, easy: 5 })
const DAY_MS = 24 * 60 * 60 * 1000
const RELEARN_MS = 10 * 60 * 1000
const MIN_EASE = 1.3
const MAX_INTERVAL_DAYS = 365
export const SITTING_MS = 6 * 60 * 60 * 1000

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
  const at = new Date(now).toISOString()
  const last = Date.parse(card.lastReviewedAt ?? '')
  const sameSitting = Number.isFinite(last) && now - last < SITTING_MS
  // Already scheduled by a right answer of this sitting.
  if (sameSitting && grade !== 'again' && card.intervalDays >= 1) return { ...card, lastReviewedAt: at }
  // Missed before in this sitting: relearn again, no second lapse.
  if (sameSitting && grade === 'again' && card.missedInSitting) return { ...card, reps: 0, intervalDays: 0, dueAt: new Date(now + RELEARN_MS).toISOString(), lastReviewedAt: at }

  const quality = GRADE_QUALITY[grade]
  const next = { ...card, missedInSitting: sameSitting && Boolean(card.missedInSitting) }
  next.ease = Math.max(MIN_EASE, round2(card.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))

  if (grade === 'again') {
    next.reps = 0
    next.lapses = card.lapses + 1
    next.intervalDays = 0
    next.missedInSitting = true
    // Relearn in ten minutes rather than tomorrow.
    next.dueAt = new Date(now + RELEARN_MS).toISOString()
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
  next.lastReviewedAt = at
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

// A flashcard deck ({ cards, srs }) at a glance: its size, the cards seen
// before that are due again, and the cards not seen yet.
export function deckStatus(deck, now = Date.now()) {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const states = deck?.srs ?? {}
  const due = cards.filter(card => states[card.id] && isDue(states[card.id], now)).length
  return { total: cards.length, due, fresh: cards.filter(card => !states[card.id]).length }
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
