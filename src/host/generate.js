// Model calls with structure: JSON answers are extracted, repaired once if
// needed, and normalized; lesson boards stream as JSON Lines and are emitted
// step by step while the model is still writing.
//
// `llm` is the plugin's model port (see llm.js):
//   llm.complete({ purpose, system, user, images?, maxTokens, signal }) → text
//   llm.stream({ purpose, system, user, maxTokens, signal, onText }) → text
//   effort: 'low' asks a reasoning model to think briefly (board writing).
// purpose is 'teach' (course design, lessons, materials) or 'quick'
// (grading, in-lesson questions, profile notes).

import { normalizeBoard } from '../core/board-script.js'
import { extractJson, JsonExtractError, parseJsonLines } from '../core/json-extract.js'

export class TutorError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TutorError'
    this.code = code
  }
}

const REPAIR = 'Your previous reply could not be parsed as JSON. Reply again with the complete answer as valid JSON only — no code fences, no commentary.'

// onText(delta), when given, streams the first answer (used for progress).
export async function generateJson(llm, { purpose = 'teach', prompt, maxTokens = 8000, images, signal, normalize = value => value, onText }) {
  const request = { purpose, system: prompt.system, user: prompt.user, images, maxTokens, signal }
  const first = onText ? await llm.stream({ ...request, onText }) : await llm.complete(request)
  try {
    return normalize(extractJson(first))
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    // One repair round: the model sees its own answer and the problem.
    const retryUser = `${prompt.user}\n\n<previous_reply>\n${String(first).slice(0, 12000)}\n</previous_reply>\n\n${REPAIR}${error instanceof JsonExtractError ? '' : `\nProblem: ${error.message}`}`
    const second = await llm.complete({ purpose, system: prompt.system, user: retryUser, images, maxTokens, signal })
    try {
      return normalize(extractJson(second))
    } catch {
      throw new TutorError('bad-output', 'The model did not return a usable answer. Try again or pick a stronger model in settings.')
    }
  }
}

// Streams a board. onStep(step, index) fires for each finished step, with the
// same ids the final board will have. Returns the normalized board.
export async function generateSteps(llm, { purpose = 'teach', effort, prompt, maxTokens = 12000, signal, conceptIds = [], onStep, minSteps = 1, images }) {
  const raw = []
  let buffer = ''
  let emitted = 0
  const emit = () => {
    if (!raw.length) return
    let board
    try {
      board = normalizeBoard(raw, { conceptIds })
    } catch {
      return
    }
    while (emitted < board.steps.length) {
      onStep?.(board.steps[emitted], emitted)
      emitted += 1
    }
  }
  const take = final => {
    const { items, rest } = parseJsonLines(buffer, { final })
    buffer = rest
    for (const item of items) {
      if (Array.isArray(item)) raw.push(...item)
      else if (Array.isArray(item?.steps)) raw.push(...item.steps)
      else raw.push(item)
    }
    if (items.length) emit()
  }
  const full = await llm.stream({
    purpose,
    effort,
    system: prompt.system,
    user: prompt.user,
    images,
    maxTokens,
    signal,
    onText: delta => {
      buffer += delta
      if (buffer.includes('\n')) take(false)
    },
  })
  take(true)
  // Some models ignore JSON Lines and send one JSON document instead.
  if (!raw.length) {
    try {
      const parsed = extractJson(full)
      raw.push(...(Array.isArray(parsed) ? parsed : parsed?.steps ?? []))
      emit()
    } catch {
      // handled below
    }
  }
  let board
  try {
    board = normalizeBoard(raw, { conceptIds })
  } catch {
    throw new TutorError('bad-output', 'The model did not return a usable lesson. Try again or pick a stronger model in settings.')
  }
  if (board.steps.length < minSteps) throw new TutorError('bad-output', 'The lesson came back too short. Try again.')
  while (emitted < board.steps.length) {
    onStep?.(board.steps[emitted], emitted)
    emitted += 1
  }
  return board
}

// Counts a marker in streamed text, even when a delta splits it, and reports
// the running total (e.g. lessons written so far in a blueprint).
export function streamCounter(marker, onCount) {
  let tail = ''
  let count = 0
  return delta => {
    const textValue = tail + String(delta ?? '')
    let found = 0
    for (let at = textValue.indexOf(marker); at !== -1; at = textValue.indexOf(marker, at + marker.length)) found += 1
    tail = textValue.slice(-(marker.length - 1))
    if (found) {
      count += found
      onCount(count)
    }
  }
}

export async function generateText(llm, { purpose = 'teach', prompt, maxTokens = 6000, signal, onText }) {
  const textValue = onText
    ? await llm.stream({ purpose, system: prompt.system, user: prompt.user, maxTokens, signal, onText })
    : await llm.complete({ purpose, system: prompt.system, user: prompt.user, maxTokens, signal })
  const cleaned = String(textValue ?? '').replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/u, '$1').trim()
  if (!cleaned) throw new TutorError('bad-output', 'The model returned an empty answer. Try again.')
  return cleaned
}
