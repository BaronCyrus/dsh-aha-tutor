import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyEvidence, createConceptState, masteryLevel, masteryPercent, masteryStage, recommendNext, stageForPercent, summarizeForPrompt } from '../src/core/mastery.js'
import { createCard, dueCards, gradeFromScore, review, SITTING_MS } from '../src/core/srs.js'
import { takeEvidence } from '../src/core/evidence-log.js'
import { gradeObjective, normalizeAnswerText } from '../src/core/grading.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

test('a confident correct answer raises mastery more than a lucky guess', () => {
  const base = createConceptState('cpt_a', 'limits')
  const sure = applyEvidence(base, { kind: 'check', score: 1, confidence: 'sure' })
  const guess = applyEvidence(base, { kind: 'check', score: 1, confidence: 'guess' })
  assert.ok(sure.pKnown > guess.pKnown)
  assert.ok(guess.pKnown > base.pKnown)
  assert.equal(guess.fragile, 1)
  assert.equal(sure.fragile, 0)
})

test('a confident mistake is recorded as a misconception and triggers remediation', () => {
  let state = createConceptState('cpt_b', 'chain rule')
  state = applyEvidence(state, { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'forgot inner derivative' })
  assert.deepEqual(state.misconceptions, ['forgot inner derivative'])
  assert.equal(recommendNext([state]).action, 'remediate')
  assert.equal(recommendNext([state]).reason, 'misconception')
})

test('two right answers in a row, the second not a guess, clear the misconceptions', () => {
  const wrong = state => applyEvidence(state, { kind: 'practice', score: 0, confidence: 'sure', errorTag: 'forgot inner derivative' })
  let state = wrong(createConceptState('cpt_b', 'chain rule'))
  state = applyEvidence(state, { kind: 'practice', score: 1, confidence: 'sure' })
  assert.deepEqual(state.misconceptions, ['forgot inner derivative'], 'one right answer may be luck')
  state = applyEvidence(state, { kind: 'quiz', score: 1, confidence: 'guess' })
  assert.deepEqual(state.misconceptions, ['forgot inner derivative'], 'a guess does not show it is overcome')
  state = applyEvidence(state, { kind: 'check', score: 0.8, confidence: 'unsure' })
  assert.deepEqual(state.misconceptions, [])
  assert.notEqual(recommendNext([state]).reason, 'misconception')
  // A mistake in between starts the count again.
  state = wrong(state)
  state = applyEvidence(state, { score: 1, confidence: 'sure' })
  state = applyEvidence(state, { score: 0.2 })
  state = applyEvidence(state, { score: 1, confidence: 'sure' })
  assert.deepEqual(state.misconceptions, ['forgot inner derivative'])
  state = applyEvidence(state, { score: 1 })
  assert.deepEqual(state.misconceptions, [])
})

test('hints and hesitation weaken the evidence of a correct answer', () => {
  const base = createConceptState('cpt_c', 'x')
  const clean = applyEvidence(base, { score: 1 })
  const hinted = applyEvidence(base, { score: 1, hintsUsed: 2, timeMs: 90_000, expectedMs: 20_000 })
  assert.ok(clean.pKnown > hinted.pKnown)
})

test('repeated success reaches mastered and recommends a challenge', () => {
  let state = createConceptState('cpt_d', 'y')
  for (let index = 0; index < 8; index += 1) state = applyEvidence(state, { score: 1, confidence: 'sure' })
  assert.equal(masteryLevel(state), 'mastered')
  assert.ok(masteryPercent(state) >= 90)
  assert.equal(recommendNext([state]).action, 'challenge')
})

test('asking for another explanation lowers mastery slightly and blocks challenge', () => {
  let state = createConceptState('cpt_e', 'z')
  for (let index = 0; index < 8; index += 1) state = applyEvidence(state, { score: 1, confidence: 'sure' })
  const after = applyEvidence(state, { kind: 'reexplain' })
  assert.ok(after.pKnown < state.pKnown)
  assert.notEqual(recommendNext([after]).action, 'challenge')
})

test('history is bounded and the prompt summary lists weakest concepts first', () => {
  let weak = createConceptState('cpt_f', 'weak')
  let strong = createConceptState('cpt_g', 'strong')
  for (let index = 0; index < 80; index += 1) weak = applyEvidence(weak, { score: 0.2 })
  for (let index = 0; index < 5; index += 1) strong = applyEvidence(strong, { score: 1, confidence: 'sure' })
  assert.equal(weak.history.length, 50)
  const summary = summarizeForPrompt([strong, weak])
  assert.equal(summary[0].concept, 'weak')
  assert.throws(() => applyEvidence(weak, { score: 'abc' }), /score/)
})

test('five display stages start at "none" until there is any evidence', () => {
  assert.equal(masteryStage(undefined), 'none')
  const fresh = createConceptState('cpt_a', '配方')
  assert.equal(masteryStage(fresh), 'none', 'an untouched concept is not shown as weak')
  const once = applyEvidence(fresh, { kind: 'practice', score: 1, confidence: 'sure' })
  assert.notEqual(masteryStage(once), 'none')
  assert.equal(masteryStage(applyEvidence(fresh, { kind: 'self', rating: 1 })), 'weak', 'a self rating counts as evidence')
  assert.deepEqual([10, 40, 70, 90].map(stageForPercent), ['weak', 'learning', 'proficient', 'mastered'])
})

test('SM-2 review intervals grow with good answers and reset on again', () => {
  const now = Date.parse('2026-10-18T08:00:00Z')
  let card = createCard('c1', now)
  card = review(card, 'good', now)
  assert.equal(card.intervalDays, 1)
  card = review(card, 'good', now + DAY)
  assert.equal(card.intervalDays, 6)
  card = review(card, 'good', now + 7 * DAY)
  assert.ok(card.intervalDays >= 14)
  const at = now + 10 * DAY
  const lapsed = review(card, 'again', at)
  assert.equal(lapsed.reps, 0)
  assert.equal(lapsed.lapses, 1)
  assert.equal(Date.parse(lapsed.dueAt) - at, 10 * MINUTE)
  assert.ok(lapsed.ease >= 1.3)
  assert.deepEqual(dueCards([card, lapsed], at + 11 * MINUTE).map(item => item.id), ['c1'])
  assert.throws(() => review(card, 'perfect', now), /grade/)
  assert.equal(gradeFromScore(0.2), 'again')
  assert.equal(gradeFromScore(1, 'sure'), 'easy')
  assert.equal(gradeFromScore(0.9, 'guess'), 'hard')
})

test('right answers in one sitting schedule the next review once', () => {
  const t0 = Date.parse('2026-10-18T08:00:00Z')
  let card = createCard('c1', t0)
  for (let index = 0; index < 7; index += 1) card = review(card, 'good', t0 + index * 5 * MINUTE)
  assert.equal(card.intervalDays, 1, 'seven right answers minutes apart are one review, not 365 days')
  assert.equal(card.reps, 1)
  assert.equal(card.dueAt, new Date(t0 + DAY).toISOString())
  // The sitting runs on while answers come less than six hours apart.
  card = review(card, 'easy', t0 + 5 * HOUR)
  assert.equal(card.intervalDays, 1)
  assert.equal(card.lastReviewedAt, new Date(t0 + 5 * HOUR).toISOString())
  // The next day is a new sitting and the next spaced review.
  card = review(card, 'good', t0 + 26 * HOUR)
  assert.equal(card.intervalDays, 6)
  assert.equal(SITTING_MS, 6 * HOUR)
})

test('only the first miss of a sitting is a lapse', () => {
  const t0 = Date.parse('2026-10-18T08:00:00Z')
  let card = review(createCard('c1', t0), 'again', t0)
  const ease = card.ease
  card = review(card, 'again', t0 + 2 * MINUTE)
  card = review(card, 'again', t0 + 4 * MINUTE)
  assert.equal(card.ease, ease, 'three misses in a row lower the ease once')
  assert.equal(card.lapses, 1)
  assert.equal(card.dueAt, new Date(t0 + 14 * MINUTE).toISOString())
  // Relearnt in the sitting: back tomorrow, and more right answers leave it there.
  card = review(card, 'good', t0 + 6 * MINUTE)
  assert.equal(card.intervalDays, 1)
  card = review(card, 'good', t0 + 8 * MINUTE)
  assert.equal(card.intervalDays, 1)
  // Missed again in the same sitting: relearn, still one lapse.
  card = review(card, 'again', t0 + 10 * MINUTE)
  assert.equal(card.lapses, 1)
  assert.equal(card.intervalDays, 0)
  // A miss in a later sitting is a lapse again.
  const later = review(review(card, 'good', t0 + 20 * MINUTE), 'again', t0 + DAY + HOUR)
  assert.equal(later.lapses, 2)
  assert.ok(later.ease < ease)
  // A miss right after a right answer of the sitting is that sitting's first miss.
  const fresh = review(review(createCard('c2', t0), 'good', t0), 'again', t0 + MINUTE)
  assert.equal(fresh.lapses, 1)
  assert.equal(fresh.intervalDays, 0)
})

test('practice answers minutes apart schedule a concept for tomorrow', () => {
  const t0 = Date.parse('2026-10-18T08:00:00Z')
  let state = createConceptState('cpt_a', 'x')
  let card = null
  for (let index = 0; index < 5; index += 1) ({ state, card } = takeEvidence(state, card, { kind: 'practice', score: 1, confidence: 'unsure' }, t0 + index * 3 * MINUTE))
  assert.equal(state.attempts, 5, 'every answer still counts toward mastery')
  assert.equal(card.intervalDays, 1)
  assert.equal(card.dueAt, new Date(t0 + DAY).toISOString())
})

test('objective grading handles choices, partial multi-select, numbers and blanks', () => {
  assert.equal(gradeObjective({ kind: 'choice', answer: 'b' }, 'b').correct, true)
  const multi = gradeObjective({ kind: 'multi', answer: ['a', 'c'] }, ['a', 'b'])
  assert.equal(multi.correct, false)
  assert.equal(multi.score, 0)
  assert.equal(gradeObjective({ kind: 'multi', answer: ['a', 'c'] }, ['a']).score, 0.5)
  assert.equal(gradeObjective({ kind: 'number', answer: 9.81, tolerance: 0.05 }, '9.8').correct, true)
  assert.equal(gradeObjective({ kind: 'number', answer: 0.5 }, '1/2').correct, true)
  assert.equal(gradeObjective({ kind: 'number', answer: 0.25 }, '25%').correct, true)
  assert.equal(gradeObjective({ kind: 'blank', answer: ['Photosynthesis', '光合作用'] }, ' 光合作用。').correct, true)
  assert.equal(gradeObjective({ kind: 'blank', answer: ['ＡＢＣ'] }, 'abc').correct, true)
  assert.equal(gradeObjective({ kind: 'order', answer: ['a', 'b', 'c'] }, ['a', 'c', 'b']).score, 0.33)
  assert.equal(gradeObjective({ kind: 'short', answer: 'x' }, 'x').gradable, false)
  assert.equal(normalizeAnswerText('  Hello，World！ '), 'hello,world')
})
