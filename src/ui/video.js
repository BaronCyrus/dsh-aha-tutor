// Export an explainer short as a video. The board is redrawn on a canvas by
// its own renderer (DOM cannot be captured inside DSH), frame by frame along
// the same timeline the classroom uses, and recorded with MediaRecorder.
// Narration is mixed in through WebAudio when it comes from a cloud voice;
// system voices cannot be recorded, so those videos carry captions only.

import { estimateSpeechMs, stepTiming } from '../core/board-script.js'
import { parseInline } from './board/inline.js'
import { chartSvg } from './charts.js'
import { sanitizeSvg } from './sanitize.js'
import { BOARD_FONT } from './styles.js'

const W = 1280
const H = 720
const MARGIN = 64
const COL_GAP = 48
const COL_W = (W - MARGIN * 2 - COL_GAP) / 2
const TOP = 132
const BOTTOM = H - 118
const PALETTE = {
  light: { paper: '#fdfcf8', dot: 'rgba(40,50,80,0.07)', ink: '#23262f', soft: '#4a4f5c', head: '#1f4fb8', marker: 'rgba(255,214,79,0.62)', accent: '#d64545', note: '#fff7da', noteLine: '#e9c45a', pencil: '#c98a2c' },
  dark: { paper: '#1d2622', dot: 'rgba(255,255,255,0.06)', ink: '#ecebe4', soft: '#c9c8bf', head: '#9cc2ff', marker: 'rgba(214,178,58,0.45)', accent: '#ff8a80', note: '#2a3530', noteLine: '#8f7a2f', pencil: '#e7c27a' },
}

export function videoSupported() {
  if (typeof MediaRecorder !== 'function') return false
  const canvas = document.createElement('canvas')
  return typeof canvas.captureStream === 'function'
}

function pickMime() {
  for (const type of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' }
const SYMBOLS = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', infty: '∞', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftrightarrow: '⇔', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', partial: '∂', nabla: '∇', sqrt: '√', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', degree: '°', circ: '°', angle: '∠', perp: '⊥', parallel: '∥', ldots: '…', cdots: '⋯', dots: '…', propto: '∝', sim: '∼', hbar: 'ħ', ell: 'ℓ', quad: ' ', qquad: '  ' }
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', T: 'ᵀ' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', n: 'ₙ', x: 'ₓ', k: 'ₖ', t: 'ₜ' }

// Readable Unicode for common LaTeX, for canvas text.
export function texToText(tex) {
  let value = String(tex ?? '')
  for (let round = 0; round < 4; round += 1) {
    value = value.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/gu, (_, a, b) => `${a.length > 1 ? `(${a})` : a}/${b.length > 1 ? `(${b})` : b}`)
    value = value.replace(/\\sqrt\{([^{}]*)\}/gu, (_, a) => `√${a.length > 1 ? `(${a})` : a}`)
    value = value.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf)\{([^{}]*)\}/gu, '$1')
  }
  value = value.replace(/\\(left|right|big|Big|bigg|Bigg|displaystyle)\b/gu, '')
  value = value.replace(/\\([a-zA-Z]+)/gu, (match, word) => GREEK[word] ?? SYMBOLS[word] ?? word)
  value = value.replace(/\^\{([^{}]*)\}|\^(.)/gu, (_, group, single) => [...(group ?? single)].map(char => SUPER[char] ?? char).join(''))
  value = value.replace(/_\{([^{}]*)\}|_(.)/gu, (_, group, single) => [...(group ?? single)].map(char => SUB[char] ?? char).join(''))
  return value.replace(/\\[,;:! ]/gu, ' ').replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim()
}

function plainInline(textValue) {
  return parseInline(textValue).map(segment => (segment.kind === 'math' ? texToText(segment.tex) : segment.text)).join('')
}

function font(size, weight = 400) {
  return `${weight} ${size}px ${BOARD_FONT}`
}

// Punctuation that may not start a line, and brackets that may not end one.
const NO_LINE_START = /^[，。、；：！？）」』”’》〉】〕…‥·,.;:!?)\]}%]/u
const NO_LINE_END = /[（「『“‘《〈【〔(\[{]$/u

// Break text into lines that fit; CJK can break anywhere, Latin at spaces.
// Closing punctuation hangs at the end of the line rather than starting the
// next one, and an opening bracket moves down with what it opens.
export function wrap(ctx, textValue, width) {
  const lines = []
  for (const paragraph of String(textValue).split('\n')) {
    let line = ''
    const tokens = paragraph.match(/[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+|\s+/gu) ?? []
    for (const token of tokens) {
      const candidate = line + token
      if (ctx.measureText(candidate).width > width && line.trim() && !NO_LINE_START.test(token)) {
        let carry = ''
        if (NO_LINE_END.test(line) && line.length > 1) {
          carry = line.slice(-1)
          line = line.slice(0, -1)
        }
        lines.push(line.trimEnd())
        line = (carry + token).trimStart()
      } else {
        line = candidate
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

// The board restyles dark ink for the dark theme with CSS (styles.js); an
// SVG drawn as an image sees no page CSS, so it gets the same rules inline,
// and currentColor resolves to the board ink.
export function themedSvg(svg, palette, theme) {
  if (!svg) return svg
  const dark = theme === 'dark' ? `[stroke="#2b2b2b"],[stroke="#23262f"]{stroke:${palette.ink}}[fill="#2b2b2b"],[fill="#23262f"]{fill:${palette.ink}}` : ''
  const style = `<style>svg{color:${palette.ink}}text:not([fill]){fill:${palette.ink}}${dark}</style>`
  return svg.replace(/<svg\b[^>]*>/iu, open => (open.endsWith('/>') ? open : `${open}${style}`))
}

function loadImage(svg) {
  return new Promise(resolve => {
    if (!svg) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

async function layout(ctx, steps, palette, theme) {
  const items = []
  const pages = [{ title: '' }]
  let column = 0
  let y = TOP
  const x = () => MARGIN + column * (COL_W + COL_GAP)
  const newColumn = () => {
    if (column === 0) {
      column = 1
    } else {
      // A page that overflows continues under the same heading.
      const previous = pages[pages.length - 1]
      pages.push({ title: previous.title, inherits: previous.inherits ?? pages.length === 1 })
      column = 0
    }
    y = TOP
  }
  const place = (height, item) => {
    if (y > TOP && y + height > BOTTOM) newColumn()
    items.push({ ...item, page: pages.length - 1, x: x(), y, h: height })
    y += height + 14
  }
  for (const [stepIndex, step] of steps.entries()) {
    for (const [opIndex, op] of step.ops.entries()) {
      const base = { op, stepIndex, opIndex }
      if (op.t === 'page') {
        if (items.some(item => item.page === pages.length - 1)) { pages.push({ title: op.title ?? '' }); column = 0; y = TOP } else pages[pages.length - 1].title = op.title ?? ''
        continue
      }
      if (op.t === 'col') { newColumn(); continue }
      if (op.t === 'mark') continue
      if (op.t === 'title') {
        if (items.some(item => item.page === pages.length - 1)) { pages.push({ title: op.text }); column = 0; y = TOP } else pages[pages.length - 1].title = op.text
        items.push({ ...base, page: pages.length - 1, kind: 'title', text: plainInline(op.text) })
        continue
      }
      if (op.t === 'h' || op.t === 'p' || op.t === 'note' || op.t === 'math' || op.t === 'list') {
        const size = op.t === 'h' ? 31 : op.t === 'math' ? 28 : 25
        ctx.font = font(size, op.t === 'h' ? 700 : 400)
        const raw = op.t === 'math' ? op.text || texToText(op.tex) : op.t === 'list' ? op.items.map((item, index) => `${op.ordered ? `${index + 1}.` : '•'} ${plainInline(item)}`).join('\n') : plainInline(op.text)
        const lines = wrap(ctx, raw, COL_W - (op.t === 'note' ? 28 : 0))
        const lineHeight = Math.round(size * 1.42)
        place(lines.length * lineHeight + (op.t === 'note' ? 22 : 0), { ...base, kind: 'text', size, weight: op.t === 'h' ? 700 : 400, lines, lineHeight, color: op.t === 'h' ? palette.head : palette.ink, center: op.t === 'math', note: op.t === 'note', marker: op.t === 'h' })
        continue
      }
      const still = op.t === 'chart' ? chartSvg(op) : op.t === 'svg' ? sanitizeSvg(op.svg) : op.t === 'anim' && op.poster ? sanitizeSvg(op.poster) : ''
      const image = still ? await loadImage(themedSvg(still, palette, theme)) : null
      if (image) {
        const ratio = image.naturalHeight / Math.max(1, image.naturalWidth) || 0.62
        const width = Math.min(COL_W, image.naturalWidth || COL_W)
        const height = Math.min(300, width * ratio)
        place(height + (op.caption ? 30 : 0), { ...base, kind: 'image', image, w: height / ratio, imageH: height, caption: op.caption ?? '' })
        continue
      }
      if (op.t === 'svg' || op.t === 'chart') continue
      if (op.t === 'table') {
        const rows = [op.head, ...op.rows].filter(row => row.length).slice(0, 10)
        place(rows.length * 34 + 6, { ...base, kind: 'table', rows })
        continue
      }
      if (op.t === 'code') {
        const lines = op.code.split('\n').slice(0, 14)
        place(lines.length * 24 + 20, { ...base, kind: 'code', lines })
        continue
      }
      if (op.t === 'anim') {
        place(90, { ...base, kind: 'text', size: 22, weight: 400, lines: [`▶ ${op.caption || 'animation'}`], lineHeight: 32, color: palette.soft, note: true })
      }
    }
  }
  return { items, pages }
}

function drawPaper(ctx, palette) {
  ctx.fillStyle = palette.paper
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = palette.dot
  for (let x = 12; x < W; x += 24) for (let y = 12; y < H; y += 24) ctx.fillRect(x, y, 1.6, 1.6)
}

function drawPencil(ctx, x, y, palette) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.6)
  ctx.fillStyle = palette.pencil
  ctx.fillRect(0, -5, 34, 10)
  ctx.fillStyle = palette.accent
  ctx.fillRect(34, -5, 7, 10)
  ctx.beginPath()
  ctx.moveTo(0, -5)
  ctx.lineTo(-10, 0)
  ctx.lineTo(0, 5)
  ctx.closePath()
  ctx.fillStyle = palette.ink
  ctx.fill()
  ctx.restore()
}

function drawItem(ctx, item, progress, palette) {
  if (item.kind === 'title') return
  if (item.kind === 'text') {
    ctx.font = font(item.size, item.weight)
    ctx.textBaseline = 'top'
    if (item.note) {
      ctx.fillStyle = palette.note
      ctx.strokeStyle = palette.noteLine
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect?.(item.x, item.y, COL_W, item.h, 12)
      ctx.fill()
      ctx.stroke()
    }
    const total = item.lines.reduce((sum, line) => sum + [...line].length, 0)
    let budget = Math.floor(total * progress)
    let pencil = null
    item.lines.forEach((line, index) => {
      if (budget <= 0) return
      const chars = [...line]
      const shown = chars.slice(0, budget).join('')
      budget -= chars.length
      const width = ctx.measureText(shown).width
      const left = item.center ? item.x + (COL_W - ctx.measureText(line).width) / 2 : item.x + (item.note ? 14 : 0)
      const top = item.y + (item.note ? 11 : 0) + index * item.lineHeight
      if (item.marker) {
        ctx.fillStyle = palette.marker
        ctx.fillRect(left - 2, top + item.size * 0.62, width + 4, item.size * 0.38)
      }
      ctx.fillStyle = item.color
      ctx.fillText(shown, left, top)
      pencil = { x: left + width, y: top + item.size }
    })
    if (pencil && progress < 1) drawPencil(ctx, pencil.x, pencil.y, palette)
    return
  }
  if (item.kind === 'image') {
    ctx.save()
    ctx.beginPath()
    ctx.rect(item.x, item.y, item.w * progress, item.imageH)
    ctx.clip()
    ctx.drawImage(item.image, item.x, item.y, item.w, item.imageH)
    ctx.restore()
    if (item.caption && progress >= 1) {
      ctx.font = font(18)
      ctx.fillStyle = palette.soft
      ctx.textBaseline = 'top'
      ctx.fillText(item.caption, item.x, item.y + item.imageH + 6)
    }
    if (progress < 1) drawPencil(ctx, item.x + item.w * progress, item.y + item.imageH / 2, palette)
    return
  }
  if (item.kind === 'table') {
    const rows = item.rows.slice(0, Math.max(1, Math.ceil(item.rows.length * progress)))
    const cols = Math.max(...item.rows.map(row => row.length))
    const cell = COL_W / Math.max(1, cols)
    ctx.font = font(19)
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = palette.soft
    ctx.lineWidth = 1.4
    rows.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const x = item.x + colIndex * cell
        const y = item.y + rowIndex * 34
        ctx.strokeRect(x, y, cell, 34)
        ctx.fillStyle = rowIndex === 0 ? palette.head : palette.ink
        let label = plainInline(value)
        while (label.length > 1 && ctx.measureText(label).width > cell - 12) label = `${label.slice(0, -2)}…`
        ctx.fillText(label, x + 6, y + 17)
      })
    })
    return
  }
  if (item.kind === 'code') {
    ctx.fillStyle = 'rgba(0,0,0,0.06)'
    ctx.fillRect(item.x, item.y, COL_W, item.h)
    ctx.font = '17px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
    ctx.fillStyle = palette.ink
    ctx.textBaseline = 'top'
    item.lines.slice(0, Math.ceil(item.lines.length * progress)).forEach((line, index) => ctx.fillText(line.slice(0, 60), item.x + 10, item.y + 10 + index * 24))
  }
}

function drawCaption(ctx, textValue) {
  if (!textValue) return
  ctx.font = `500 25px ${BOARD_FONT}`
  const lines = wrap(ctx, textValue, W - 200).slice(-2)
  const height = lines.length * 34 + 24
  ctx.fillStyle = 'rgba(15,18,24,0.72)'
  ctx.beginPath()
  ctx.roundRect?.(80, H - height - 18, W - 160, height, 14)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, (W - ctx.measureText(line).width) / 2, H - height - 6 + index * 34))
}

function drawWatermark(ctx, label, palette) {
  ctx.font = `600 17px ${BOARD_FONT}`
  ctx.fillStyle = palette.soft
  ctx.globalAlpha = 0.65
  ctx.textBaseline = 'top'
  ctx.fillText(label, W - ctx.measureText(label).width - 26, 22)
  ctx.globalAlpha = 1
}

// fetchAudio(text) → { blob } | { base64, mime } (cloud voice) or null to
// export silently.
export async function exportVideo({ steps, title, fetchAudio, watermark, theme = 'light', onProgress, signal }) {
  if (!videoSupported()) throw new Error('unsupported')
  const palette = PALETTE[theme] ?? PALETTE.light
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const { items, pages } = await layout(ctx, steps, palette, theme)

  let audioCtx = null
  const buffers = []
  if (fetchAudio) {
    audioCtx = new AudioContext()
    for (const [index, step] of steps.entries()) {
      signal?.throwIfAborted()
      onProgress?.({ phase: 'audio', done: index, total: steps.length })
      if (!step.say) {
        buffers.push(null)
        continue
      }
      try {
        const audio = await fetchAudio(step.say)
        const bytes = audio.blob ? await audio.blob.arrayBuffer() : Uint8Array.from(atob(audio.base64), char => char.charCodeAt(0)).buffer
        buffers.push(await audioCtx.decodeAudioData(bytes))
      } catch {
        buffers.push(null)
      }
    }
  }

  const timeline = []
  let cursor = 700
  for (const [index, step] of steps.entries()) {
    const speechMs = buffers[index] ? buffers[index].duration * 1000 : estimateSpeechMs(step.say)
    const timing = stepTiming(step, { speechMs })
    timeline.push({ start: cursor, end: cursor + timing.durationMs, writes: timing.writeMs })
    cursor += timing.durationMs
  }
  const total = cursor + 1500

  const position = time => {
    let index = timeline.findIndex(entry => time < entry.end)
    if (index < 0) return { index: steps.length, op: 0, progress: 1 }
    const entry = timeline[index]
    const elapsed = Math.max(0, time - entry.start)
    let acc = 0
    for (let op = 0; op < entry.writes.length; op += 1) {
      if (elapsed < acc + entry.writes[op]) return { index, op, progress: (elapsed - acc) / Math.max(1, entry.writes[op]) }
      acc += entry.writes[op]
    }
    return { index, op: entry.writes.length, progress: 1 }
  }

  const draw = time => {
    const at = position(time)
    const reveal = item => (item.stepIndex < at.index ? 1 : item.stepIndex > at.index ? 0 : item.opIndex < at.op ? 1 : item.opIndex > at.op ? 0 : at.progress)
    const visible = items.filter(item => reveal(item) > 0)
    const page = visible.length ? Math.max(...visible.map(item => item.page)) : 0
    drawPaper(ctx, palette)
    const pageTitle = pages[page]?.title || (page === 0 || pages[page]?.inherits ? title : '')
    if (pageTitle) {
      ctx.font = font(40, 700)
      ctx.textBaseline = 'top'
      const width = ctx.measureText(pageTitle).width
      ctx.fillStyle = palette.marker
      ctx.fillRect(MARGIN - 4, 74, width + 8, 18)
      ctx.fillStyle = palette.head
      ctx.fillText(pageTitle, MARGIN, 52)
    }
    for (const item of visible) if (item.page === page) drawItem(ctx, item, reveal(item), palette)
    drawCaption(ctx, at.index < steps.length ? plainInline(steps[at.index].say) : '')
    if (watermark) drawWatermark(ctx, watermark, palette)
  }

  draw(0)
  const stream = canvas.captureStream(30)
  let startAt = 0
  if (audioCtx) {
    await audioCtx.resume()
    const destination = audioCtx.createMediaStreamDestination()
    startAt = audioCtx.currentTime + 0.4
    buffers.forEach((buffer, index) => {
      if (!buffer) return
      const source = audioCtx.createBufferSource()
      source.buffer = buffer
      source.connect(destination)
      source.start(startAt + timeline[index].start / 1000)
    })
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)
  }
  const mimeType = pickMime()
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000 })
  const chunks = []
  recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
  const stopped = new Promise(resolve => { recorder.onstop = resolve })
  recorder.start(1000)
  const startedAt = performance.now()
  const clock = () => (audioCtx ? (audioCtx.currentTime - startAt) * 1000 : performance.now() - startedAt)

  await new Promise((resolve, reject) => {
    const frame = () => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('cancelled'))
        return
      }
      const time = clock()
      draw(Math.max(0, time))
      onProgress?.({ phase: 'record', done: Math.min(total, Math.max(0, time)), total })
      if (time >= total) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }).finally(() => {
    if (recorder.state !== 'inactive') recorder.stop()
  })
  await stopped
  for (const track of stream.getTracks()) track.stop()
  await audioCtx?.close().catch(() => undefined)
  return new Blob(chunks, { type: mimeType || 'video/webm' })
}
