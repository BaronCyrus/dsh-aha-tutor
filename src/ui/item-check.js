// "Something wrong with this question?" on practice, quiz and review
// questions: where a question is kept (for the host to fix it there), what
// a fixed one first said, and how a check's outcome changes the round.
// Framework-free so it can be tested without a browser.

// The i18n key of each verdict a check of a question can reach.
export const ITEM_VERDICT_KEYS = Object.freeze({ wrong: 'itemCheck_wrong', unclear: 'itemCheck_unclear', misgraded: 'itemCheck_misgraded', right: 'itemCheck_right' })

// Where the practice screen's question is kept: a review question names
// its own place; otherwise the deck, unit quiz or lesson the screen shows.
// Null when the host keeps it nowhere it could fix.
export function itemSource({ courseId, lessonId, unitId, deckId } = {}, item) {
  if (!item?.id) return null
  if (item.context) return item.context.source ?? null
  if (deckId) return { kind: 'deck', deckId, itemId: item.id }
  if (courseId && unitId) return { kind: 'quiz', courseId, unitId, itemId: item.id }
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
// one changed them. result: the answer as last graded.
export function checkDone(previous, value, result) {
  return {
    status: 'done',
    note: previous?.note ?? '',
    verdict: value?.verdict ?? 'right',
    summary: value?.summary ?? '',
    explanation: value?.explanation ?? '',
    item: value?.item ?? previous?.item ?? null,
    result: value?.result ? { ...result, ...value.result, regraded: true } : previous?.result ?? null,
  }
}

// The round's results with one answer graded again (results are listed in
// the order answered, each with the index of its question).
export function regradeResults(results, index, regraded) {
  return results.map(entry => (entry.index === index ? { ...entry, ...regraded, index, regraded: true } : entry))
}

// The line at the top of the page when a question the learner has left
// behind is checked: what the teacher found, or that the check failed.
export function checkNotice(t, { index, verdict, regraded = false, message }) {
  if (message !== undefined) return t('itemCheckFailedNotice', { n: index + 1, message })
  const found = t('itemCheckDone', { n: index + 1, verdict: t(ITEM_VERDICT_KEYS[verdict] ?? ITEM_VERDICT_KEYS.right) })
  return regraded ? `${found}${t('itemCheckRegraded')}` : found
}
