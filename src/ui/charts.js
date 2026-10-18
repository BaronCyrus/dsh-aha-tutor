// Charts on the board are drawn from data by this code, never by the model,
// so the numbers and the picture always agree. Output is a standalone SVG
// string: the board renders it, and the video exporter rasterizes it.

export const CHART_COLORS = Object.freeze(['#2f6fde', '#d64545', '#2f9e6e', '#e08a1e', '#7a4fd6', '#1f9bb4'])
const INK = '#2b2b2b'
const FONT = "'Segoe Print','Bradley Hand','Comic Sans MS','Kaiti SC','STKaiti','KaiTi',cursive"

export function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    const pad = Math.abs(min) || 1
    min -= pad / 2
    max += pad / 2
  }
  const span = max - min
  const step0 = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(step0))
  const error = step0 / power
  const step = (error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1) * power
  const start = Math.floor(min / step) * step
  const ticks = []
  for (let value = start; value <= max + step * 0.5; value += step) ticks.push(Number(value.toPrecision(12)))
  return ticks
}

function formatTick(value) {
  const abs = Math.abs(value)
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return value.toExponential(1)
  return Number(value.toPrecision(6)).toString()
}

function frame({ width, height, title, xLabel, yLabel }) {
  const margin = { top: title ? 34 : 16, right: 18, bottom: xLabel ? 50 : 34, left: yLabel ? 62 : 48 }
  return { margin, plotW: width - margin.left - margin.right, plotH: height - margin.top - margin.bottom }
}

function legend(names, width) {
  if (names.length < 2) return ''
  return names.map((name, index) => {
    const x = width - 150
    const y = 14 + index * 18
    return `<rect x="${x}" y="${y - 9}" width="14" height="4" rx="2" fill="${CHART_COLORS[index % CHART_COLORS.length]}"/><text x="${x + 20}" y="${y - 3}" font-size="12" fill="${INK}">${escapeXml(name)}</text>`
  }).join('')
}

function axes({ margin, plotW, plotH, width, height, xTicks, yTicks, xScale, yScale, xLabel, yLabel, xFormat = formatTick }) {
  const parts = []
  parts.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`)
  parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`)
  for (const tick of yTicks) {
    const y = yScale(tick)
    if (y < margin.top - 1 || y > margin.top + plotH + 1) continue
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="${INK}" stroke-opacity="0.08"/>`)
    parts.push(`<text x="${margin.left - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="${INK}">${escapeXml(formatTick(tick))}</text>`)
  }
  for (const tick of xTicks) {
    const x = xScale(tick)
    if (x < margin.left - 1 || x > margin.left + plotW + 1) continue
    parts.push(`<text x="${x}" y="${margin.top + plotH + 16}" font-size="11" text-anchor="middle" fill="${INK}">${escapeXml(xFormat(tick))}</text>`)
  }
  if (xLabel) parts.push(`<text x="${margin.left + plotW / 2}" y="${height - 10}" font-size="13" text-anchor="middle" fill="${INK}">${escapeXml(xLabel)}</text>`)
  if (yLabel) parts.push(`<text transform="translate(16 ${margin.top + plotH / 2}) rotate(-90)" font-size="13" text-anchor="middle" fill="${INK}">${escapeXml(yLabel)}</text>`)
  return parts.join('')
}

function xyChart(op, size) {
  const { width, height } = size
  const geometry = frame({ width, height, ...op })
  const { margin, plotW, plotH } = geometry
  const points = op.series.flatMap(series => series.points)
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs))
  const yTicks = niceTicks(Math.min(op.kind === 'area' ? 0 : Math.min(...ys), Math.min(...ys)), Math.max(...ys))
  const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]]
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]]
  const xScale = value => margin.left + ((value - x0) / (x1 - x0 || 1)) * plotW
  const yScale = value => margin.top + plotH - ((value - y0) / (y1 - y0 || 1)) * plotH
  const parts = [axes({ ...geometry, width, height, xTicks, yTicks, xScale, yScale, xLabel: op.xLabel, yLabel: op.yLabel })]
  op.series.forEach((series, index) => {
    const color = CHART_COLORS[index % CHART_COLORS.length]
    const sorted = op.kind === 'scatter' ? series.points : [...series.points].sort((a, b) => a[0] - b[0])
    if (op.kind === 'scatter') {
      for (const [x, y] of sorted) parts.push(`<circle cx="${xScale(x).toFixed(1)}" cy="${yScale(y).toFixed(1)}" r="3.6" fill="${color}" fill-opacity="0.8"/>`)
      return
    }
    const path = sorted.map(([x, y], pointIndex) => `${pointIndex ? 'L' : 'M'}${xScale(x).toFixed(1)} ${yScale(y).toFixed(1)}`).join(' ')
    if (op.kind === 'area') {
      const base = yScale(Math.max(y0, Math.min(0, y1)))
      parts.push(`<path d="${path} L${xScale(sorted[sorted.length - 1][0]).toFixed(1)} ${base} L${xScale(sorted[0][0]).toFixed(1)} ${base} Z" fill="${color}" fill-opacity="0.15" stroke="none"/>`)
    }
    parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`)
  })
  parts.push(legend(op.series.map(series => series.name || ''), width))
  return parts.join('')
}

function barChart(op, size) {
  const { width, height } = size
  const data = op.data.length ? op.data : (op.series[0]?.points ?? []).map(([x, y]) => ({ label: formatTick(x), value: y }))
  const geometry = frame({ width, height, ...op })
  const { margin, plotW, plotH } = geometry
  const values = data.map(item => item.value)
  const yTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]]
  const yScale = value => margin.top + plotH - ((value - y0) / (y1 - y0 || 1)) * plotH
  const band = plotW / Math.max(1, data.length)
  const parts = [axes({ ...geometry, width, height, xTicks: [], yTicks, xScale: () => 0, yScale, xLabel: op.xLabel, yLabel: op.yLabel })]
  data.forEach((item, index) => {
    const x = margin.left + index * band + band * 0.18
    const top = yScale(Math.max(0, item.value))
    const bottom = yScale(Math.min(0, item.value))
    const color = CHART_COLORS[index % CHART_COLORS.length]
    parts.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(band * 0.64).toFixed(1)}" height="${Math.max(1, bottom - top).toFixed(1)}" rx="3" fill="${color}" fill-opacity="0.78" stroke="${color}" stroke-width="1.4"/>`)
    const label = item.label.length > 10 ? `${item.label.slice(0, 9)}…` : item.label
    parts.push(`<text x="${(x + band * 0.32).toFixed(1)}" y="${margin.top + plotH + 16}" font-size="11" text-anchor="middle" fill="${INK}">${escapeXml(label)}</text>`)
    parts.push(`<text x="${(x + band * 0.32).toFixed(1)}" y="${(top - 5).toFixed(1)}" font-size="11" text-anchor="middle" fill="${INK}">${escapeXml(formatTick(item.value))}</text>`)
  })
  return parts.join('')
}

function pieChart(op, size) {
  const { width, height } = size
  const data = (op.data.length ? op.data : []).filter(item => item.value > 0)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (!total) return ''
  const cx = width * 0.36
  const cy = (height + (op.title ? 20 : 0)) / 2
  const radius = Math.min(width * 0.3, height * 0.38)
  let angle = -Math.PI / 2
  const parts = []
  data.forEach((item, index) => {
    const sweep = (item.value / total) * Math.PI * 2
    const end = angle + sweep
    const large = sweep > Math.PI ? 1 : 0
    const [sx, sy] = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
    const [ex, ey] = [cx + radius * Math.cos(end), cy + radius * Math.sin(end)]
    const color = CHART_COLORS[index % CHART_COLORS.length]
    const path = data.length === 1
      ? `M${cx - radius} ${cy} a${radius} ${radius} 0 1 0 ${radius * 2} 0 a${radius} ${radius} 0 1 0 ${-radius * 2} 0`
      : `M${cx} ${cy} L${sx.toFixed(1)} ${sy.toFixed(1)} A${radius} ${radius} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)} Z`
    parts.push(`<path d="${path}" fill="${color}" fill-opacity="0.75" stroke="#fff" stroke-width="2"/>`)
    const ly = 30 + index * 20
    parts.push(`<rect x="${width * 0.7}" y="${ly - 10}" width="12" height="12" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${width * 0.7 + 18}" y="${ly}" font-size="12" fill="${INK}">${escapeXml(item.label)} ${Math.round((item.value / total) * 100)}%</text>`)
    angle = end
  })
  return parts.join('')
}

export function chartSvg(op, size = { width: 480, height: 300 }) {
  let body = ''
  try {
    if (op.kind === 'pie') body = pieChart(op, size)
    else if (op.kind === 'bar') body = barChart(op, size)
    else if (op.series.length) body = xyChart(op, size)
    else body = barChart({ ...op, kind: 'bar' }, size)
  } catch {
    body = ''
  }
  const title = op.title ? `<text x="${size.width / 2}" y="20" font-size="15" text-anchor="middle" fill="${INK}" font-weight="600">${escapeXml(op.title)}</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}" font-family="${escapeXml(FONT)}">${title}${body}</svg>`
}
