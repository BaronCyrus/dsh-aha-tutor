// "Something wrong with this question?" on practice, quiz and review
// questions: where a question is kept (for the host to fix it there), what
// a fixed one first said, and how a check's outcome changes the round.
// Framework-free so it can be tested without a browser.

import { itemSig } from '../core/mistakes.js'

// The i18n key of each verdict a check of a question can reach.
export const ITEM_VERDICT_KEYS = Object.freeze({ wrong: 'itemCheck_wrong', unclear: 'itemCheck_unclear', misgraded: 'itemCheck_misgraded', right: 'itemCheck_right' })

// Where the practice screen's question is kept: a review question names
// its own place; otherwise the deck, unit quiz, set on a concept or lesson
// the screen shows. Null when the host keeps it nowhere it could fix.
export function itemSource({ courseId, lessonId, unitId, deckId, conceptId } = {}, item) {
  if (!item?.id) return null
  if (item.context) return item.context.source ?? null
  if (deckId) return { kind: 'deck', deckId, itemId: item.id }
  if (courseId && unitId) return { kind: 'quiz', courseId, unitId, itemId: item.id }
  if (courseId && conceptId) return { kind: 'drill', courseId, conceptId, itemId: item.id }
  if (courseId && lessonId) return { kind: 'practice', courseId, lessonId, itemId: item.id }
  return null
}

const clip = (value, max = 160) => {
  const chars = [...String(value ?? '').replace(/\s+/gu, ' ').trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

// An answer key in words: the option(s) it names, a number with its unit,
// accepted spellings, or the model answer.
export function answerText(item, answer = item?.answer) {
  const option = id => {
    const found = item.options?.find(entry => entry.id === id)
    return found ? `${id.toUpperCase()}. ${found.text}` : String(id ?? '').toUpperCase()
  }
  if (item.kind === 'choice') return option(answer)
  if (item.kind === 'multi') return (Array.isArray(answer) ? answer : []).map(id => String(id).toUpperCase()).join(', ')
  if (item.kind === 'order') return (Array.isArray(answer) ? answer : []).map(id => item.options?.find(entry => entry.id === id)?.text ?? id).join(' → ')
  if (item.kind === 'number') return `${answer}${item.unit ? ` ${item.unit}` : ''}`
  if (item.kind === 'blank') return (Array.isArray(answer) ? answer : [answer]).join(' / ')
  return clip(answer)
}

// An answer in words, options with their text: the key, or the learner's
// answer (given: an option id, a list of them, or text, a number as typed).
export function spelledAnswer(item, answer = item?.answer, given = false) {
  const option = id => {
    const found = item.options?.find(entry => entry.id === id)
    return found ? `${String(id).toUpperCase()}. ${clip(found.text, 120)}` : String(id).toUpperCase()
  }
  const ids = (Array.isArray(answer) ? answer : [answer]).filter(id => id !== undefined && id !== null && id !== '')
  if (item.kind === 'choice' || item.kind === 'multi') return ids.map(option).join(' / ')
  if (item.kind === 'order') return ids.map(id => clip(item.options?.find(entry => entry.id === id)?.text ?? id, 80)).join(' → ')
  const value = ids.map(entry => String(entry).trim()).filter(Boolean).join(' / ')
  if (!value) return ''
  if (item.kind === 'number') return given || !item.unit ? clip(value, 60) : `${value} ${item.unit}`
  return clip(value, item.kind === 'blank' ? 160 : 300)
}

const OPEN_KINDS = ['short', 'work']

// What the learner sends the chat teacher when a quiz card is done: how
// many were right, then each question with their answer, the key when they
// missed it and the grading of an open answer, so the teacher can correct
// each mistake. results: the answers, each with the index of its question;
// a question without one was skipped.
export function quizReport(t, { topic = '', items = [], results = [] } = {}) {
  const byIndex = new Map(results.map(result => [result.index, result]))
  const correct = results.filter(result => result.correct).length
  // The topic is the teacher's own wording of the quiz, often a long brief.
  const lines = [`${topic ? `${clip(topic, 40)} ` : ''}${t('practiceDone', { correct, total: items.length })}`]
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${clip(item.prompt, 120)}`)
    const result = byIndex.get(index)
    if (!result) {
      lines.push(`   ${t('quizReportSkipped')}`)
      return
    }
    const mark = result.correct ? '✔' : result.partial ? '◐' : '✘'
    lines.push(`   ${mark} ${t('quizReportGiven', { answer: spelledAnswer(item, result.given ?? result.response, true) || '—' })}`)
    const key = result.correct ? '' : spelledAnswer(item)
    if (key) lines.push(`   ${t(OPEN_KINDS.includes(item.kind) ? 'quizReportModel' : 'quizReportKey', { answer: key })}`)
    if (result.feedback) lines.push(`   ${t('quizReportFeedback', { text: clip(result.feedback, 240) })}`)
  })
  return lines.join('\n')
}

// What a fixed question first said, a line for each part that changed,
// for the 「✎ 已更正」 badge.
export function fixedLines(t, item) {
  const was = item?.fixed?.was
  if (!was) return []
  const lines = []
  if (was.prompt !== undefined) lines.push(t('fixedPart_prompt', { text: clip(was.prompt) || '—' }))
  for (const [id, textValue] of Object.entries(was.options ?? {})) lines.push(t('fixedPart_option', { id: id.toUpperCase(), text: clip(textValue, 80) }))
  if (was.answer !== undefined) {
    // The old key read with the options as they were.
    const options = item.options?.map(option => ({ ...option, text: was.options?.[option.id] ?? option.text }))
    lines.push(t('fixedPart_answer', { text: was.answer === null ? '—' : answerText({ ...item, options, unit: was.unit ?? item.unit }, was.answer) }))
  }
  if (was.unit !== undefined && was.answer === undefined) lines.push(t('fixedPart_unit', { text: was.unit || '—' }))
  if (was.tolerance !== undefined) lines.push(t('fixedPart_tolerance', { text: was.tolerance ?? '—' }))
  if (was.explanation !== undefined) lines.push(t('fixedPart_explanation', { text: clip(was.explanation) || '—' }))
  if (was.hints !== undefined) lines.push(t('fixedPart_hints', { text: clip((was.hints ?? []).join(' / ')) || '—' }))
  if (was.rubric !== undefined) lines.push(t('fixedPart_rubric', { text: clip((was.rubric ?? []).join(' / ')) || '—' }))
  if (was.figure) lines.push(t('fixedPart_figure'))
  return lines
}

// What 「讲这题」 needs about a graded question (see ExplainLayer): where it
// is kept and which version was answered, with the answer and the grade
// shown (request), and the course its board's closing question counts
// toward (record: null outside a course). Null when the host keeps the
// question nowhere it could read it.
export function explainRequest(place, item, result, { lessonId } = {}) {
  const source = itemSource(place, item)
  if (!source || !result) return null
  const courseId = source.courseId ?? null
  return {
    request: { source, response: result.given ?? result.response ?? '', shown: shownGrade(result), sig: itemSig(item) },
    record: courseId ? { courseId, lessonId: item.context?.lessonId ?? source.lessonId ?? lessonId ?? null, conceptIds: item.conceptIds ?? [] } : null,
  }
}

// The grade a learner saw, as the host needs it to check a question again.
export function shownGrade(result) {
  return {
    score: Number(result?.score) || 0,
    correct: result?.correct === true,
    partial: result?.partial === true,
    feedback: result?.feedback ?? '',
    wrongStep: result?.wrongStep ?? '',
    fix: result?.fix ?? '',
  }
}

// A question's check once the host answers. It keeps what earlier checks of
// the same question found: the fixed question and the grade, unless this
// one changed them. result: the answer as last graded. earlier: how many
// earlier answers to the question were graded again.
export function checkDone(previous, value, result) {
  return {
    status: 'done',
    note: previous?.note ?? '',
    verdict: value?.verdict ?? 'right',
    summary: value?.summary ?? '',
    explanation: value?.explanation ?? '',
    item: value?.item ?? previous?.item ?? null,
    result: value?.result ? { ...result, ...value.result, regraded: true } : previous?.result ?? null,
    earlier: (previous?.earlier ?? 0) + (Number(value?.earlier) || 0),
  }
}

// The round's results with one answer graded again (results are listed in
// the order answered, each with the index of its question).
export function regradeResults(results, index, regraded) {
  return results.map(entry => (entry.index === index ? { ...entry, ...regraded, index, regraded: true } : entry))
}

// The line at the top of the page when a question the learner has left
// behind is checked: what the teacher found, or that the check failed.
export function checkNotice(t, { index, verdict, regraded = false, earlier = 0, message }) {
  if (message !== undefined) return t('itemCheckFailedNotice', { n: index + 1, message })
  const found = t('itemCheckDone', { n: index + 1, verdict: t(ITEM_VERDICT_KEYS[verdict] ?? ITEM_VERDICT_KEYS.right) })
  return `${found}${regraded ? t('itemCheckRegraded') : ''}${earlier ? t('itemCheckEarlier', { count: earlier }) : ''}`
}
