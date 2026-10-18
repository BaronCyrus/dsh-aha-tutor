// Inline board text: **bold**, ==highlight==, $math$ and plain runs, with a
// visible length so text can be "written" a character at a time.

const TOKEN = /(\$[^$\n]+\$|\*\*[^*\n]+\*\*|==[^=\n]+==)/gu

export function parseInline(value) {
  const segments = []
  const source = String(value ?? '')
  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    if (match.index > last) segments.push({ kind: 'text', text: source.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith('$')) segments.push({ kind: 'math', tex: token.slice(1, -1) })
    else if (token.startsWith('**')) segments.push({ kind: 'bold', text: token.slice(2, -2) })
    else segments.push({ kind: 'mark', text: token.slice(2, -2) })
    last = match.index + token.length
  }
  if (last < source.length) segments.push({ kind: 'text', text: source.slice(last) })
  return segments
}

export function segmentLength(segment) {
  return segment.kind === 'math' ? Math.min(10, Math.max(2, segment.tex.length / 2)) : [...segment.text].length
}

export function inlineLength(segments) {
  return segments.reduce((sum, segment) => sum + segmentLength(segment), 0)
}

// Cut segments to the first `count` visible characters. A formula appears
// whole once its share of the budget is reached.
export function sliceInline(segments, count) {
  const out = []
  let left = count
  for (const segment of segments) {
    if (left <= 0) break
    const length = segmentLength(segment)
    if (segment.kind === 'math') {
      if (left >= length) out.push(segment)
      left -= length
      continue
    }
    const chars = [...segment.text]
    if (chars.length <= left) out.push(segment)
    else out.push({ ...segment, text: chars.slice(0, Math.max(0, Math.floor(left))).join('') })
    left -= chars.length
  }
  return out
}

// Plain-text reading of inline markup (captions, exports).
export function inlinePlain(value) {
  return parseInline(value).map(segment => (segment.kind === 'math' ? segment.tex : segment.text)).join('')
}
