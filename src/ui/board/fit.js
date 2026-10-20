// Display formulas in a board column. A formula a little too wide shrinks
// to one line, down to FIT_FLOOR of its size; a longer one breaks after its
// top-level =, + and →, the way KaTeX lays out inline math; a piece that
// cannot break and is still too wide shrinks until it fits. The board and its
// PDF and PNG pages use the same rule, each at its own column width.
// Formulas are then written line by line, with the pencil where the writing is.

export const FIT_FLOOR = 0.7

// room: the column's width; natural: the formula's width on one line;
// widest: its widest unbreakable piece. Broken into lines, a formula keeps
// its size unless that piece is wider than the column; one line wins while it
// keeps `floor` of that size, so "A =" never sits alone above a shrunken
// matrix. Returns { mode: 'fit' | 'shrink' | 'wrap', scale }.
export function fitPlan({ room, natural, widest = natural, floor = FIT_FLOOR }) {
  if (!(room > 0) || !(natural > room)) return { mode: 'fit', scale: 1 }
  const wrapped = Math.min(1, room / widest)
  const oneLine = room / natural
  return oneLine >= floor * wrapped ? { mode: 'shrink', scale: oneLine } : { mode: 'wrap', scale: wrapped }
}

// KaTeX splits a display formula into inline blocks after its top-level
// operators; an equation number is one more block.
function pieces(element) {
  return [...element.querySelectorAll('.katex-html > .katex-base, .katex-html > .katex-tag')]
}

// Lay a rendered formula (.aha-op-math) out in its column: the mode goes in
// data-fit (styles.js breaks lines for 'wrap'), the scale in its font size.
export function fitFormula(element) {
  element.style.fontSize = ''
  element.removeAttribute('data-fit')
  const room = element.clientWidth
  const widths = pieces(element).map(piece => piece.getBoundingClientRect().width)
  const plan = fitPlan({ room, natural: element.scrollWidth, widest: Math.max(0, ...widths) })
  if (plan.mode === 'fit') return plan.mode
  element.dataset.fit = plan.mode
  let size = (Number.parseFloat(getComputedStyle(element).fontSize) || 20) * plan.scale
  if (plan.scale < 1) element.style.fontSize = `${size}px`
  // Widths come rounded to whole pixels and KaTeX rounds some of its own
  // sizes; a pixel over would still show a scroll bar, so take it off.
  for (let tries = 0; tries < 3 && element.scrollWidth > element.clientWidth; tries += 1) {
    size *= (element.clientWidth - 1) / element.scrollWidth
    element.style.fontSize = `${size}px`
  }
  return plan.mode
}

// rects: the pieces' boxes in order. A piece that starts left of where the
// one before it ended, or below it, opens a new line.
export function groupLines(rects) {
  const lines = []
  let previous = null
  for (const rect of rects) {
    if (!(rect.right > rect.left)) continue
    const line = lines.at(-1)
    if (line && rect.left >= previous.right - 2 && rect.top < line.bottom) {
      line.right = Math.max(line.right, rect.right)
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }
    previous = rect
  }
  return lines
}

// The formula's lines in pixels from the top left of its box.
export function formulaLines(element) {
  const origin = element.getBoundingClientRect()
  return groupLines(pieces(element).map(piece => {
    const box = piece.getBoundingClientRect()
    return { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top }
  }))
}

const px = value => `${Math.round(value * 10) / 10}px`

// What is written at `progress` (0–1): the lines before the current one in
// full, the current one from its start up to the pen. clip is a CSS
// clip-path on the formula's box ('' once it is all written); pen is where
// the pencil's tip goes, in the box's pixels. Lines between them split the
// gap; the first reaches the box's top and the last its bottom.
export function writtenPart(lines, progress) {
  if (progress >= 1) return { clip: '', pen: null }
  if (!lines.length) return { clip: `inset(0 ${Math.round((1 - Math.max(0, progress)) * 1000) / 10}% 0 0)`, pen: null }
  const total = lines.reduce((sum, line) => sum + (line.right - line.left), 0)
  let budget = Math.max(0, progress) * total
  for (const [index, line] of lines.entries()) {
    const span = line.right - line.left
    if (budget > span && index < lines.length - 1) {
      budget -= span
      continue
    }
    const x = line.left + Math.min(span, budget)
    const top = index ? px((lines[index - 1].bottom + line.top) / 2) : '0'
    const bottom = index < lines.length - 1 ? px((line.bottom + lines[index + 1].top) / 2) : '100%'
    return { clip: `polygon(0 0, 100% 0, 100% ${top}, ${px(x)} ${top}, ${px(x)} ${bottom}, 0 ${bottom})`, pen: { x, y: line.bottom } }
  }
  return { clip: '', pen: null }
}
