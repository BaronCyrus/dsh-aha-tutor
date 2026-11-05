// Model calls with structure: JSON answers are extracted, repaired once if
// needed, and normalized; lesson boards stream as JSON Lines and are emitted
// step by step while the model is still writing.
//
// `llm` is the plugin's model port (see llm.js):
//   llm.complete({ purpose, system, user, images?, maxTokens, signal }) → text
//   llm.stream({ purpose, system, user, maxTokens, signal, onText }) → text
//   effort: 'lowest' asks a reasoning model not to think, or as little as
//   it can (board writing).
// purpose is 'teach' (course design, lessons, materials) or 'quick'
// (grading, in-lesson questions, profile notes).

import { normalizeBoard } from '../core/board-script.js'
import { orderBoardOptions } from '../core/choice-order.js'
import { applyRepairs, MAX_REPAIRS, redrawing, repairBudget, repairItems, settled } from '../core/figure-fix.js'
import { extractJson, JsonExtractError, parseJsonLines } from '../core/json-extract.js'
import { figureRepairPrompt } from './prompts.js'

export class TutorError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TutorError'
    this.code = code
  }
}

const REPAIR = 'Your previous reply could not be parsed as JSON. Reply again with the complete answer as valid JSON only — no code fences, no commentary.'

// onText(delta), when given, streams the first answer (used for progress).
// effort: as for boards; left out, the model reasons at its default.
export async function generateJson(llm, { purpose = 'teach', effort, prompt, maxTokens = 8000, images, signal, normalize = value => value, onText }) {
  const request = { purpose, ...(effort ? { effort } : {}), system: prompt.system, user: prompt.user, images, maxTokens, signal }
  const first = onText ? await llm.stream({ ...request, onText }) : await llm.complete(request)
  try {
    return normalize(extractJson(first))
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    // One repair round: the model sees its own answer and the problem.
    const retryUser = `${prompt.user}\n\n<previous_reply>\n${String(first).slice(0, 12000)}\n</previous_reply>\n\n${REPAIR}${error instanceof JsonExtractError ? '' : `\nProblem: ${error.message}`}`
    const second = await llm.complete({ ...request, user: retryUser })
    try {
      return normalize(extractJson(second))
    } catch {
      throw new TutorError('bad-output', 'The model did not return a usable answer. Try again or pick a stronger model in settings.')
    }
  }
}

// Counts the times `field` has been written in a streamed JSON answer (each
// question's "prompt", each card's "front") and calls onCount with the
// running total.
export function fieldCounter(field, onCount) {
  let tail = ''
  let count = 0
  return delta => {
    const window = tail + delta
    let found = 0
    for (let at = window.indexOf(field); at >= 0; at = window.indexOf(field, at + field.length)) found += 1
    // Shorter than the field, so a match is never counted twice.
    tail = window.slice(-(field.length - 1))
    if (found) onCount((count += found))
  }
}

// What the step being written is about, from the unfinished JSON of that
// step: its first heading, or else the first sentence of what the teacher
// will say. Empty until either has begun.
export function writingHint(partial) {
  const textValue = String(partial ?? '')
  const start = textValue.lastIndexOf('"say"')
  if (start < 0) return ''
  const step = textValue.slice(start)
  const heading = /"t"\s*:\s*"(?:title|h)"[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.)*)/u.exec(step)?.[1]
  const said = /^"say"\s*:\s*"((?:[^"\\]|\\.)*)/u.exec(step)?.[1]
  const source = heading ?? said ?? ''
  let value
  try {
    value = JSON.parse(`"${source.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/u, '')}"`)
  } catch {
    value = source
  }
  if (!heading) value = value.split(/(?<=[。！？!?；;])/u)[0]
  value = value.replace(/\s+/gu, ' ').trim()
  const cut = [...value].length > 40 ? `${[...value].slice(0, 40).join('')}…` : value
  // A formula cut off in the middle would show its opening dollar sign.
  const open = (cut.match(/(?<!\\)\$/gu) ?? []).length % 2 === 1
  return open ? `${cut.slice(0, cut.lastIndexOf('$')).trimEnd()}…` : cut
}

const PROGRESS_EVERY_MS = 250

// Pictures on a written board that still cannot be drawn go back to the
// model once, all in one call: the teach model, thinking as little as it
// can. Returns the steps with every picture that came back right in place;
// a call that fails leaves them as they were, since the board itself is
// written (only cancelling stops it).
export async function repairFigures(llm, { steps, problems, signal, logger }) {
  const items = repairItems(problems)
  if (!items.length) return { steps, fixed: [] }
  const prompt = figureRepairPrompt({ items })
  try {
    const reply = await llm.complete({ purpose: 'teach', effort: 'lowest', system: prompt.system, user: prompt.user, maxTokens: repairBudget(items), signal })
    return applyRepairs(steps, problems.slice(0, items.length), extractJson(reply))
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    logger?.debug?.('aha-tutor could not redraw figures: %s', error?.message)
    return { steps, fixed: [] }
  }
}

// A board with each step passed through clean(step) (see scrubStep), and
// marks pointing at ops that cleaning left out dropped.
function cleanBoard(board, clean) {
  if (!clean) return board
  const steps = board.steps.map(step => clean(step))
  const known = new Set(steps.flatMap(step => step.ops.map(op => op.id)))
  return { ...board, steps: steps.map(step => ({ ...step, ops: step.ops.filter(op => op.t !== 'mark' || known.has(op.ref)) })) }
}

// Streams a board. onStep(step, index) fires for each finished step, with the
// same ids the final board will have. onProgress({ phase, thinking, chars,
// steps, current }) reports what the model is doing: 'starting' before
// anything arrives, 'thinking' while it reasons, 'writing' with the step
// being written and its hint, then 'repairing' (with `figures`) while
// pictures that could not be drawn are redrawn: every step is written by
// then. Returns the normalized board.
// repair: redraw such pictures (repairFigures); while that is still to come,
// a step shows them as being redrawn. clean(step), when given, changes every
// step before it is shown or kept (pages not read are left out), redrawn
// pictures too.
export async function generateSteps(llm, { purpose = 'teach', effort, prompt, maxTokens = 12000, signal, conceptIds = [], onStep, onProgress, progressEveryMs = PROGRESS_EVERY_MS, minSteps = 1, images, repair = true, logger, clean }) {
  const raw = []
  let buffer = ''
  let emitted = 0
  const status = { phase: 'starting', thinking: 0, chars: 0 }
  let reported = 0
  const report = force => {
    if (!onProgress) return
    const at = Date.now()
    if (!force && at - reported < progressEveryMs) return
    reported = at
    onProgress({ ...status, steps: emitted, current: status.phase === 'writing' ? writingHint(buffer) : '' })
  }
  report(true)
  const send = (step, index) => onStep?.(repair ? redrawing(step) : step, index)
  const emit = () => {
    if (!raw.length) return
    let board
    try {
      board = orderBoardOptions(cleanBoard(normalizeBoard(raw, { conceptIds }), clean))
    } catch {
      return
    }
    const before = emitted
    while (emitted < board.steps.length) {
      send(board.steps[emitted], emitted)
      emitted += 1
    }
    if (emitted > before) report(true)
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
      status.phase = 'writing'
      status.chars += delta.length
      if (buffer.includes('\n')) take(false)
      report(false)
    },
    onReasoning: delta => {
      if (status.phase !== 'writing') status.phase = 'thinking'
      status.thinking += delta.length
      report(false)
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
  const problems = []
  try {
    board = orderBoardOptions(cleanBoard(normalizeBoard(raw, { conceptIds, problems }), clean))
  } catch {
    throw new TutorError('bad-output', 'The model did not return a usable lesson. Try again or pick a stronger model in settings.')
  }
  if (board.steps.length < minSteps) throw new TutorError('bad-output', 'The lesson came back too short. Try again.')
  while (emitted < board.steps.length) {
    send(board.steps[emitted], emitted)
    emitted += 1
  }
  if (repair && problems.length) {
    status.phase = 'repairing'
    status.figures = Math.min(problems.length, MAX_REPAIRS)
    report(true)
    // A redrawn picture's caption names only pages that were read, too.
    board = cleanBoard({ ...board, steps: (await repairFigures(llm, { steps: board.steps, problems, signal, logger })).steps }, clean)
  }
  return { ...board, steps: settled(board.steps) }
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
