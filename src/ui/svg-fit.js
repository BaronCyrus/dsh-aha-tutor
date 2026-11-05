// The layout check for a diagram the model drew, shared by the board and
// the exports: a label or shape that reaches past the viewBox runs into
// what is next to it on the board (which lets it show) and is cut off in a
// video or a picture of the board. The viewBox grows to hold everything
// drawn, measured where it is drawn. Labels running into each other are
// not looked at.

const MARGIN = 6
// Where the viewBox the model wrote is kept, so measuring again (once the
// board's font has arrived) starts from it rather than from a grown one.
const ORIGINAL = 'data-aha-viewbox'

const round = value => Math.round(value * 100) / 100

function viewBoxOf(value) {
  const parts = String(value ?? '').trim().split(/[\s,]+/u).map(Number)
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] } : null
}

// The viewBox an svg element needs to show all it draws ("x y w h"), or
// null when it already does or cannot be measured (an element that is not
// laid out has no box). box: what getBBox() measured.
export function fittedViewBox({ viewBox, width, height, box }) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !(box.width > 0 || box.height > 0)) return null
  const size = [Number.parseFloat(width), Number.parseFloat(height)]
  const view = viewBoxOf(viewBox) ?? (size.every(value => value > 0) ? { x: 0, y: 0, width: size[0], height: size[1] } : null)
  if (!view) return null
  const left = box.x < view.x - 0.5 ? box.x - MARGIN : view.x
  const top = box.y < view.y - 0.5 ? box.y - MARGIN : view.y
  const right = box.x + box.width > view.x + view.width + 0.5 ? box.x + box.width + MARGIN : view.x + view.width
  const bottom = box.y + box.height > view.y + view.height + 0.5 ? box.y + box.height + MARGIN : view.y + view.height
  if (left === view.x && top === view.y && right === view.x + view.width && bottom === view.y + view.height) return null
  return `${round(left)} ${round(top)} ${round(right - left)} ${round(bottom - top)}`
}

// Fits a live <svg> element in place. Returns whether its viewBox changed.
export function fitSvgElement(svg) {
  if (!svg || typeof svg.getBBox !== 'function') return false
  if (!svg.hasAttribute(ORIGINAL)) svg.setAttribute(ORIGINAL, svg.getAttribute('viewBox') ?? '')
  const original = svg.getAttribute(ORIGINAL)
  let box
  try {
    box = svg.getBBox()
  } catch {
    return false
  }
  const next = fittedViewBox({ viewBox: original, width: svg.getAttribute('width'), height: svg.getAttribute('height'), box }) ?? original
  if (!next || next === svg.getAttribute('viewBox')) return false
  svg.setAttribute('viewBox', next)
  return true
}

// The same check for markup that is drawn as an image (a video frame): it
// is laid out out of sight on the page, measured and written back.
// font: the font family its labels are drawn in.
export function fitSvgMarkup(markup, { doc = globalThis.document, font = '' } = {}) {
  if (!markup || !doc?.body || typeof globalThis.XMLSerializer !== 'function') return markup
  const host = doc.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:600px;visibility:hidden;pointer-events:none'
  if (font) host.style.fontFamily = font
  host.innerHTML = markup
  doc.body.appendChild(host)
  try {
    const svg = host.querySelector('svg')
    if (!fitSvgElement(svg)) return markup
    svg.removeAttribute(ORIGINAL)
    return new globalThis.XMLSerializer().serializeToString(svg)
  } finally {
    host.remove()
  }
}
