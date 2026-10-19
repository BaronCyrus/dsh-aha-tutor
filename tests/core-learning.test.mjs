import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyEvidence, createConceptState, masteryLevel, masteryPercent, masteryStage, recommendNext, stageForPercent, summarizeForPrompt } from '../src/core/mastery.js'
import { createCard, dueCards, gradeFromScore, review } from '../src/core/srs.js'
import { gradeObjective, normalizeAnswerText } from '../src/core/grading.js'

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
  card = review(card, 'good', now)
  assert.equal(card.intervalDays, 6)
  card = review(card, 'good', now)
  assert.ok(card.intervalDays >= 14)
  const lapsed = review(card, 'again', now)
  assert.equal(lapsed.reps, 0)
  assert.equal(lapsed.lapses, 1)
  assert.equal(Date.parse(lapsed.dueAt) - now, 10 * 60 * 1000)
  assert.ok(lapsed.ease >= 1.3)
  assert.deepEqual(dueCards([card, lapsed], now + 11 * 60 * 1000).map(item => item.id), ['c1'])
  assert.throws(() => review(card, 'perfect', now), /grade/)
  assert.equal(gradeFromScore(0.2), 'again')
  assert.equal(gradeFromScore(1, 'sure'), 'easy')
  assert.equal(gradeFromScore(0.9, 'guess'), 'hard')
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
