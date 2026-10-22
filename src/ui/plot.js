// Function plots drawn the way a textbook draws them: axes through the
// origin with arrows, π on the axis of an angle, the formula beside its
// curve. Every point is computed here from the plot's formulas (core/plot.js)
// for the current slider values. Output is a standalone SVG string, like a
// chart: the board renders it, exports and videos rasterize it.

import { compilePlot, defaultValues, formatPlotNumber, plotBounds, plotCurveLabels, sampleCurves, slopeAt } from '../core/plot.js'
import { CHART_COLORS, CHART_FONT, CHART_INK, escapeXml, niceTicks } from './charts.js'

const GUIDE = '#2b2b2b'
const TANGENT = '#e08a1e'
const fixed = value => value.toFixed(1)

// The parts of a plot that do not depend on the sliders, computed once.
export function preparePlot(op) {
  try {
    const compiled = compilePlot(op)
    return { compiled, bounds: plotBounds(op, compiled), labels: plotCurveLabels(op) }
  } catch {
    return null
  }
}

// The segment from a to b inside the box, or null (Liang–Barsky).
function clipSegment(a, b, box) {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - box.left], [dx, box.right - a[0]], [-dy, a[1] - box.top], [dy, box.bottom - a[1]]]) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]]
}

// Screen points into path runs, cut at the box, at gaps and where a curve
// leaps from one side of the box to the other (an asymptote).
function runsOf(points, box) {
  const runs = []
  let run = null
  const height = box.bottom - box.top
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) {
      run = null
      continue
    }
    const leaps = (a[1] < box.top - height && b[1] > box.bottom + height) || (b[1] < box.top - height && a[1] > box.bottom + height)
    const clipped = leaps ? null : clipSegment(a, b, box)
    if (!clipped) {
      run = null
      continue
    }
    const [start, end] = clipped
    const last = run?.[run.length - 1]
    if (!last || Math.abs(last[0] - start[0]) > 0.05 || Math.abs(last[1] - start[1]) > 0.05) {
      run = [start]
      runs.push(run)
    }
    run.push(end)
  }
  return runs.filter(item => item.length > 1)
}

const pathOf = runs => runs.map(run => run.map(([x, y], index) => `${index ? 'L' : 'M'}${fixed(x)} ${fixed(y)}`).join(' ')).join(' ')

// Ticks at multiples of π/4, π/2, π or 2π: the finest that gives at most 9.
function piTicks(min, max) {
  for (const step of [Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI]) {
    const first = Math.ceil(min / step - 1e-9)
    const last = Math.floor(max / step + 1e-9)
    if (last - first + 1 <= 9) {
      const ticks = []
      for (let k = first; k <= last; k += 1) ticks.push(k * step)
      return ticks
    }
  }
  return niceTicks(min, max)
}

const label = value => formatPlotNumber(Math.abs(value) < 1e-12 ? 0 : value)

// About how wide a label is drawn, in the board's handwriting.
const textWidth = (content, size) => [...String(content)].reduce((sum, char) => sum + (/[\u2E80-\uFFFF]/u.test(char) ? size * 1.05 : size * 0.58), 0)

// values: one per slider, in the plot's order (defaults when left out).
// A board column is about 300 px wide at 100 %, so a plot is drawn small
// with large lettering.
export function plotSvg(op, values = defaultValues(op), { width = 420, height = 290, prepared = preparePlot(op) } = {}) {
  if (!prepared) return ''
  const params = op.params.map((param, index) => Math.min(param.max, Math.max(param.min, Number.isFinite(values[index]) ? values[index] : param.value)))
  let { x: { min: x0, max: x1 }, y: { min: y0, max: y1 } } = prepared.bounds
  // Several curves get a key above the plot, wrapped into rows.
  const names = op.fns.map((fn, index) => fn.name || prepared.labels[index])
  const legend = []
  if (op.fns.length > 1) {
    let row = 0
    let at = 36
    names.forEach((name, index) => {
      const size = 24 + textWidth(name, 13)
      if (at + size > width - 12 && at > 36) {
        row += 1
        at = 36
      }
      legend.push({ index, name, row, x: at })
      at += size + 16
    })
  }
  const legendRows = legend.length ? legend[legend.length - 1].row + 1 : 0
  const head = (op.title ? 28 : 0) + legendRows * 19
  const margin = { top: head + 20, right: 30, bottom: 32, left: 40 }
  // Equal scales: the height follows the ranges, within limits, and the
  // range with room to spare widens so a circle stays round.
  if (op.equal) {
    const wanted = margin.top + margin.bottom + ((width - margin.left - margin.right) * (y1 - y0)) / (x1 - x0)
    height = Math.round(Math.min(440, Math.max(220, wanted)))
    const plotW = width - margin.left - margin.right
    const plotH = height - margin.top - margin.bottom
    const scale = Math.min(plotW / (x1 - x0), plotH / (y1 - y0))
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2]
    ;[x0, x1] = [cx - plotW / scale / 2, cx + plotW / scale / 2]
    ;[y0, y1] = [cy - plotH / scale / 2, cy + plotH / scale / 2]
  }
  const box = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom }
  const sx = x => box.left + ((x - x0) / (x1 - x0)) * (box.right - box.left)
  const sy = y => box.bottom - ((y - y0) / (y1 - y0)) * (box.bottom - box.top)
  const screen = ([x, y]) => [sx(x), sy(y)]
  const color = index => CHART_COLORS[index % CHART_COLORS.length]
  const shapes = []
  const texts = []
  const text = (x, y, content, { size = 13, anchor = 'middle', fill = CHART_INK, italic = false, weight } = {}) => {
    texts.push(`<text x="${fixed(x)}" y="${fixed(y)}" font-size="${size}" text-anchor="${anchor}" fill="${fill}"${italic ? ' font-style="italic"' : ''}${weight ? ` font-weight="${weight}"` : ''}>${escapeXml(content)}</text>`)
  }

  // Axes through the origin, or along the edge the origin lies beyond.
  const axisY = y0 <= 0 && y1 >= 0 ? sy(0) : y0 > 0 ? box.bottom : box.top
  const axisX = x0 <= 0 && x1 >= 0 ? sx(0) : x0 > 0 ? box.left : box.right
  shapes.push(`<line x1="${fixed(box.left - 4)}" y1="${fixed(axisY)}" x2="${fixed(box.right + 14)}" y2="${fixed(axisY)}" stroke="${CHART_INK}" stroke-width="1.5" stroke-linecap="round"/>`)
  shapes.push(`<path d="M${fixed(box.right + 16)} ${fixed(axisY)} l-9 -4 l2 4 l-2 4 Z" fill="${CHART_INK}" stroke="${CHART_INK}" stroke-width="1" stroke-linejoin="round"/>`)
  shapes.push(`<line x1="${fixed(axisX)}" y1="${fixed(box.bottom + 4)}" x2="${fixed(axisX)}" y2="${fixed(box.top - 10)}" stroke="${CHART_INK}" stroke-width="1.5" stroke-linecap="round"/>`)
  shapes.push(`<path d="M${fixed(axisX)} ${fixed(box.top - 12)} l-4 9 l4 -2 l4 2 Z" fill="${CHART_INK}" stroke="${CHART_INK}" stroke-width="1" stroke-linejoin="round"/>`)
  // The axis names sit by the arrow tips, clear of the tick labels.
  text(box.right + 16, axisY < box.top + 16 ? axisY + 18 : axisY - 8, op.xLabel || 'x', { size: 15, italic: !op.xLabel, anchor: 'end' })
  text(axisX + 8, box.top - 2, op.yLabel || 'y', { size: 15, italic: !op.yLabel, anchor: 'start' })
  const origin = x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0
  if (origin) text(axisX - 8, axisY + 17, 'O', { size: 13, italic: true })
  const xTicks = (op.xPi ? piTicks(x0, x1) : niceTicks(x0, x1, 6)).filter(value => value >= x0 - 1e-9 && value <= x1 + 1e-9)
  for (const tick of xTicks) {
    if (origin && Math.abs(tick) < 1e-12) continue
    const x = sx(tick)
    if (Math.abs(x - axisX) < 3 && !origin) continue
    shapes.push(`<line x1="${fixed(x)}" y1="${fixed(axisY - 3)}" x2="${fixed(x)}" y2="${fixed(axisY + 3)}" stroke="${CHART_INK}" stroke-width="1.2"/>`)
    text(x, axisY + 18, label(tick), { size: 12.5 })
  }
  for (const tick of niceTicks(y0, y1, 5).filter(value => value >= y0 - 1e-9 && value <= y1 + 1e-9)) {
    if (origin && Math.abs(tick) < 1e-12) continue
    const y = sy(tick)
    shapes.push(`<line x1="${fixed(axisX - 3)}" y1="${fixed(y)}" x2="${fixed(axisX + 3)}" y2="${fixed(y)}" stroke="${CHART_INK}" stroke-width="1.2"/>`)
    text(axisX - 6, y + 4.5, label(tick), { size: 12.5, anchor: 'end' })
  }

  const curves = sampleCurves(op, prepared.compiled, params, { min: x0, max: x1 })
  const fx = index => prepared.compiled[index]

  // Shaded areas, under a curve or between two.
  for (const shade of op.shades) {
    const steps = 120
    const top = []
    const bottom = []
    for (let step = 0; step <= steps; step += 1) {
      const x = shade.from + ((shade.to - shade.from) * step) / steps
      const yTop = fx(shade.fn).y(x, params)
      const yBottom = shade.fn2 === undefined ? 0 : fx(shade.fn2).y(x, params)
      if (!Number.isFinite(yTop) || !Number.isFinite(yBottom)) continue
      const clamp = y => Math.min(y1, Math.max(y0, y))
      top.push([sx(x), sy(clamp(yTop))])
      bottom.push([sx(x), sy(clamp(yBottom))])
    }
    if (top.length < 2) continue
    const outline = [...top, ...bottom.reverse()].map(([x, y], index) => `${index ? 'L' : 'M'}${fixed(x)} ${fixed(y)}`).join(' ')
    shapes.push(`<path d="${outline} Z" fill="${color(shade.fn)}" fill-opacity="0.18" stroke="none"/>`)
    if (shade.label) {
      const middle = Math.floor(top.length / 2)
      let x = top[middle][0]
      // Off the y axis, whose tick labels sit there.
      if (Math.abs(x - axisX) < 28) x = axisX + 28
      text(x, Math.min(box.bottom - 6, top[middle][1] + (bottom[middle][1] - top[middle][1]) * 0.6 + 4), shade.label, { size: 13, fill: color(shade.fn), weight: 600 })
    }
  }

  // The curves.
  const ends = []
  curves.forEach((points, index) => {
    const runs = runsOf(points.map(screen), box)
    if (runs.length) shapes.push(`<path d="${pathOf(runs)}" fill="none" stroke="${color(index)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`)
    const lastRun = runs[runs.length - 1]
    ends.push(lastRun ? lastRun[lastRun.length - 1] : null)
  })

  // Dashed guides: asymptotes, axes of symmetry, x = a, y = b.
  for (const line of op.lines) {
    if (line.x !== undefined) {
      if (line.x < x0 || line.x > x1) continue
      const x = sx(line.x)
      shapes.push(`<line x1="${fixed(x)}" y1="${fixed(box.top)}" x2="${fixed(x)}" y2="${fixed(box.bottom)}" stroke="${GUIDE}" stroke-opacity="0.55" stroke-width="1.3" stroke-dasharray="6 5"/>`)
      if (line.label) text(x + 5, box.top + 12, line.label, { size: 13, anchor: 'start' })
    } else {
      if (line.y < y0 || line.y > y1) continue
      const y = sy(line.y)
      shapes.push(`<line x1="${fixed(box.left)}" y1="${fixed(y)}" x2="${fixed(box.right)}" y2="${fixed(y)}" stroke="${GUIDE}" stroke-opacity="0.55" stroke-width="1.3" stroke-dasharray="6 5"/>`)
      if (line.label) text(box.right - 2, y - 5, line.label, { size: 13, anchor: 'end' })
    }
  }

  // Tangents, from the slope of the curve where they touch.
  for (const tangent of op.tangents) {
    const curve = fx(tangent.fn)
    const y = curve.y(tangent.x, params)
    const slope = slopeAt(curve, tangent.x, params, x1 - x0)
    if (!Number.isFinite(y) || !Number.isFinite(slope)) continue
    const reach = (x1 - x0) * 0.24
    const segment = clipSegment(screen([tangent.x - reach, y - slope * reach]), screen([tangent.x + reach, y + slope * reach]), box)
    if (!segment) continue
    shapes.push(`<line x1="${fixed(segment[0][0])}" y1="${fixed(segment[0][1])}" x2="${fixed(segment[1][0])}" y2="${fixed(segment[1][1])}" stroke="${TANGENT}" stroke-width="1.8" stroke-linecap="round"/>`)
    const [px, py] = screen([tangent.x, y])
    if (px >= box.left && px <= box.right && py >= box.top && py <= box.bottom) shapes.push(`<circle cx="${fixed(px)}" cy="${fixed(py)}" r="3.2" fill="${TANGENT}"/>`)
    if (tangent.label) {
      // Past the tangent's right end, on the side away from the curve.
      const [endX, endY] = segment[1]
      const curveY = sy(curve.y(x0 + ((endX - box.left) / (box.right - box.left)) * (x1 - x0), params))
      const below = Number.isFinite(curveY) ? curveY < endY : false
      const wide = textWidth(tangent.label, 13)
      const y = below ? Math.min(box.bottom - 4, endY + 14) : Math.max(box.top + 12, endY - 6)
      if (endX + 6 + wide <= box.right + 24) text(endX + 6, y, tangent.label, { size: 13, anchor: 'start', fill: TANGENT })
      else text(endX - 6, below ? Math.min(box.bottom - 4, endY + 28) : y, tangent.label, { size: 13, anchor: 'end', fill: TANGENT })
    }
  }

  // Points, on a curve unless given a y of their own.
  for (const point of op.points) {
    const y = point.y ?? fx(point.fn).y(point.x, params)
    if (!Number.isFinite(y)) continue
    const [px, py] = screen([point.x, y])
    if (px < box.left - 1 || px > box.right + 1 || py < box.top - 1 || py > box.bottom + 1) continue
    shapes.push(`<circle cx="${fixed(px)}" cy="${fixed(py)}" r="3.8" fill="${point.fn === undefined ? CHART_INK : color(point.fn)}"/>`)
    if (point.label) {
      const right = px > box.right - 90
      text(px + (right ? -7 : 7), py - 8 < box.top + 10 ? py + 18 : py - 8, point.label, { size: 13, anchor: right ? 'end' : 'start' })
    }
  }

  // One curve has its formula (or name) beside it; several get the key.
  for (const entry of legend) {
    const y = (op.title ? 28 : 0) + 12 + entry.row * 18
    shapes.push(`<rect x="${fixed(entry.x)}" y="${fixed(y - 6)}" width="16" height="4" rx="2" fill="${color(entry.index)}"/>`)
    text(entry.x + 22, y, entry.name, { size: 13, anchor: 'start' })
  }
  if (!legend.length && ends[0]) {
    const [ex, ey] = ends[0]
    const left = ex > box.left + (box.right - box.left) * 0.55
    text(left ? Math.min(ex - 4, box.right - 2) : ex + 6, Math.max(box.top + 12, Math.min(box.bottom - 6, ey - 10)), names[0], { size: 14, anchor: left ? 'end' : 'start', fill: color(0) })
  }

  const title = op.title ? `<text x="${width / 2}" y="20" font-size="15" text-anchor="middle" fill="${CHART_INK}" font-weight="600">${escapeXml(op.title)}</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${escapeXml(CHART_FONT)}">${shapes.join('')}${title}${texts.join('')}</svg>`
}
