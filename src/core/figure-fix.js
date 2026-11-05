// Pictures the model drew that the board cannot draw get one more chance.
// Once a board is written, the ones still wrong after the free fixes go
// back to the model together, each with what is wrong with it and what the
// teacher says while it is on the board. What comes back is checked by the
// same normalizer as any op, and only a picture with nothing wrong takes the
// place of the one it fixes (by op id, keeping its place in the narration).
// The rest stay "missing" ops, which say on the board that they could not be
// drawn.

import { FIGURES, readOp } from './board-script.js'
import { text } from './course-model.js'

// Pictures sent in one repair call; any more stay missing.
export const MAX_REPAIRS = 6
// How much of a broken picture the model sees again.
const SHOWN = Object.freeze({ svg: 12_000, html: 9000, poster: 0 })

// The op as the model wrote it, its long parts cut.
function shownOp(raw) {
  if (!raw || typeof raw !== 'object') return raw ?? null
  const copy = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'at' || key === 'id') continue
    const limit = SHOWN[key]
    if (limit === 0) continue
    copy[key] = typeof value === 'string' && limit && value.length > limit ? `${value.slice(0, limit)}…(cut)` : value
  }
  return copy
}

// What the repair prompt shows for each picture: its id, kind, problems,
// the teacher's words around it and the op as written.
export function repairItems(problems, { max = MAX_REPAIRS } = {}) {
  return problems.slice(0, max).map(problem => ({
    id: problem.op,
    kind: problem.kind,
    problems: problem.reasons.slice(0, 6).map(reason => text(reason, 240)),
    say: text(problem.say, 800),
    op: shownOp(problem.raw),
  }))
}

// Output room for the fixed pictures: a plot is short, a diagram or an
// animation page is long.
export function repairBudget(items) {
  const each = { plot: 900, chart: 1500, svg: 3500, anim: 4500 }
  return Math.min(16_000, 800 + items.reduce((sum, item) => sum + (each[item.kind] ?? 2000), 0))
}

// The fixed pictures in a reply, whatever shape it took:
// {"figures":[{"id","op"}]}, a list of those, or {"<id>": op}.
function repliedFigures(reply) {
  if (Array.isArray(reply)) return reply
  if (!reply || typeof reply !== 'object') return []
  for (const key of ['figures', 'ops', 'fixes', 'items']) if (Array.isArray(reply[key])) return reply[key]
  return Object.entries(reply).map(([id, op]) => ({ id, op }))
}

// Puts the fixed pictures in place, by op id. A reply is used only when it
// is a picture (of any kind) with nothing wrong with it. Returns the steps
// (new arrays where something changed) and the ids that were fixed.
export function applyRepairs(steps, problems, reply) {
  const wanted = new Set(problems.map(problem => problem.op))
  const fixes = new Map()
  for (const entry of repliedFigures(reply)) {
    const id = String(entry?.id ?? entry?.opId ?? '')
    const candidate = entry?.op ?? entry?.figure ?? entry?.replace
    if (!wanted.has(id) || fixes.has(id) || !candidate || typeof candidate !== 'object') continue
    const read = readOp(candidate, 0)
    if (read.op && FIGURES.includes(read.op.t) && !read.problems.length) fixes.set(id, read.op)
  }
  if (!fixes.size) return { steps, fixed: [] }
  const next = steps.map(step => (step.ops.some(op => fixes.has(op.id))
    ? { ...step, ops: step.ops.map(op => (fixes.has(op.id) ? { ...fixes.get(op.id), id: op.id, ...(op.at !== undefined ? { at: op.at } : {}) } : op)) }
    : step))
  return { steps: next, fixed: [...fixes.keys()] }
}

// A step as the classroom gets it while its board is being written: a
// picture that will be redrawn once the board is done says so (redraw),
// instead of that it could not be drawn.
export function redrawing(step) {
  if (!step.ops.some(op => op.t === 'missing')) return step
  return { ...step, ops: step.ops.map(op => (op.t === 'missing' ? { ...op, redraw: true } : op)) }
}

// Steps with no picture waiting to be redrawn any more.
export function settled(steps) {
  return steps.map(step => (step.ops.some(op => op.redraw) ? { ...step, ops: step.ops.map(({ redraw, ...op }) => op) } : step))
}
