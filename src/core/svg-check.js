// A browser draws model-written SVG only when it is well-formed XML: one
// stray "&", an HTML entity such as &nbsp;, a "<" in a label or an xlink:
// prefix nobody declared, and the whole figure is lost. repairSvg fixes what
// can be fixed without asking anyone, the same way on the host (before a
// board is saved) and in the browser (boards saved earlier); svgProblems
// says what is still wrong, for the model to fix. Pure string work: no DOM.

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_ENTITIES = new Set(['lt', 'gt', 'amp', 'quot', 'apos'])

// HTML entities that turn up in labels, as the characters they stand for.
const HTML_ENTITIES = Object.freeze({
  nbsp: 160, ensp: 8194, emsp: 8195, thinsp: 8201, times: 215, divide: 247, deg: 176, plusmn: 177, minus: 8722, middot: 183, sdot: 8901,
  le: 8804, ge: 8805, ne: 8800, asymp: 8776, equiv: 8801, infin: 8734, prop: 8733, radic: 8730, sum: 8721, prod: 8719, int: 8747,
  part: 8706, nabla: 8711, ang: 8736, perp: 8869, prime: 8242, Prime: 8243, there4: 8756, isin: 8712, notin: 8713, sub: 8834, sup: 8835,
  cap: 8745, cup: 8746, forall: 8704, exist: 8707, empty: 8709, not: 172, larr: 8592, rarr: 8594, uarr: 8593, darr: 8595, harr: 8596,
  lArr: 8656, rArr: 8658, hArr: 8660, alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952,
  iota: 953, kappa: 954, lambda: 955, mu: 956, nu: 957, xi: 958, pi: 960, rho: 961, sigma: 963, tau: 964, upsilon: 965, phi: 966,
  chi: 967, psi: 968, omega: 969, Gamma: 915, Delta: 916, Theta: 920, Lambda: 923, Xi: 926, Pi: 928, Sigma: 931, Phi: 934, Psi: 936,
  Omega: 937, sup1: 185, sup2: 178, sup3: 179, frac12: 189, frac14: 188, frac34: 190, micro: 181, ohm: 937, para: 182, sect: 167,
  copy: 169, reg: 174, trade: 8482, hellip: 8230, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221,
  laquo: 171, raquo: 187, bull: 8226, cent: 162, pound: 163, yen: 165, euro: 8364,
})

// SVG names are case-sensitive in XML; an HTML habit writes them in another
// case, and the figure loses its viewBox or its gradient, or all of it.
const CAMEL = Object.freeze(Object.fromEntries([
  'viewBox', 'preserveAspectRatio', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'gradientUnits', 'gradientTransform',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'startOffset', 'textLength', 'lengthAdjust', 'clipPathUnits',
  'linearGradient', 'radialGradient', 'clipPath', 'textPath', 'svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline',
  'polygon', 'text', 'tspan', 'defs', 'marker', 'stop', 'use', 'symbol', 'title', 'desc', 'mask', 'pattern',
].map(name => [name.toLowerCase(), name])))

const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/u
const ATTRIBUTE = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/uy
const TAG = /^<(\/?)([^\s/>]+)([\s\S]*?)(\/?)>$/u
const REFERENCE = /^&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/u

const allowedChar = code => code === 0x9 || code === 0xA || code === 0xD || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF)

// Where the markup construct that opens at `at` ends: the index after its
// closing `close`, or -1 when it never closes.
function endOf(svg, at, close) {
  const end = svg.indexOf(close, at)
  return end < 0 ? -1 : end + close.length
}

// The end of the tag that opens at `at` (the index after its ">"), skipping
// quoted values; -1 when a "<" or the end comes first (no tag after all).
function tagEnd(svg, at) {
  let quote = ''
  for (let index = at + 1; index < svg.length; index += 1) {
    const char = svg[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === '\'') quote = char
    else if (char === '>') return index + 1
    else if (char === '<') return -1
  }
  return -1
}

const opensTag = (svg, at) => /[A-Za-z_/]/u.test(svg[at + 1] ?? '')

// An "&" as XML wants it: a reference it knows kept, an HTML entity as its
// character, anything else escaped. [text, characters read].
function reference(svg, at) {
  const match = REFERENCE.exec(svg.slice(at, at + 40))
  if (!match) return ['&amp;', 1]
  const name = match[1]
  if (name.startsWith('#')) {
    const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
    return [allowedChar(code) ? match[0] : '', match[0].length]
  }
  if (XML_ENTITIES.has(name)) return [match[0], match[0].length]
  const code = HTML_ENTITIES[name]
  return [code ? `&#${code};` : `&amp;${name};`, match[0].length]
}

function escapeText(value, { quote = '' } = {}) {
  let out = ''
  for (let at = 0; at < value.length;) {
    const char = value[at]
    if (char === '&') {
      const [text, length] = reference(value, at)
      out += text
      at += length
      continue
    }
    out += char === '<' ? '&lt;' : char === quote ? '&quot;' : char
    at += 1
  }
  return out
}

// The attributes of a tag's body as [name, value, quoted] (value null when
// written bare), or null when the body cannot be read.
function attributesOf(body) {
  const pairs = []
  ATTRIBUTE.lastIndex = 0
  while (ATTRIBUTE.lastIndex < body.length) {
    if (!body.slice(ATTRIBUTE.lastIndex).trim()) break
    const start = ATTRIBUTE.lastIndex
    const match = ATTRIBUTE.exec(body)
    if (!match || ATTRIBUTE.lastIndex === start) return null
    pairs.push([match[1], match[2] ?? match[3] ?? match[4] ?? null, match[4] === undefined])
  }
  return pairs
}

// A tag written again with what XML needs: names in their SVG case, every
// value quoted and escaped, bare and repeated attributes left out, and
// attributes in a namespace nobody declared dropped. Unreadable tags are
// kept as they are, for svgProblems to report.
function rewriteTag(tag, declared, { root = false } = {}) {
  const match = TAG.exec(tag)
  if (!match) return tag
  const [, closing, rawName, body, selfClosing] = match
  const name = CAMEL[rawName.toLowerCase()] ?? rawName
  if (closing) return body.trim() ? tag : `</${name}>`
  const pairs = attributesOf(body)
  if (!pairs) return tag
  const seen = new Set()
  const kept = []
  for (const [rawAttribute, value] of pairs) {
    const attribute = CAMEL[rawAttribute.toLowerCase()] ?? rawAttribute
    if (value === null || seen.has(attribute)) continue
    const prefix = attribute.includes(':') ? attribute.split(':')[0] : ''
    if (prefix && prefix !== 'xmlns' && prefix !== 'xml' && !declared.has(prefix) && prefix !== 'xlink') continue
    seen.add(attribute)
    kept.push([attribute, value])
  }
  if (root) {
    if (!seen.has('xmlns')) kept.unshift(['xmlns', SVG_NS])
    if (!seen.has('xmlns:xlink') && declared.has('xlink:used')) kept.push(['xmlns:xlink', XLINK_NS])
  }
  return `<${name}${kept.map(([attribute, value]) => ` ${attribute}="${escapeText(value, { quote: '"' })}"`).join('')}${selfClosing ? '/' : ''}>`
}

// Fixes what can be fixed in model-written SVG without changing what it
// draws. Returns the markup unchanged when it does not look like SVG.
export function repairSvg(markup) {
  let svg = String(markup ?? '')
  // JSON escaped twice: <svg viewBox=\"0 0 100 50\">.
  if (/=\s*\\"/u.test(svg)) svg = svg.replace(/\\"/gu, '"').replace(/\\n/gu, '\n').replace(/\\t/gu, ' ')
  svg = svg
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .trim()
    // A declaration, a doctype or comments before the root.
    .replace(/^(?:<\?xml[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->|\s)+/iu, '')
  if (!/^<svg[\s>/]/iu.test(svg)) return svg
  // What the board removes anyway and XML may not read: scripts (a "<" in
  // code) and foreign HTML (an unclosed <br>).
  svg = svg.replace(/<script\b[\s\S]*?<\/script\s*>/giu, '').replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/giu, '')
  const declared = new Set([...svg.matchAll(/\sxmlns:([\w.-]+)\s*=/gu)].map(match => match[1]))
  if (/\sxlink:[\w.-]+\s*=/u.test(svg)) declared.add('xlink:used')
  let out = ''
  let rootSeen = false
  // Open elements; whatever follows the root's end is left out.
  let depth = 0
  for (let at = 0; at < svg.length;) {
    if (rootSeen && depth === 0) break
    const char = svg[at]
    if (char === '<') {
      const special = svg.startsWith('<!--', at) ? '-->' : svg.startsWith('<![CDATA[', at) ? ']]>' : svg.startsWith('<?', at) ? '?>' : ''
      if (special) {
        const end = endOf(svg, at, special)
        out += end < 0 ? escapeText(svg.slice(at)) : svg.slice(at, end)
        at = end < 0 ? svg.length : end
        continue
      }
      const end = opensTag(svg, at) ? tagEnd(svg, at) : -1
      if (end < 0) {
        out += '&lt;'
        at += 1
        continue
      }
      const tag = svg.slice(at, end)
      out += rewriteTag(tag, declared, { root: !rootSeen })
      rootSeen = true
      if (tag[1] === '/') depth -= 1
      else if (!/\/\s*>$/u.test(tag)) depth += 1
      at = end
      continue
    }
    if (char === '&') {
      const [text, length] = reference(svg, at)
      out += text
      at += length
      continue
    }
    out += char
    at += 1
  }
  return out
}

// What keeps a browser from reading the markup as SVG, in a few words each
// (at most six); empty when nothing does. Checks what XML requires: tags
// that open and close in order, quoted attributes once each, known entity
// references, declared prefixes and a single root element.
export function svgProblems(markup) {
  const svg = String(markup ?? '')
  const problems = []
  const say = problem => {
    if (!problems.includes(problem)) problems.push(problem)
  }
  if (!/^<svg[\s>/]/u.test(svg)) say('the markup does not start with <svg')
  const declared = new Set(['xml', 'xmlns', ...[...svg.matchAll(/\sxmlns:([\w.-]+)\s*=/gu)].map(match => match[1])])
  const stack = []
  let rootSeen = false
  let closedRoot = false
  const textProblem = text => {
    if (/[<]/u.test(text)) say('a "<" in text must be written &lt;')
    for (let at = text.indexOf('&'); at >= 0 && problems.length < 6; at = text.indexOf('&', at + 1)) {
      const match = REFERENCE.exec(text.slice(at, at + 40))
      if (!match) say('an "&" in text must be written &amp;')
      else if (!match[1].startsWith('#') && !XML_ENTITIES.has(match[1])) say(`&${match[1]}; is not an XML entity`)
    }
  }
  for (let at = 0; at < svg.length && problems.length < 6;) {
    const open = svg.indexOf('<', at)
    const text = svg.slice(at, open < 0 ? svg.length : open)
    if (text) {
      if (closedRoot && text.trim()) say('there is content after the closing </svg>')
      textProblem(text)
    }
    if (open < 0) break
    const special = svg.startsWith('<!--', open) ? '-->' : svg.startsWith('<![CDATA[', open) ? ']]>' : svg.startsWith('<?', open) ? '?>' : ''
    if (special) {
      const end = endOf(svg, open, special)
      if (end < 0) {
        say('a comment or CDATA section is never closed')
        break
      }
      at = end
      continue
    }
    if (svg.startsWith('<!', open)) {
      say('a <!DOCTYPE> or other declaration inside the figure')
      at = open + 2
      continue
    }
    const end = opensTag(svg, open) ? tagEnd(svg, open) : -1
    if (end < 0) {
      say('a "<" that starts no tag (write &lt;)')
      at = open + 1
      continue
    }
    const tag = svg.slice(open, end)
    at = end
    const match = TAG.exec(tag)
    if (!match || !NAME.test(match[2])) {
      say(`a broken tag: ${tag.slice(0, 40)}`)
      continue
    }
    const [, closing, name, body, selfClosing] = match
    const prefix = name.includes(':') ? name.split(':')[0] : ''
    if (prefix && !declared.has(prefix)) say(`the prefix "${prefix}:" of <${name}> is not declared`)
    if (closing) {
      if (body.trim()) say(`a closing tag with attributes: ${tag.slice(0, 40)}`)
      const top = stack.pop()
      if (top !== name) say(top ? `</${name}> closes <${top}>` : `</${name}> closes nothing`)
      if (!stack.length) closedRoot = true
      continue
    }
    if (!stack.length) {
      if (rootSeen) say('more than one root element')
      rootSeen = true
    }
    const pairs = attributesOf(body)
    if (!pairs) say(`attributes that cannot be read in <${name}>`)
    else {
      const seen = new Set()
      for (const [attribute, value, quoted] of pairs) {
        if (value === null) say(`attribute ${attribute} of <${name}> has no value`)
        else if (!quoted) say(`the value of ${attribute} in <${name}> is not quoted`)
        if (!NAME.test(attribute)) say(`a bad attribute name in <${name}>: ${attribute.slice(0, 20)}`)
        if (seen.has(attribute)) say(`attribute ${attribute} appears twice in <${name}>`)
        seen.add(attribute)
        const attributePrefix = attribute.includes(':') ? attribute.split(':')[0] : ''
        if (attributePrefix && !declared.has(attributePrefix)) say(`the prefix "${attributePrefix}:" of ${attribute} is not declared`)
        if (value !== null) {
          if (value.includes('<')) say(`a "<" inside the value of ${attribute}`)
          textProblem(value.replace(/</gu, ''))
        }
      }
    }
    if (!selfClosing) stack.push(name)
    else if (!stack.length) closedRoot = true
  }
  if (stack.length && problems.length < 6) say(`<${stack[stack.length - 1]}> is never closed`)
  return problems.slice(0, 6)
}
