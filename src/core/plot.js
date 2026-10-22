// Function plots: the model writes formulas and the app computes every point,
// so a curve on the board is exactly the formula beside it. A plot op holds
// curves (y = f(x), parametric x(t), y(t), polar r(θ)), parameters the
// learner can slide, and marks: points, dashed guides, shaded areas and
// tangents. This module checks a plot (normalizePlot) and samples it.

import { compileExpr, constantValue, exprToText, isConstantName, isFunctionName, parseExpr } from './expr.js'

export const PLOT_LIMITS = Object.freeze({ fns: 4, params: 4, points: 8, lines: 6, shades: 3, tangents: 3, samples: 480 })

const clip = (value, max) => (value === null || value === undefined ? '' : String(value).replace(/\u0000/gu, '').trim().slice(0, max))
const list = (value, max) => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []).slice(0, max)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const mentionsPi = value => /pi|π/iu.test(String(value ?? ''))

// The names a curve is written in; every one stands for the same value.
const VARIABLES = Object.freeze({ fx: ['x', 't'], param: ['t', 'θ', 'theta'], polar: ['θ', 'theta', 't'] })
const RESERVED = new Set(['x', 'y', 'r', 'θ', 'theta'])

export function curveVariables(kind, paramNames) {
  return VARIABLES[kind].filter(name => !paramNames.includes(name))
}

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power
}

// [a, b], { min, max } or { range: [a, b] }; bounds may be formulas ("2*pi").
function readRange(value) {
  const pair = Array.isArray(value) ? value : value && typeof value === 'object' ? (Array.isArray(value.range) ? value.range : [value.min, value.max]) : null
  if (!pair || pair.length < 2) return null
  const a = constantValue(pair[0])
  const b = constantValue(pair[1])
  return a !== null && b !== null && b > a ? [a, b] : null
}

function normalizeParams(raw) {
  const seen = new Set()
  const params = []
  for (const param of list(raw, PLOT_LIMITS.params)) {
    const name = clip(param?.name ?? param?.symbol ?? param?.id, 12)
    if (!/^\p{L}[\p{L}\p{N}_]{0,11}$/u.test(name) || isFunctionName(name) || isConstantName(name) || RESERVED.has(name) || seen.has(name)) continue
    const min = constantValue(param.min)
    const max = constantValue(param.max)
    if (min === null || max === null || !(max > min)) continue
    const start = constantValue(param.value ?? param.default ?? param.initial)
    let step = constantValue(param.step)
    if (!(step > 0) || step > max - min) step = niceStep((max - min) / 100)
    seen.add(name)
    params.push({ name, value: clamp(start ?? (min + max) / 2, min, max), min, max, step, label: clip(param.label ?? param.title, 30) })
  }
  return params
}

// "y = …", "f(x) = …" and "r(θ) = …" lose their left-hand side.
const formulaText = value => clip(value, 240).replace(/^[\p{L}](?:\s*\(\s*[\p{L}]+\s*\))?\s*=(?!=)/u, '').trim()

function checks(source, names) {
  try {
    parseExpr(source, names)
    return true
  } catch {
    return false
  }
}

function normalizeCurve(raw, paramNames) {
  const curve = typeof raw === 'string' ? { y: raw } : raw
  if (!curve || typeof curve !== 'object') return null
  const name = clip(curve.name ?? curve.label, 40)
  const known = kind => [...curveVariables(kind, paramNames), ...paramNames]
  if (curve.r !== undefined) {
    const r = formulaText(curve.r)
    if (!checks(r, known('polar'))) return null
    return { kind: 'polar', r, t: readRange(curve.t ?? curve.theta ?? curve.θ ?? curve.range) ?? [0, 2 * Math.PI], name }
  }
  if (typeof curve.x === 'string' && typeof curve.y === 'string') {
    const x = formulaText(curve.x)
    const y = formulaText(curve.y)
    if (!checks(x, known('param')) || !checks(y, known('param'))) return null
    return { kind: 'param', x, y, t: readRange(curve.t ?? curve.range) ?? [0, 2 * Math.PI], name }
  }
  const y = formulaText(curve.y ?? curve.fn ?? curve.f ?? curve.expr ?? curve.formula)
  if (!y || !checks(y, known('fx'))) return null
  const domain = readRange(curve.domain ?? (Array.isArray(curve.x) ? curve.x : null))
  return { kind: 'fx', y, ...(domain ? { domain } : {}), name }
}

// An index of an y = f(x) curve, or null.
function fxIndex(value, fns, fallback = true) {
  const index = Number(value)
  if (Number.isInteger(index) && fns[index]?.kind === 'fx') return index
  if (value !== undefined && value !== null && value !== '') return null
  if (!fallback) return null
  const first = fns.findIndex(fn => fn.kind === 'fx')
  return first >= 0 ? first : null
}

export function normalizePlot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const params = normalizeParams(raw.params ?? raw.parameters ?? raw.sliders)
  const paramNames = params.map(param => param.name)
  const single = typeof raw.y === 'string' || raw.fn !== undefined || raw.expr !== undefined || raw.f !== undefined || raw.formula !== undefined ? [{ ...raw, x: undefined, name: raw.name ?? raw.label }] : []
  const fns = list(raw.fns ?? raw.functions ?? raw.curves ?? single, PLOT_LIMITS.fns * 2).map(curve => normalizeCurve(curve, paramNames)).filter(Boolean).slice(0, PLOT_LIMITS.fns)
  if (!fns.length) return null

  const xSource = raw.x !== undefined && typeof raw.x !== 'string' ? raw.x : raw.xRange ?? raw.domain ?? (raw.xMin !== undefined ? [raw.xMin, raw.xMax] : undefined)
  const ySource = raw.y !== undefined && typeof raw.y !== 'string' ? raw.y : raw.yRange ?? (raw.yMin !== undefined ? [raw.yMin, raw.yMax] : undefined)
  const x = readRange(xSource) ?? (fns.some(fn => fn.kind === 'fx') ? [-5, 5] : null)
  const y = readRange(ySource)

  const points = []
  for (const point of list(raw.points ?? raw.marks, PLOT_LIMITS.points)) {
    const px = constantValue(point?.x)
    if (px === null) continue
    const py = constantValue(point?.y)
    const fn = py === null ? fxIndex(point?.fn, fns) : null
    if (py === null && fn === null) continue
    points.push({ x: px, ...(py === null ? { fn } : { y: py }), label: clip(point?.label ?? point?.name, 30) })
  }
  const lines = []
  for (const line of list(raw.lines ?? raw.guides, PLOT_LIMITS.lines)) {
    const lx = constantValue(line?.x)
    const ly = lx === null ? constantValue(line?.y) : null
    if (lx === null && ly === null) continue
    lines.push({ ...(lx === null ? { y: ly } : { x: lx }), label: clip(line?.label, 30) })
  }
  const shades = []
  for (const shade of list(raw.shade ?? raw.shades ?? raw.areas, PLOT_LIMITS.shades)) {
    const fn = fxIndex(shade?.fn, fns)
    const from = constantValue(shade?.from ?? shade?.a)
    const to = constantValue(shade?.to ?? shade?.b)
    if (fn === null || from === null || to === null || !(to > from)) continue
    const fn2 = fxIndex(shade?.fn2 ?? shade?.to_fn ?? shade?.below, fns, false)
    shades.push({ fn, from, to, ...(fn2 !== null && fn2 !== fn ? { fn2 } : {}), label: clip(shade?.label, 30) })
  }
  const tangents = []
  for (const tangent of list(raw.tangents ?? raw.tangent, PLOT_LIMITS.tangents)) {
    const fn = fxIndex(tangent?.fn, fns)
    const at = constantValue(tangent?.x ?? tangent?.at)
    if (fn === null || at === null) continue
    tangents.push({ fn, x: at, label: clip(tangent?.label, 30) })
  }

  return {
    title: clip(raw.title, 120),
    caption: clip(raw.caption, 200),
    x: x ? { min: x[0], max: x[1] } : null,
    y: y ? { min: y[0], max: y[1] } : null,
    xLabel: clip(raw.xLabel ?? raw.x?.label, 40),
    yLabel: clip(raw.yLabel ?? raw.y?.label, 40),
    // π on the x axis: the range was written with it, or curves of an angle.
    xPi: mentionsPi(JSON.stringify(xSource ?? '')) || (x !== null && isPiMultiple(x[0]) && isPiMultiple(x[1]) && !(Number.isInteger(x[0]) && Number.isInteger(x[1]))),
    equal: raw.equal === true || raw.aspect === 'equal',
    fns,
    params,
    points,
    lines,
    shades,
    tangents,
  }
}

const isPiMultiple = value => Math.abs(value / (Math.PI / 4) - Math.round(value / (Math.PI / 4))) < 1e-3

// ── evaluating ─────────────────────────────────────────────────────────────

// Each curve compiled once: evaluate(kindValue, paramValues) per formula.
export function compilePlot(plot) {
  const paramNames = plot.params.map(param => param.name)
  return plot.fns.map(fn => {
    const variables = curveVariables(fn.kind, paramNames)
    const names = [...variables, ...paramNames]
    const build = source => {
      const run = compileExpr(parseExpr(source, names), names)
      const slots = new Array(names.length).fill(0)
      return (value, params) => {
        for (let index = 0; index < variables.length; index += 1) slots[index] = value
        for (let index = 0; index < params.length; index += 1) slots[variables.length + index] = params[index]
        return run(slots)
      }
    }
    if (fn.kind === 'polar') {
      const r = build(fn.r)
      return { kind: 'polar', at: (theta, params) => { const radius = r(theta, params); return [radius * Math.cos(theta), radius * Math.sin(theta)] } }
    }
    if (fn.kind === 'param') {
      const x = build(fn.x)
      const y = build(fn.y)
      return { kind: 'param', at: (t, params) => [x(t, params), y(t, params)] }
    }
    const y = build(fn.y)
    return { kind: 'fx', y, at: (value, params) => [value, y(value, params)] }
  })
}

export const defaultValues = plot => plot.params.map(param => param.value)

// The points of every curve for these parameter values, in world
// coordinates; NaN where a curve is undefined.
export function sampleCurves(plot, compiled, params, xRange = plot.x) {
  return plot.fns.map((fn, index) => {
    const curve = compiled[index]
    const [from, to] = fn.kind === 'fx'
      ? [Math.max(xRange?.min ?? -5, fn.domain?.[0] ?? -Infinity), Math.min(xRange?.max ?? 5, fn.domain?.[1] ?? Infinity)]
      : fn.t
    const count = fn.kind === 'fx' ? PLOT_LIMITS.samples : PLOT_LIMITS.samples * 1.5
    const points = []
    if (!(to > from)) return points
    for (let step = 0; step <= count; step += 1) points.push(curve.at(from + ((to - from) * step) / count, params))
    return points
  })
}

// The slope of y = f(x) at x, numerically.
export function slopeAt(curve, x, params, span = 1) {
  const h = Math.max(1e-7, Math.abs(span) * 1e-5)
  return (curve.y(x + h, params) - curve.y(x - h, params)) / (2 * h)
}

function percentile(sorted, share) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)))]
}

// Ranges for the axes the plot leaves open, wide enough for every slider
// position, so dragging a slider moves the curve rather than the axes. A
// curve that shoots off (tan x, 1/x) is cut back to where most of it lies.
export function plotBounds(plot, compiled = compilePlot(plot)) {
  const combos = [[]]
  for (const param of plot.params) {
    const next = []
    for (const combo of combos) for (const value of new Set([param.min, param.value, param.max])) next.push([...combo, value])
    combos.splice(0, combos.length, ...next)
  }
  const xs = []
  const ys = []
  for (const combo of combos) {
    for (const points of sampleCurves(plot, compiled, combo)) {
      for (const [x, y] of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        xs.push(x)
        ys.push(y)
      }
    }
  }
  for (const point of plot.points) if (Number.isFinite(point.y)) ys.push(point.y)
  for (const line of plot.lines) if (line.y !== undefined) ys.push(line.y)
  const span = (values, fallback) => {
    if (!values.length) return fallback
    const sorted = [...values].sort((a, b) => a - b)
    let [low, high] = [sorted[0], sorted[sorted.length - 1]]
    const [inner, outer] = [percentile(sorted, 0.03), percentile(sorted, 0.97)]
    // Asymptotes: keep the bulk of the curve.
    if (high - low > 6 * Math.max(1e-9, outer - inner)) [low, high] = [inner, outer]
    if (high - low < 1e-9) [low, high] = [low - 1, high + 1]
    const pad = (high - low) * 0.08
    // Show the x axis when it is near.
    if (low > 0 && low < (high - low) * 0.35) low = 0
    if (high < 0 && -high < (high - low) * 0.35) high = 0
    return { min: low === 0 ? 0 : low - pad, max: high === 0 ? 0 : high + pad }
  }
  const x = plot.x ?? span(xs, { min: -5, max: 5 })
  const y = plot.y ?? span(ys, { min: -5, max: 5 })
  return { x: { min: x.min, max: x.max }, y: { min: Math.min(y.min, y.max - 1e-9), max: y.max } }
}

// ── reading a plot back ─────────────────────────────────────────────────────

function readable(source, plot) {
  try {
    const names = [...new Set([...Object.values(VARIABLES).flat(), ...plot.params.map(param => param.name)])]
    return exprToText(parseExpr(source, names))
  } catch {
    return source
  }
}

const number = value => {
  if (!Number.isFinite(value)) return String(value)
  const ratio = value / Math.PI
  if (value !== 0 && Math.abs(ratio * 4 - Math.round(ratio * 4)) < 1e-6) {
    const quarters = Math.round(ratio * 4)
    const [top, bottom] = quarters % 4 === 0 ? [quarters / 4, 1] : quarters % 2 === 0 ? [quarters / 2, 2] : [quarters, 4]
    const head = top === 1 ? 'π' : top === -1 ? '−π' : `${top}π`.replace('-', '−')
    return bottom === 1 ? head : `${head}/${bottom}`
  }
  return Number(value.toPrecision(4)).toString().replace('-', '−')
}

export const formatPlotNumber = number

// One line per curve, as a reader sees it: "y = A·sin(ωx), x from 0 to 8".
export function plotCurveLabels(plot) {
  return plot.fns.map(fn => {
    if (fn.kind === 'polar') return `r = ${readable(fn.r, plot)}`
    if (fn.kind === 'param') return `x = ${readable(fn.x, plot)}, y = ${readable(fn.y, plot)}`
    return `y = ${readable(fn.y, plot)}`
  })
}

// Plain text of a plot for notes and exports.
export function plotToText(plot) {
  const parts = [plot.title || plot.caption].filter(Boolean)
  const curves = plotCurveLabels(plot).map((label, index) => {
    const fn = plot.fns[index]
    const range = fn.kind === 'fx' ? (plot.x ? `, x ${number(fn.domain?.[0] ?? plot.x.min)} … ${number(fn.domain?.[1] ?? plot.x.max)}` : '') : `, ${fn.kind === 'polar' ? 'θ' : 't'} ${number(fn.t[0])} … ${number(fn.t[1])}`
    return `${fn.name ? `${fn.name}: ` : ''}${label}${range}`
  })
  parts.push(...curves)
  if (plot.params.length) parts.push(plot.params.map(param => `${param.label || param.name} = ${number(param.value)} (${number(param.min)} … ${number(param.max)})`).join('; '))
  return parts.join('\n')
}

// The plot as the model wrote it, for prompts that check or discuss it.
export function plotToSource(plot) {
  return JSON.stringify({
    fns: plot.fns.map(fn => Object.fromEntries(Object.entries(fn).filter(([, value]) => value !== '' && value !== undefined))),
    ...(plot.params.length ? { params: plot.params.map(({ name, value, min, max, label }) => ({ name, value, min, max, ...(label ? { label } : {}) })) } : {}),
    ...(plot.x ? { x: [plot.x.min, plot.x.max] } : {}),
    ...(plot.y ? { y: [plot.y.min, plot.y.max] } : {}),
    ...(plot.points.length ? { points: plot.points } : {}),
    ...(plot.lines.length ? { lines: plot.lines } : {}),
    ...(plot.shades.length ? { shade: plot.shades } : {}),
    ...(plot.tangents.length ? { tangents: plot.tangents } : {}),
    ...(plot.title ? { title: plot.title } : {}),
  })
}
