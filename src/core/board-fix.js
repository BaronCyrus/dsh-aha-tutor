// Fixing a board the learner caught out. When the model that checked a step
// finds it wrong, it names what to replace: ops, the narration, the check.
// This module keeps only fixes that change something on that board and
// applies them, keeping every op's id (so marks and asides still point at the
// same places) and noting what each replaced op said before.

import { BOARD_LIMITS, normalizeOp } from './board-script.js'
import { normalizeItem, text } from './course-model.js'
import { plotToText } from './plot.js'

export const VERDICTS = Object.freeze(['wrong', 'right', 'unclear'])
export const MAX_FIXES = 12
// Ops that only arrange the board: there is nothing in them to be wrong.
const LAYOUT = new Set(['col', 'page', 'mark'])

// What an op shows, as plain text ("originally: …").
export function opPlain(op) {
  switch (op?.t) {
    case 'title':
    case 'h':
    case 'p':
    case 'note':
      return op.text
    case 'math':
      return op.text || op.tex
    case 'list':
      return op.items.join('; ')
    case 'table':
      return [op.head, ...op.rows].filter(row => row.length).map(row => row.join(' | ')).join(' / ')
    case 'code':
      return op.code
    case 'chart':
      return [op.title, ...op.series.map(series => `${series.name} ${series.points.slice(0, 6).map(point => `(${point.join(', ')})`).join(' ')}`), ...op.data.map(item => `${item.label} ${item.value}`)].filter(Boolean).join('; ')
    case 'plot':
      return plotToText(op).replace(/\n/gu, '; ')
    case 'svg':
    case 'anim':
      return op.caption ?? ''
    default:
      return ''
  }
}

const withoutPlace = op => JSON.stringify({ ...op, id: undefined, at: undefined, fixed: undefined })

// raw: { verdict, summary, fixes: [{ step, op, replace }, { step, say },
// { step, check }] } from the model; steps: the board (or the aside) the
// step belongs to. Fixes are kept only for a "wrong" verdict.
export function normalizeVerdict(raw, steps) {
  const verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : null
  if (!verdict) throw new Error('the check names no verdict')
  const summary = text(raw?.summary ?? raw?.reason, 400)
  const fixes = []
  if (verdict !== 'wrong') return { verdict, summary, fixes }
  const byId = new Map(steps.map(step => [step.id, step]))
  const done = new Set()
  const keep = (key, fix) => {
    if (done.has(key) || fixes.length >= MAX_FIXES) return
    done.add(key)
    fixes.push(fix)
  }
  for (const fix of (Array.isArray(raw?.fixes) ? raw.fixes : []).slice(0, MAX_FIXES * 3)) {
    const step = byId.get(String(fix?.step ?? fix?.stepId ?? ''))
    if (!step) continue
    const replacement = fix.replace ?? fix.with ?? fix.op_new
    if (replacement && typeof replacement === 'object') {
      const old = step.ops.find(op => op.id === String(fix.op ?? fix.opId ?? ''))
      const next = normalizeOp(replacement, 0)
      if (old && next && !LAYOUT.has(old.t) && !LAYOUT.has(next.t) && withoutPlace(next) !== withoutPlace(old)) keep(`${step.id}:${old.id}`, { step: step.id, op: old.id, replace: next })
    }
    if (typeof fix.say === 'string') {
      const say = text(fix.say, BOARD_LIMITS.say)
      if (say && say !== step.say) keep(`${step.id}:say`, { step: step.id, say })
    }
    if (fix.check && typeof fix.check === 'object' && step.check) {
      const check = normalizeItem(fix.check, 0, step.check.conceptIds ?? [])
      if (check && check.kind !== 'order') {
        const next = { ...check, id: step.check.id, conceptIds: step.check.conceptIds ?? [] }
        if (JSON.stringify(next) !== JSON.stringify(step.check)) keep(`${step.id}:check`, { step: step.id, check: next })
      }
    }
  }
  return { verdict, summary, fixes }
}

// Applies fixes to steps (a new array; the steps given are not changed).
// A replaced op keeps its id and its place in the narration and remembers
// what it first said, even when it is fixed again. Returns the fixes as
// applied, ops complete, for a client that holds the same steps.
export function applyFixes(steps, fixes, { at = new Date().toISOString() } = {}) {
  const applied = []
  const next = steps.map(step => {
    const own = fixes.filter(fix => fix.step === step.id)
    if (!own.length) return step
    const copy = { ...step, ops: [...step.ops] }
    for (const fix of own) {
      if (fix.replace) {
        const index = copy.ops.findIndex(op => op.id === fix.op)
        if (index < 0) continue
        const old = copy.ops[index]
        // Fixes the host applied arrive with their note; keep its wording.
        const note = fix.replace.fixed
        const op = { ...fix.replace, id: old.id, ...(old.at !== undefined ? { at: old.at } : {}), fixed: { was: old.fixed?.was ?? note?.was ?? text(opPlain(old), 300), at: note?.at ?? at } }
        copy.ops[index] = op
        applied.push({ step: step.id, op: old.id, replace: op })
      }
      if (fix.say !== undefined) {
        copy.say = fix.say
        applied.push({ step: step.id, say: fix.say })
      }
      if (fix.check && copy.check) {
        copy.check = { ...fix.check, id: copy.check.id, conceptIds: copy.check.conceptIds ?? [] }
        applied.push({ step: step.id, check: copy.check })
      }
    }
    return copy
  })
  return { steps: next, applied }
}

// A step as the classroom holds it (an answer the host does not keep),
// checked op by op but with its own ids, so fixes to it name the ids the
// classroom knows. Null when nothing usable is left.
export function sanitizeStep(raw) {
  const id = String(raw?.id ?? '')
  if (!/^[\w-]{1,48}$/u.test(id) || !Array.isArray(raw?.ops)) return null
  const ops = raw.ops.slice(0, BOARD_LIMITS.opsPerStep).map(op => {
    const clean = normalizeOp(op, 0)
    if (!clean || typeof op.id !== 'string' || !/^[\w-]{1,48}$/u.test(op.id)) return null
    return { ...clean, id: op.id, ...(Number.isInteger(op.at) && op.at >= 0 && op.at < 20 ? { at: op.at } : {}) }
  }).filter(Boolean)
  const say = text(raw.say, BOARD_LIMITS.say)
  if (!say && !ops.length) return null
  return { id, say, ops }
}

// The same fixes for steps whose ids carry a prefix (an aside on the
// client: "a2_s1", "a2_o3").
export function prefixFixes(fixes, prefix) {
  return fixes.map(fix => ({ ...fix, step: `${prefix}${fix.step}`, ...(fix.op ? { op: `${prefix}${fix.op}` } : {}) }))
}

// ── what the checking model sees ────────────────────────────────────────────

// A step as JSON, as its ops are stored. Diagrams and animations keep only
// their captions unless `full` (the step being checked).
export function stepJson(step, { full = false } = {}) {
  const ops = step.ops.map(({ fixed, ...op }) => {
    if (op.t === 'svg') return full ? { ...op, svg: op.svg.slice(0, 16_000) } : { ...op, svg: '…' }
    if (op.t === 'anim') return { ...op, html: full ? op.html.slice(0, 8000) : '…', poster: '…' }
    return op
  })
  return JSON.stringify({ id: step.id, say: step.say, ops, ...(step.check ? { check: step.check } : {}) })
}

// The board as JSON lines around the step being checked, within maxChars:
// that step first, then its neighbours, nearest first.
export function boardForCheck(steps, stepId, { maxChars = 14_000 } = {}) {
  const lines = steps.map(step => stepJson(step))
  const center = Math.max(0, steps.findIndex(step => step.id === stepId))
  const kept = new Set([center])
  let used = lines[center]?.length ?? 0
  for (let distance = 1; distance < steps.length; distance += 1) {
    for (const index of [center - distance, center + distance]) {
      if (index < 0 || index >= steps.length || used + lines[index].length > maxChars) continue
      kept.add(index)
      used += lines[index].length
    }
  }
  return lines.filter((line, index) => kept.has(index)).join('\n')
}

// Fixes as the teacher describes them: "s3 o7: before → after".
export function describeFixes(fixes, steps) {
  const byId = new Map(steps.map(step => [step.id, step]))
  return fixes.map(fix => {
    const step = byId.get(fix.step)
    if (fix.replace) return `${fix.step} ${fix.op}: ${opPlain(step?.ops.find(op => op.id === fix.op))} → ${opPlain(fix.replace)}`
    if (fix.say !== undefined) return `${fix.step} narration: ${step?.say ?? ''} → ${fix.say}`
    return `${fix.step} check answer: ${JSON.stringify(step?.check?.answer ?? '')} → ${JSON.stringify(fix.check?.answer ?? '')}`
  }).join('\n')
}
