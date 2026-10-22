// Whiteboard lesson scripts. A script is a list of steps; each step has the
// narration the tutor speaks and the board operations written while speaking,
// optionally followed by a quick understanding check. The normalizer accepts
// loose model output and returns a strictly shaped, size-limited script.

import { normalizeItem, text } from './course-model.js'
import { normalizePlot, plotToSource, plotToText } from './plot.js'

export const BOARD_LIMITS = Object.freeze({
  steps: 48,
  opsPerStep: 14,
  say: 1200,
  opText: 1600,
  listItems: 12,
  tableRows: 16,
  tableCols: 8,
  svgBytes: 48 * 1024,
  animBytes: 64 * 1024,
  codeBytes: 12 * 1024,
  chartPoints: 400,
  chartSeries: 6,
})

export const OP_TYPES = Object.freeze(['title', 'h', 'p', 'math', 'list', 'svg', 'chart', 'plot', 'table', 'code', 'note', 'mark', 'anim', 'col', 'page'])
const OP_ALIASES = Object.freeze({
  heading: 'h', header: 'h', subtitle: 'h', text: 'p', paragraph: 'p', write: 'p', formula: 'math', equation: 'math', latex: 'math',
  bullets: 'list', bullet: 'list', diagram: 'svg', drawing: 'svg', figure: 'svg', graph: 'chart', function: 'plot', curve: 'plot', callout: 'note',
  highlight: 'mark', underline: 'mark', animation: 'anim', interactive: 'anim', column: 'col', newcolumn: 'col', newpage: 'page', clear: 'page',
})
const CHART_KINDS = ['line', 'bar', 'scatter', 'pie', 'area']
const NOTE_TONES = ['tip', 'warn', 'key', 'example']
const MARK_STYLES = ['underline', 'circle', 'box']

function opType(raw) {
  const type = String(raw?.t ?? raw?.type ?? raw?.op ?? '').toLowerCase().replace(/[^a-z]/gu, '')
  return OP_TYPES.includes(type) ? type : OP_ALIASES[type]
}

function chartSeries(raw) {
  const series = (Array.isArray(raw?.series) ? raw.series : []).slice(0, BOARD_LIMITS.chartSeries).map(item => {
    const points = (Array.isArray(item?.points) ? item.points : [])
      .slice(0, BOARD_LIMITS.chartPoints)
      .map(point => (Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.x), Number(point?.y)]))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    return points.length ? { name: text(item?.name, 60), points } : null
  }).filter(Boolean)
  const data = (Array.isArray(raw?.data) ? raw.data : []).slice(0, 40).map(item => {
    const value = Number(item?.value ?? item?.y)
    const label = text(item?.label ?? item?.x ?? item?.name, 60)
    return label && Number.isFinite(value) ? { label, value } : null
  }).filter(Boolean)
  return { series, data }
}

export function normalizeOp(raw, index) {
  const t = opType(raw)
  if (!t) return null
  const id = typeof raw?.id === 'string' && /^[a-z0-9_-]{1,24}$/iu.test(raw.id) ? raw.id : `o${index + 1}`
  switch (t) {
    case 'title':
    case 'h':
    case 'p': {
      const value = text(raw?.text ?? raw?.content ?? raw?.value, t === 'p' ? BOARD_LIMITS.opText : 160)
      return value ? { id, t, text: value } : null
    }
    case 'math': {
      const tex = text(raw?.tex ?? raw?.latex ?? raw?.formula, 600)
      return tex ? { id, t, tex, text: text(raw?.text ?? raw?.plain, 300) } : null
    }
    case 'list': {
      const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, BOARD_LIMITS.listItems).map(item => text(item, 400)).filter(Boolean)
      return items.length ? { id, t, items, ordered: raw?.ordered === true } : null
    }
    case 'svg': {
      const svg = String(raw?.svg ?? raw?.content ?? '').trim()
      if (!/^<svg[\s>]/iu.test(svg) || svg.length > BOARD_LIMITS.svgBytes) return null
      return { id, t, svg, caption: text(raw?.caption, 200), wide: raw?.wide === true }
    }
    case 'chart':
    case 'plot': {
      // A curve given by formulas is a plot, whatever the model called it;
      // data points are a chart.
      const formulas = raw?.fns ?? raw?.functions ?? raw?.curves ?? (typeof raw?.y === 'string' || raw?.fn !== undefined || raw?.expr !== undefined ? raw : null)
      if (formulas) {
        const plot = normalizePlot(raw)
        if (plot) return { id, t: 'plot', ...plot }
      }
      const kind = CHART_KINDS.includes(raw?.kind) ? raw.kind : 'line'
      const { series, data } = chartSeries(raw)
      if (!series.length && !data.length) return null
      return { id, t: 'chart', kind, title: text(raw?.title, 120), xLabel: text(raw?.xLabel ?? raw?.x?.label, 60), yLabel: text(raw?.yLabel ?? raw?.y?.label, 60), series, data }
    }
    case 'table': {
      const head = (Array.isArray(raw?.head ?? raw?.columns) ? raw.head ?? raw.columns : []).slice(0, BOARD_LIMITS.tableCols).map(cell => text(cell, 120))
      const rows = (Array.isArray(raw?.rows) ? raw.rows : []).slice(0, BOARD_LIMITS.tableRows)
        .map(row => (Array.isArray(row) ? row : []).slice(0, BOARD_LIMITS.tableCols).map(cell => text(cell, 200)))
        .filter(row => row.length)
      return rows.length ? { id, t, head, rows } : null
    }
    case 'code': {
      const code = String(raw?.code ?? raw?.content ?? '').replace(/\r\n/gu, '\n').slice(0, BOARD_LIMITS.codeBytes)
      return code.trim() ? { id, t, lang: text(raw?.lang ?? raw?.language, 24).toLowerCase(), code, caption: text(raw?.caption, 200) } : null
    }
    case 'note': {
      const value = text(raw?.text ?? raw?.content, 800)
      return value ? { id, t, text: value, tone: NOTE_TONES.includes(raw?.tone) ? raw.tone : 'key' } : null
    }
    case 'mark': {
      const ref = text(raw?.ref ?? raw?.target, 24)
      return ref ? { id, t, ref, style: MARK_STYLES.includes(raw?.style) ? raw.style : 'underline' } : null
    }
    case 'anim': {
      const html = String(raw?.html ?? raw?.content ?? '').trim()
      if (!html || html.length > BOARD_LIMITS.animBytes) return null
      const height = Math.round(Number(raw?.height))
      // A still frame for places scripts cannot run, such as exported videos.
      const poster = String(raw?.poster ?? '').trim()
      return {
        id,
        t,
        html,
        height: Number.isFinite(height) ? Math.min(520, Math.max(160, height)) : 300,
        caption: text(raw?.caption, 200),
        poster: /^<svg[\s>]/iu.test(poster) && poster.length <= BOARD_LIMITS.svgBytes ? poster : '',
      }
    }
    case 'col':
      return { id, t }
    case 'page':
      return { id, t, title: text(raw?.title, 160) }
    default:
      return null
  }
}

// Synced steps: an op's "at" is the sentence of the narration it is written
// during. Once any op of a step has one, every op gets one, never going back
// (a missing one repeats the previous). Steps without any stay unsynced.
function syncOps(ops, rawAts) {
  if (!rawAts.some(value => value !== null)) return
  let current = 0
  ops.forEach((op, index) => {
    current = Math.max(current, rawAts[index] ?? current)
    op.at = current
  })
}

function sentenceIndex(value) {
  const number = Number(value)
  return value !== null && value !== '' && Number.isInteger(number) && number >= 0 ? Math.min(19, number) : null
}

// Ops get globally unique ids ("o1".."oN") so marks can point at earlier ops.
// A step's "goal" names the lesson objective it serves (0-based).
export function normalizeBoard(raw, { conceptIds = [] } = {}) {
  const sourceSteps = Array.isArray(raw) ? raw : Array.isArray(raw?.steps) ? raw.steps : []
  const steps = []
  let opCounter = 0
  let worked = false
  const idMap = new Map()
  for (const rawStep of sourceSteps.slice(0, BOARD_LIMITS.steps)) {
    const say = text(rawStep?.say ?? rawStep?.narration ?? rawStep?.speech, BOARD_LIMITS.say)
    const ops = []
    const ats = []
    for (const rawOp of (Array.isArray(rawStep?.ops ?? rawStep?.board) ? rawStep.ops ?? rawStep.board : []).slice(0, BOARD_LIMITS.opsPerStep)) {
      const op = normalizeOp(rawOp, opCounter)
      if (!op) continue
      const originalId = typeof rawOp?.id === 'string' ? rawOp.id : null
      op.id = `o${++opCounter}`
      if (originalId) idMap.set(originalId, op.id)
      ops.push(op)
      ats.push(sentenceIndex(rawOp?.at))
    }
    syncOps(ops, ats)
    let check = rawStep?.check ? normalizeItem(rawStep.check, steps.length, conceptIds) : null
    // One "show your working" check per board; later ones ask for the answer only.
    if (check?.kind === 'work') {
      if (worked) check = { ...check, kind: 'short' }
      else worked = true
    }
    if (!say && !ops.length && !check) continue
    const goal = sentenceIndex(rawStep?.goal)
    steps.push({ id: `s${steps.length + 1}`, say, ops, ...(goal !== null && goal < 12 ? { goal } : {}), ...(check && check.kind !== 'order' ? { check: { ...check, id: `k${steps.length + 1}` } } : {}) })
  }
  // Point marks at the renumbered ops; drop marks that point nowhere.
  const known = new Set(steps.flatMap(step => step.ops.map(op => op.id)))
  for (const step of steps) {
    step.ops = step.ops.filter(op => {
      if (op.t !== 'mark') return true
      op.ref = idMap.get(op.ref) ?? op.ref
      return known.has(op.ref)
    })
  }
  if (!steps.length) throw new Error('lesson script has no steps')
  return { title: text(raw?.title, 160), steps }
}

// ── timing ──────────────────────────────────────────────────────────────────

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/gu

export function estimateSpeechMs(value, rate = 1) {
  const content = String(value ?? '')
  const cjk = (content.match(CJK) ?? []).length
  const words = content.replace(CJK, ' ').split(/\s+/u).filter(Boolean).length
  const seconds = cjk / 4.4 + words / 2.6
  return Math.round((seconds * 1000) / Math.max(0.5, Math.min(2, rate || 1)))
}

export function opVisibleLength(op) {
  switch (op.t) {
    case 'title':
    case 'h':
    case 'p':
    case 'note':
      return op.text.length
    case 'math':
      return Math.min(80, op.tex.length)
    case 'list':
      return op.items.join(' ').length
    case 'table':
      return op.rows.flat().join(' ').length / 2
    case 'code':
      return Math.min(400, op.code.length / 2)
    default:
      return 60
  }
}

// How long writing an op takes on the board, before speed adjustments.
export function estimateWriteMs(op) {
  if (op.t === 'col' || op.t === 'page') return 0
  if (op.t === 'mark') return 600
  if (op.t === 'svg' || op.t === 'chart' || op.t === 'plot' || op.t === 'anim') return 2200
  return Math.min(7000, Math.max(450, opVisibleLength(op) * 55))
}

export function stepTiming(step, { rate = 1, speechMs } = {}) {
  const speak = speechMs ?? estimateSpeechMs(step.say, rate)
  const writes = step.ops.map(estimateWriteMs)
  const writeTotal = writes.reduce((sum, value) => sum + value, 0)
  // Writing should finish a little before the narration so the last words
  // land on a complete board; if there is more to write than to say, write
  // at natural speed and let the step run longer.
  const target = speak > 0 ? speak * 0.85 : writeTotal
  const scale = writeTotal > 0 && target > 0 ? Math.min(1.6, Math.max(0.35, target / writeTotal)) : 1
  const scaled = writes.map(value => Math.round(value * scale))
  return { speechMs: speak, writeMs: scaled, durationMs: Math.max(speak, scaled.reduce((sum, value) => sum + value, 0)) + 350 }
}

// Plain text of a script for prompts (Q&A context) and notes export.
export function boardToPlainText(board, { maxChars = 8000, uptoStep } = {}) {
  const lines = []
  for (const [index, step] of board.steps.entries()) {
    if (uptoStep !== undefined && index > uptoStep) break
    if (step.say) lines.push(`[${step.id}] ${step.say}`)
    for (const op of step.ops) {
      if (op.t === 'math') lines.push(`  $${op.tex}$`)
      else if (op.t === 'list') lines.push(...op.items.map(item => `  • ${item}`))
      else if (op.t === 'table') lines.push(`  | ${op.head.join(' | ')} |`, ...op.rows.map(row => `  | ${row.join(' | ')} |`))
      else if (op.t === 'code') lines.push(`  \`\`\`${op.lang}\n${op.code}\n  \`\`\``)
      else if (op.t === 'plot') lines.push(`  (plot: ${plotToSource(op)})`)
      else if (op.text) lines.push(`  ${op.text}`)
      else if (op.caption) lines.push(`  (${op.t}: ${op.caption})`)
    }
  }
  const output = lines.join('\n')
  return output.length > maxChars ? `${output.slice(0, maxChars)}\n…` : output
}

export function boardToMarkdown(board) {
  const out = []
  if (board.title) out.push(`# ${board.title}`, '')
  for (const step of board.steps) {
    for (const op of step.ops) {
      if (op.t === 'title') out.push(`## ${op.text}`, '')
      else if (op.t === 'h') out.push(`### ${op.text}`, '')
      else if (op.t === 'p') out.push(op.text, '')
      else if (op.t === 'math') out.push(`$$${op.tex}$$`, '')
      else if (op.t === 'list') out.push(...op.items.map((item, index) => (op.ordered ? `${index + 1}. ${item}` : `- ${item}`)), '')
      else if (op.t === 'note') out.push(`> ${op.text}`, '')
      else if (op.t === 'code') out.push(`\`\`\`${op.lang}`, op.code, '```', '')
      else if (op.t === 'plot') out.push(...plotToText(op).split('\n').map(line => `> 📈 ${line}`), '')
      else if (op.t === 'table') {
        const head = op.head.length ? op.head : op.rows[0].map(() => ' ')
        out.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...op.rows.map(row => `| ${row.join(' | ')} |`), '')
      } else if (op.caption) out.push(`*${op.caption}*`, '')
    }
    if (step.say) out.push(`<!-- ${step.say.replace(/--/gu, '—')} -->`, '')
  }
  return out.join('\n').replace(/\n{3,}/gu, '\n\n').trim() + '\n'
}
