// Automatic grading for objective questions. Open answers ("short") are
// graded by the model on the host; everything here is deterministic.

export const OBJECTIVE_KINDS = Object.freeze(['choice', 'multi', 'blank', 'number', 'order'])

const FULLWIDTH = /[！-～]/gu

export function normalizeAnswerText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(FULLWIDTH, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　]+/gu, ' ')
    .replace(/^[\s.,;:!?'"`，。；：！？、“”‘’]+|[\s.,;:!?'"`，。；：！？、“”‘’]+$/gu, '')
    .trim()
}

function parseNumber(value) {
  if (typeof value === 'number') return value
  const text = normalizeAnswerText(value).replace(/,/gu, '').replace(/\s/gu, '')
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/u.exec(text)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])
  const percent = /^(-?\d+(?:\.\d+)?)%$/u.exec(text)
  if (percent) return Number(percent[1]) / 100
  const number = Number(text)
  return Number.isFinite(number) ? number : Number.NaN
}

// Returns { score: 0..1, correct: boolean, gradable: boolean }.
export function gradeObjective(item, response) {
  if (!item || !OBJECTIVE_KINDS.includes(item.kind)) return { score: 0, correct: false, gradable: false }

  if (item.kind === 'choice') {
    const correct = String(response ?? '') === String(item.answer ?? '')
    return { score: correct ? 1 : 0, correct, gradable: true }
  }

  if (item.kind === 'multi') {
    const expected = new Set((Array.isArray(item.answer) ? item.answer : [item.answer]).map(String))
    const given = new Set((Array.isArray(response) ? response : []).map(String))
    if (!expected.size) return { score: 0, correct: false, gradable: false }
    let hits = 0
    let wrong = 0
    for (const id of given) {
      if (expected.has(id)) hits += 1
      else wrong += 1
    }
    const score = Math.max(0, (hits - wrong) / expected.size)
    const correct = hits === expected.size && wrong === 0
    return { score: round2(score), correct, gradable: true }
  }

  if (item.kind === 'order') {
    const expected = (Array.isArray(item.answer) ? item.answer : []).map(String)
    const given = (Array.isArray(response) ? response : []).map(String)
    if (!expected.length) return { score: 0, correct: false, gradable: false }
    let inPlace = 0
    expected.forEach((id, index) => { if (given[index] === id) inPlace += 1 })
    return { score: round2(inPlace / expected.length), correct: inPlace === expected.length, gradable: true }
  }

  if (item.kind === 'number') {
    const expected = parseNumber(item.answer)
    const given = parseNumber(response)
    if (!Number.isFinite(expected)) return { score: 0, correct: false, gradable: false }
    if (!Number.isFinite(given)) return { score: 0, correct: false, gradable: true }
    const tolerance = Number.isFinite(Number(item.tolerance)) && Number(item.tolerance) >= 0
      ? Number(item.tolerance)
      : Math.max(1e-9, Math.abs(expected) * 0.01)
    const correct = Math.abs(given - expected) <= tolerance
    return { score: correct ? 1 : 0, correct, gradable: true }
  }

  // blank: any accepted spelling counts.
  const accepted = (Array.isArray(item.answer) ? item.answer : [item.answer]).map(normalizeAnswerText).filter(Boolean)
  if (!accepted.length) return { score: 0, correct: false, gradable: false }
  const given = normalizeAnswerText(response)
  const correct = accepted.includes(given)
  if (correct) return { score: 1, correct, gradable: true }
  const asNumber = parseNumber(response)
  const numeric = accepted.map(parseNumber).filter(Number.isFinite)
  if (Number.isFinite(asNumber) && numeric.some(value => Math.abs(value - asNumber) <= Math.max(1e-9, Math.abs(value) * 0.001))) {
    return { score: 1, correct: true, gradable: true }
  }
  return { score: 0, correct: false, gradable: true }
}

// A short label of a wrong answer, for the mastery model's misconception log.
export function wrongLabel(item, response) {
  if (item.kind === 'choice') return `chose ${String(response).toUpperCase()}: ${(item.options?.find(option => option.id === response)?.text ?? '').slice(0, 50)}`
  if (item.kind === 'number' || item.kind === 'blank') return `answered ${String(response).slice(0, 40)}`
  return 'wrong'
}

function round2(value) {
  return Math.round(value * 100) / 100
}
