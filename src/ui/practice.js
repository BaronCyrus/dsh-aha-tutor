// The numbers on a practice round's results card, the one next step the
// mastery model suggests, and what a course page recommends. Framework-free
// so it can be tested without a browser.

import { conceptIndex, nextLesson } from '../core/course-model.js'
import { masteryPercent, masteryStage, stageForPercent } from '../core/mastery.js'

// The i18n key of each mastery stage.
export const STAGE_LABELS = Object.freeze({ none: 'stageNone', weak: 'stageWeak', learning: 'stageLearning', proficient: 'stageProficient', mastered: 'stageMastered' })

// results: what each answered item reported ({ score, correct }).
export function sessionStats(results) {
  const answered = results.filter(Boolean)
  const accuracy = answered.length ? answered.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / answered.length : 0
  let run = 0
  let best = 0
  for (const result of answered) {
    run = result.correct ? run + 1 : 0
    best = Math.max(best, run)
  }
  return {
    answered: answered.length,
    correct: answered.filter(result => result.correct).length,
    accuracy,
    stars: accuracy >= 0.9 ? 3 : accuracy >= 0.6 ? 2 : 1,
    streak: run,
    bestStreak: best,
  }
}

// recommendation: from lesson/record ({ action: remediate | review |
// challenge | advance }). Returns { kind: 'relearn' | 'review' | 'quiz' |
// 'next' | 'course', lessonId?, unitId? }.
export function nextStepFor(recommendation, { lessonId, unitId, nextLessonId } = {}) {
  const action = recommendation?.action
  if (action === 'remediate') return lessonId ? { kind: 'relearn', lessonId } : { kind: 'review' }
  if (action === 'review') return { kind: 'review' }
  if (action === 'challenge' && unitId) return { kind: 'quiz', unitId }
  return nextLessonId ? { kind: 'next', lessonId: nextLessonId } : { kind: 'course' }
}

// A lesson's stage: "none" until any of its concepts has evidence, then the
// mean over its concepts (an untouched one at its starting estimate).
export function lessonStage(lesson, progress) {
  const states = (lesson.concepts ?? []).map(concept => progress?.concepts?.[concept.id])
  if (!states.some(state => masteryStage(state) !== 'none')) return { stage: 'none', percent: 0 }
  const percent = Math.round(states.reduce((sum, state) => sum + masteryPercent(state ?? { pKnown: 0.2 }), 0) / states.length)
  return { stage: stageForPercent(percent), percent }
}

// The one thing a course page suggests: reviews that are due, then the
// weakest concept, then the next lesson.
export function courseNextStep(course, progress, { now = Date.now() } = {}) {
  const concepts = conceptIndex(course)
  const due = Object.entries(progress?.reviews ?? {}).filter(([id, card]) => concepts.has(id) && Date.parse(card?.dueAt) <= now).length
  if (due) return { kind: 'review', count: due }
  const weakest = [...concepts.values()]
    .map(concept => ({ concept, state: progress?.concepts?.[concept.id] }))
    .filter(entry => masteryStage(entry.state) === 'weak')
    .sort((a, b) => a.state.pKnown - b.state.pKnown)[0]
  if (weakest) return { kind: 'practice', lessonId: weakest.concept.lessonId, concept: weakest.concept.name }
  const next = nextLesson(course, progress)
  if (next) return { kind: 'lesson', lessonId: next.lesson.id, title: next.lesson.title }
  return { kind: 'done', unitId: course.units?.at(-1)?.id ?? null }
}
