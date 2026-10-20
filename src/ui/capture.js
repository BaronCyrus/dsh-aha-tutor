// Board pages as pictures, for PDF and PNG exports. BoardSheets lays every
// page out with the board's own components and styles in a hidden part of
// the document, so the handwriting fonts and KaTeX's fonts and layout are the
// real ones. This module reads that layout back (text runs with their fonts,
// backgrounds, borders, highlighter bands, list markers, SVG figures, and
// KaTeX's rules and strokes) and draws it on a canvas. It covers the CSS the
// board uses, not CSS at large.

const SVG_NS = 'http://www.w3.org/2000/svg'
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'])
const SIDES = ['Top', 'Right', 'Bottom', 'Left']
// Styles an SVG drawn as an image must carry itself: page CSS (the dark
// board's ink, KaTeX's currentColor fills) does not reach inside an image.
const SVG_STYLE = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline']
const DOT_STEP = 22

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function graphemes(value) {
  if (segmenter) return Array.from(segmenter.segment(value), part => ({ index: part.index, text: part.segment }))
  const out = []
  let index = 0
  for (const char of value) {
    out.push({ index, text: char })
    index += char.length
  }
  return out
}

export function visibleColor(color) {
  if (!color || color === 'transparent' || color === 'none') return false
  const match = /^(?:rgba?|hsla?|color|lab|lch|oklab|oklch)\((.*)\)$/u.exec(color.trim())
  if (!match) return true
  const body = match[1]
  const alpha = body.includes('/') ? body.split('/').pop() : body.split(',').length === 4 ? body.split(',').pop() : null
  return alpha === null || Number.parseFloat(alpha) > 0
}

// The board's highlighter: linear-gradient(transparent 60%, marker 60%,
// marker 92%, transparent 92%) gives a band from 60 % to 92 % of the line.
export function gradientBands(image) {
  if (!image || !image.startsWith('linear-gradient(')) return []
  const head = image.slice('linear-gradient('.length)
  if (/^\s*(?:to\s+(?!bottom)|-?[\d.]+(?:deg|turn|rad))/u.test(head) && !/^\s*180deg/u.test(head)) return []
  const stops = [...head.matchAll(/((?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)|transparent|#[0-9a-f]{3,8})\s+(-?[\d.]+)%/giu)]
    .map(match => ({ color: match[1], at: Number.parseFloat(match[2]) / 100 }))
  const bands = []
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const [from, to] = [stops[index], stops[index + 1]]
    if (from.color === to.color && visibleColor(from.color) && to.at > from.at) bands.push({ color: from.color, from: Math.max(0, from.at), to: Math.min(1, to.at) })
  }
  return bands
}

// One corner radius ("12px", "40%", "40% 30%") against a box.
export function cornerRadius(value, width, height) {
  const [across, down = across] = String(value || '0').trim().split(/\s+/u)
  const read = (part, size) => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * size : Number.parseFloat(part) || 0)
  return { x: read(across, width), y: read(down, height) }
}

function radii(style, width, height) {
  const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => cornerRadius(value, width, height))
  return corners.some(corner => corner.x > 0 && corner.y > 0) ? corners : null
}

function canvasFont(style) {
  const fontStyle = style.fontStyle.startsWith('oblique') ? 'italic' : style.fontStyle
  return `${fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

function intersect(a, b) {
  if (!a) return b
  if (!b) return a
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }
}

function union(a, b) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

function dashFor(style, width) {
  if (style === 'dashed') return [width * 3, width * 2.2]
  if (style === 'dotted') return [0.01, width * 2]
  return null
}

// Wait until the pages' fonts are in: layout starts the loads (handwriting
// slices, KaTeX's faces), and a canvas only draws with loaded fonts.
export async function settleFonts(root, { timeoutMs = 10000 } = {}) {
  void root.offsetHeight
  // A timer, not an animation frame: frames stop while the window is hidden.
  await new Promise(resolve => { setTimeout(resolve, 50) })
  const fonts = document.fonts
  if (!fonts) return
  const text = (root.textContent ?? '').slice(0, 20000)
  const wanted = ['Aha Hand Latin', 'Aha Hand'].map(family => fonts.load?.(`20px '${family}'`, text).catch(() => undefined))
  await Promise.race([Promise.all([...wanted, fonts.ready]), new Promise(resolve => { setTimeout(resolve, timeoutMs) })])
}

// A formula or a table wider than its column scrolls on the board; on a
// page it shrinks to fit instead.
export function fitSheets(root) {
  for (const element of root.querySelectorAll('.aha-op-math')) {
    if (element.scrollWidth <= element.clientWidth + 1 || !element.clientWidth) continue
    const size = Number.parseFloat(getComputedStyle(element).fontSize) || 20
    element.style.fontSize = `${(size * element.clientWidth * 0.98) / element.scrollWidth}px`
  }
  for (const table of root.querySelectorAll('.aha-op-table')) {
    const room = table.closest('.aha-op')?.clientWidth ?? 0
    if (!room || table.offsetWidth <= room + 1) continue
    const ratio = room / table.offsetWidth
    const style = getComputedStyle(table)
    table.style.fontSize = `${Math.max(10, (Number.parseFloat(style.fontSize) || 16) * ratio)}px`
    table.style.lineHeight = `${Math.max(14, (Number.parseFloat(style.lineHeight) || 24) * ratio)}px`
  }
}

// Read one laid-out page into drawing operations, in page coordinates.
// scale: how sharp SVG figures are rasterized (canvas pixels per CSS pixel).
export function captureSheet(sheet, { scale = 2 } = {}) {
  const origin = sheet.getBoundingClientRect()
  const ops = []
  const metricsCache = new Map()
  const measure = document.createElement('canvas').getContext('2d')
  const range = document.createRange()
  const at = rect => ({ x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height })

  const metrics = font => {
    let value = metricsCache.get(font)
    if (!value) {
      measure.font = font
      const sample = measure.measureText('Hg')
      const size = Number.parseFloat(/([\d.]+)px/u.exec(font)?.[1] ?? '16')
      value = {
        ascent: Number.isFinite(sample.fontBoundingBoxAscent) ? sample.fontBoundingBoxAscent : size * 0.8,
        descent: Number.isFinite(sample.fontBoundingBoxDescent) ? sample.fontBoundingBoxDescent : size * 0.2,
      }
      metricsCache.set(font, value)
    }
    return value
  }

  const sheetStyle = getComputedStyle(sheet)
  ops.push({ kind: 'paper', w: origin.width, h: origin.height, paper: sheetStyle.getPropertyValue('--paper').trim() || sheetStyle.backgroundColor, dot: sheetStyle.getPropertyValue('--grid').trim() })

  // Each run of glyphs on one line is drawn at the position the page gave it,
  // on the baseline of its font.
  const text = (node, state) => {
    const value = node.data
    if (!value || !/\S/u.test(value)) return
    const style = getComputedStyle(node.parentElement)
    if (!visibleColor(style.color)) return
    const font = canvasFont(style)
    const { ascent } = metrics(font)
    let run = null
    const flush = () => {
      if (run && /\S/u.test(run.text)) ops.push({ kind: 'text', text: run.text, x: run.x, y: run.top + ascent, font, color: style.color, alpha: state.alpha, clip: state.clip })
      run = null
    }
    for (const part of graphemes(value)) {
      if (part.text === '\n' || part.text === '\r' || part.text === '\t') {
        flush()
        continue
      }
      range.setStart(node, part.index)
      range.setEnd(node, part.index + part.text.length)
      const rects = range.getClientRects()
      const rect = rects[rects.length - 1]
      if (!rect || rect.width <= 0) {
        if (!/\s/u.test(part.text)) flush()
        continue
      }
      const x = rect.left - origin.left
      const top = rect.top - origin.top
      if (run && Math.abs(top - run.top) < 1 && Math.abs(x - run.right) < 1) {
        run.text += part.text
        run.right = x + rect.width
      } else {
        flush()
        run = { text: part.text, x, top, right: x + rect.width }
      }
    }
    flush()
  }

  const decorate = (element, style, rects, alpha, clip) => {
    const background = style.backgroundColor
    const bands = gradientBands(style.backgroundImage)
    for (const rect of rects) {
      const box = at(rect)
      if (visibleColor(background)) ops.push({ kind: 'fill', box, color: background, radius: radii(style, box.w, box.h), alpha, clip })
      for (const band of bands) ops.push({ kind: 'fill', box: { x: box.x, y: box.y + box.h * band.from, w: box.w, h: box.h * (band.to - band.from) }, color: band.color, alpha, clip })
    }
    const sides = SIDES.map(side => ({ width: Number.parseFloat(style[`border${side}Width`]) || 0, style: style[`border${side}Style`], color: style[`border${side}Color`] }))
    const shown = sides.map(side => side.width > 0 && side.style !== 'none' && side.style !== 'hidden' && visibleColor(side.color))
    if (!shown.some(Boolean)) return
    // Collapsed table borders sit on the grid lines, which are the cells'
    // edges; other borders lie inside the box.
    const collapsed = (element.tagName === 'TD' || element.tagName === 'TH') && style.borderCollapse === 'collapse'
    const uniform = !collapsed && shown.every(Boolean) && sides.every(side => side.width === sides[0].width && side.style === sides[0].style && side.color === sides[0].color)
    for (const rect of rects) {
      const box = at(rect)
      if (uniform) {
        const width = sides[0].width
        const corners = radii(style, box.w, box.h)?.map(corner => ({ x: Math.max(0, corner.x - width / 2), y: Math.max(0, corner.y - width / 2) })) ?? null
        ops.push({ kind: 'stroke', box: { x: box.x + width / 2, y: box.y + width / 2, w: Math.max(0, box.w - width), h: Math.max(0, box.h - width) }, width, color: sides[0].color, dash: dashFor(sides[0].style, width), radius: corners, alpha, clip })
        continue
      }
      sides.forEach((side, index) => {
        if (!shown[index]) return
        const inset = collapsed ? 0 : side.width / 2
        const points = [
          [box.x, box.y + inset, box.x + box.w, box.y + inset],
          [box.x + box.w - inset, box.y, box.x + box.w - inset, box.y + box.h],
          [box.x, box.y + box.h - inset, box.x + box.w, box.y + box.h - inset],
          [box.x + inset, box.y, box.x + inset, box.y + box.h],
        ][index]
        ops.push({ kind: 'line', points, width: side.width, color: side.color, dash: dashFor(side.style, side.width), alpha, clip })
      })
    }
  }

  // List markers are pseudo-elements, which a page cannot read back.
  const marker = (item, style, alpha, clip) => {
    const list = item.parentElement
    if (!list || style.listStyleType === 'none' || style.display !== 'list-item') return
    const font = canvasFont(style)
    const { ascent, descent } = metrics(font)
    const size = Number.parseFloat(style.fontSize) || 16
    const lineHeight = Number.parseFloat(style.lineHeight) || (ascent + descent) * 1.2
    const box = at(item.getBoundingClientRect())
    const items = [...list.children].filter(child => child.tagName === 'LI')
    const label = list.tagName === 'OL' ? `${items.indexOf(item) + (Number(list.getAttribute('start')) || 1)}.` : '•'
    ops.push({ kind: 'text', text: label, align: 'right', x: box.x - size * 0.4, y: box.y + (Number.parseFloat(style.paddingTop) || 0) + (lineHeight - ascent - descent) / 2 + ascent, font, color: style.color, alpha, clip })
  }

  // An SVG becomes an image of the part of it the page shows, with the page's
  // computed styles written into it. Upright labels are drawn as canvas text
  // instead, so they keep the board's handwriting font (an SVG image cannot
  // use the page's web fonts).
  const figure = (svg, style, alpha, clip) => {
    const rect = svg.getBoundingClientRect()
    let area = at(rect)
    const overflowing = style.overflow === 'visible' || style.overflowX === 'visible'
    if (overflowing) {
      try {
        const box = svg.getBBox()
        const matrix = svg.getScreenCTM()
        if (matrix && (box.width || box.height)) {
          const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
            .map(([x, y]) => [matrix.a * x + matrix.c * y + matrix.e - origin.left, matrix.b * x + matrix.d * y + matrix.f - origin.top])
          const xs = corners.map(point => point[0])
          const ys = corners.map(point => point[1])
          area = union(area, { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...ys) - Math.min(...ys) + 8 })
        }
      } catch {
        // getBBox throws for SVGs that are not rendered; keep the box.
      }
    }
    area = intersect(area, clip ?? { x: 0, y: 0, w: origin.width, h: origin.height })
    if (area.w < 0.5 || area.h < 0.5) return
    const labels = []
    const clone = svg.cloneNode(true)
    const copy = (live, copied) => {
      const computed = getComputedStyle(live)
      const declarations = SVG_STYLE.map(name => [name, computed.getPropertyValue(name)]).filter(([, value]) => value && !value.includes('url('))
      if (computed.display === 'none') declarations.push(['display', 'none'])
      if (computed.visibility === 'hidden') declarations.push(['visibility', 'hidden'])
      copied.setAttribute('style', declarations.map(([name, value]) => `${name}:${value}`).join(';'))
      const tag = live.tagName.toLowerCase()
      if ((tag === 'text' || tag === 'tspan') && ![...live.children].length && /\S/u.test(live.textContent ?? '')) {
        const matrix = live.getScreenCTM?.()
        const upright = matrix && Math.abs(matrix.b) < 1e-3 && Math.abs(matrix.c) < 1e-3 && matrix.a > 0
        const fill = computed.fill
        if (upright && visibleColor(fill) && !fill.includes('url(') && !visibleColor(computed.stroke) && computed.display !== 'none' && computed.visibility !== 'hidden') {
          const box = live.getBoundingClientRect()
          const size = (Number.parseFloat(computed.fontSize) || 16) * matrix.d
          const fontStyle = computed.fontStyle.startsWith('oblique') ? 'italic' : computed.fontStyle
          const font = `${fontStyle} ${computed.fontWeight} ${size}px ${computed.fontFamily}`
          const opacity = (Number.parseFloat(computed.fillOpacity) || 1) * (Number.parseFloat(computed.opacity) || 1)
          labels.push({ kind: 'text', text: live.textContent.replace(/\s+/gu, ' ').trim(), x: box.left - origin.left, y: box.top - origin.top + metrics(font).ascent, font, color: fill, alpha: alpha * opacity, clip })
          copied.setAttribute('style', `${copied.getAttribute('style')};visibility:hidden`)
        }
      }
      const liveChildren = [...live.children]
      const copiedChildren = [...copied.children]
      liveChildren.forEach((child, index) => { if (copiedChildren[index]) copy(child, copiedChildren[index]) })
    }
    copy(svg, clone)
    clone.setAttribute('x', String(rect.left - origin.left - area.x))
    clone.setAttribute('y', String(rect.top - origin.top - area.y))
    clone.setAttribute('width', String(rect.width))
    clone.setAttribute('height', String(rect.height))
    if (overflowing) clone.setAttribute('overflow', 'visible')
    const inner = new XMLSerializer().serializeToString(clone)
    const markup = `<svg xmlns="${SVG_NS}" width="${Math.ceil(area.w * scale)}" height="${Math.ceil(area.h * scale)}" viewBox="0 0 ${area.w} ${area.h}" preserveAspectRatio="none">${inner}</svg>`
    ops.push({ kind: 'image', markup, box: area, alpha, clip: null })
    ops.push(...labels)
  }

  const visit = (element, state) => {
    if (SKIP_TAGS.has(element.tagName) || element.classList.contains('katex-mathml')) return
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return
    const alpha = state.alpha * (Number.parseFloat(style.opacity) || 0)
    if (alpha <= 0.01) return
    if (element.namespaceURI === SVG_NS) {
      if (element.tagName.toLowerCase() === 'svg') figure(element, style, alpha, state.clip)
      return
    }
    decorate(element, style, [...element.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0), alpha, state.clip)
    if (element.tagName === 'LI') marker(element, style, alpha, state.clip)
    const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible'
    walk(element, { alpha, clip: clips ? intersect(state.clip, at(element.getBoundingClientRect())) : state.clip })
  }

  const walk = (element, state) => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text(node, state)
      else if (node.nodeType === Node.ELEMENT_NODE) visit(node, state)
    }
  }

  walk(sheet, { alpha: 1, clip: null })
  range.detach?.()
  return { width: Math.ceil(origin.width), height: Math.ceil(origin.height), ops }
}

// SVG images decode asynchronously; one that fails is left out.
export async function loadCaptureImages(capture) {
  await Promise.all(capture.ops.map(async op => {
    if (op.kind !== 'image') return
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(op.markup)}`
    try {
      await image.decode()
      op.image = image
    } catch {
      op.image = null
    }
  }))
  return capture
}

function boxPath(ctx, box, radius) {
  ctx.beginPath()
  if (radius && ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, radius)
  else ctx.rect(box.x, box.y, box.w, box.h)
}

const PAINT = {
  paper(ctx, op) {
    ctx.fillStyle = op.paper || '#fdfcf8'
    ctx.fillRect(0, 0, op.w, op.h)
    if (!op.dot) return
    ctx.fillStyle = op.dot
    ctx.beginPath()
    for (let x = DOT_STEP / 2; x < op.w; x += DOT_STEP) {
      for (let y = DOT_STEP / 2; y < op.h; y += DOT_STEP) {
        ctx.moveTo(x + 1.1, y)
        ctx.arc(x, y, 1.1, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  },
  fill(ctx, op) {
    ctx.fillStyle = op.color
    boxPath(ctx, op.box, op.radius)
    ctx.fill()
  },
  stroke(ctx, op) {
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    if (op.dash) {
      ctx.setLineDash(op.dash)
      ctx.lineCap = op.dash[0] < 0.1 ? 'round' : 'butt'
    }
    boxPath(ctx, op.box, op.radius)
    ctx.stroke()
  },
  line(ctx, op) {
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    if (op.dash) {
      ctx.setLineDash(op.dash)
      ctx.lineCap = op.dash[0] < 0.1 ? 'round' : 'butt'
    }
    ctx.beginPath()
    ctx.moveTo(op.points[0], op.points[1])
    ctx.lineTo(op.points[2], op.points[3])
    ctx.stroke()
  },
  text(ctx, op) {
    ctx.font = op.font
    ctx.fillStyle = op.color
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = op.align ?? 'left'
    ctx.fillText(op.text, op.x, op.y)
  },
  image(ctx, op) {
    if (op.image) ctx.drawImage(op.image, op.box.x, op.box.y, op.box.w, op.box.h)
  },
}

// Draw a captured page; scale is canvas pixels per CSS pixel.
export function paintCapture(capture, scale = 2) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(capture.width * scale))
  canvas.height = Math.max(1, Math.round(capture.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  for (const op of capture.ops) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, op.alpha ?? 1)
    if (op.clip) {
      ctx.beginPath()
      ctx.rect(op.clip.x, op.clip.y, op.clip.w, op.clip.h)
      ctx.clip()
    }
    PAINT[op.kind]?.(ctx, op)
    ctx.restore()
  }
  return canvas
}
