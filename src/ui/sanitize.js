// Model-drawn SVG goes onto the board only after this allow-list pass: no
// scripts, event handlers, foreign content, external references or CSS that
// could fetch anything. Animations that need code run in a sandboxed iframe
// instead (see animationDocument).

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'textPath',
  'defs', 'marker', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'clippath', 'mask', 'pattern', 'use', 'symbol',
])

const ATTRIBUTES = new Set([
  'xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'transform', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'font-size', 'font-family', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'text-decoration', 'dx', 'dy', 'rotate',
  'marker-start', 'marker-mid', 'marker-end', 'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'offset',
  'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'fx', 'fy', 'id', 'clip-path', 'mask', 'preserveaspectratio',
  'vector-effect', 'patternunits', 'patterncontentunits', 'href', 'xlink:href', 'startoffset', 'textlength', 'lengthadjust', 'style', 'class',
])

const STYLE_PROPERTIES = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing'])

function safeValue(name, value) {
  const lower = String(value).toLowerCase()
  if (/javascript:|data:|expression\(|@import|<|>/u.test(lower)) return null
  if (lower.includes('url(') && !/^url\(\s*#[\w-]+\s*\)$/u.test(lower.trim())) return null
  if ((name === 'href' || name === 'xlink:href') && !/^#[\w-]+$/u.test(String(value).trim())) return null
  return value
}

function safeStyle(value) {
  const kept = []
  for (const declaration of String(value).split(';')) {
    const [property, ...rest] = declaration.split(':')
    const name = property?.trim().toLowerCase()
    const raw = rest.join(':').trim()
    if (!name || !raw || !STYLE_PROPERTIES.has(name)) continue
    if (safeValue(name, raw) === null) continue
    kept.push(`${name}:${raw}`)
  }
  return kept.join(';')
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) {
      child.remove()
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = String(child.localName || child.nodeName).toLowerCase()
    if (!ELEMENTS.has(tag)) {
      child.remove()
      continue
    }
    for (const attribute of [...child.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || !ATTRIBUTES.has(name)) {
        child.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style') {
        const style = safeStyle(attribute.value)
        if (style) child.setAttribute('style', style)
        else child.removeAttribute('style')
        continue
      }
      if (safeValue(name, attribute.value) === null) child.removeAttribute(attribute.name)
    }
    clean(child)
  }
}

// Returns sanitized SVG markup, or null when the input is not usable SVG.
export function sanitizeSvg(markup, { DOMParserImpl = globalThis.DOMParser, XMLSerializerImpl = globalThis.XMLSerializer } = {}) {
  if (typeof markup !== 'string' || !/^\s*<svg[\s>]/iu.test(markup) || markup.length > 64 * 1024) return null
  if (!DOMParserImpl) return null
  let doc
  try {
    doc = new DOMParserImpl().parseFromString(markup, 'image/svg+xml')
  } catch {
    return null
  }
  const root = doc?.documentElement
  if (!root || String(root.localName || root.nodeName).toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null
  for (const attribute of [...root.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on') || !ATTRIBUTES.has(name) || safeValue(name, attribute.value) === null) root.removeAttribute(attribute.name)
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clean(root)
  const output = XMLSerializerImpl ? new XMLSerializerImpl().serializeToString(root) : root.outerHTML
  return /^\s*<svg[\s>]/iu.test(output) ? output : null
}

// Self-contained page for an animation op. The iframe that shows it has
// sandbox="allow-scripts" (no same-origin), and this CSP blocks any network.
const ANIMATION_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

// `theme` matches the board so Chromium does not paint an opaque backdrop
// behind an iframe whose color scheme differs from the page.
export function animationDocument(html, theme = 'light') {
  const body = String(html ?? '')
  const scheme = theme === 'dark' ? 'dark' : 'light'
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ANIMATION_CSP}"><meta charset="utf-8"><meta name="color-scheme" content="${scheme}"><style>:root{color-scheme:${scheme}}html,body{margin:0;background:transparent;overflow:hidden}canvas,svg{max-width:100%;height:auto}</style>`
  if (/<head[^>]*>/iu.test(body)) return body.replace(/<head[^>]*>/iu, match => `${match}${meta}`)
  if (/<html[^>]*>/iu.test(body)) return body.replace(/<html[^>]*>/iu, match => `${match}<head>${meta}</head>`)
  return `<!doctype html><html><head>${meta}</head><body>${body}</body></html>`
}
