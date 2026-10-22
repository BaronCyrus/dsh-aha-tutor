// A course outline as a mind map that grows to the right: the course at the
// left, then its units, lectures and lessons, each centred on what hangs from
// it. Text sizes are estimated, not measured, so the map can be laid out
// while the outline is still being written. Pure geometry.

// Per level: widest box, font size, line height and padding, in CSS pixels.
export const MAP_LEVELS = Object.freeze([
  { maxWidth: 210, font: 16, line: 22, padX: 16, padY: 11 },
  { maxWidth: 220, font: 14.5, line: 20, padX: 14, padY: 9 },
  { maxWidth: 210, font: 13.5, line: 19, padX: 12, padY: 8 },
  { maxWidth: 250, font: 13.5, line: 19, padX: 12, padY: 7 },
])
export const MAP_GAP = Object.freeze({ x: 56, y: 10, unit: 18, meta: 20 })
// Room for borders, bold type and fonts a little wider than estimated.
const SLACK = 12

const WIDE = /[⺀-￿]/u

// How wide a line of text is drawn, in pixels at this font size.
export function textWidth(value, font) {
  let width = 0
  for (const char of String(value ?? '')) width += WIDE.test(char) ? font : char === ' ' ? font * 0.3 : font * 0.58
  return width
}

function box(title, level, hasMeta) {
  const spec = MAP_LEVELS[level]
  const inner = spec.maxWidth - spec.padX * 2 - SLACK
  const width = textWidth(title, spec.font)
  const lines = Math.max(1, Math.ceil(width / inner))
  return {
    w: Math.ceil(Math.min(spec.maxWidth, Math.max(56, width + spec.padX * 2 + SLACK))),
    h: Math.ceil(lines * spec.line + spec.padY * 2 + (hasMeta ? MAP_GAP.meta : 0)),
  }
}

// tree: { title, units: [{ key, title, lectures: [{ key, title, lessons:
// [{ key, title, meta? }] }] }] }. Returns nodes ({ key, level, x, y, w, h,
// title, meta }), links ({ from, to }), the map's size, and `last`: the key
// of the node written last (the newest while the outline grows).
export function layoutMindMap(tree) {
  const nodes = []
  const links = []
  const root = { key: 'root', title: tree?.title ?? '', children: (tree?.units ?? []).map(unit => ({
    key: unit.key,
    title: unit.title,
    children: (unit.lectures ?? []).map(lecture => ({
      key: lecture.key,
      title: lecture.title,
      children: (lecture.lessons ?? []).map(lesson => ({ key: lesson.key, title: lesson.title, meta: lesson.meta ?? null, children: [] })),
    })),
  })) }

  // Column widths: the widest box at each level.
  const sizes = new Map()
  const columns = [0, 0, 0, 0]
  const measure = (node, level) => {
    const size = box(node.title, level, Boolean(node.meta))
    sizes.set(node, size)
    columns[level] = Math.max(columns[level], size.w)
    for (const child of node.children) measure(child, level + 1)
  }
  measure(root, 0)
  const columnX = [0]
  for (let level = 1; level < 4; level += 1) columnX[level] = columnX[level - 1] + columns[level - 1] + MAP_GAP.x

  // Leaves stack downwards; a parent sits at the middle of its children,
  // never overlapping the box above it in its own column.
  let cursor = 0
  const columnBottom = [-Infinity, -Infinity, -Infinity, -Infinity]
  let last = 'root'
  const place = (node, level) => {
    const { w, h } = sizes.get(node)
    let centre
    if (!node.children.length) {
      centre = cursor + h / 2
      cursor += h + MAP_GAP.y
    } else {
      const children = node.children.map((child, index) => {
        if (level === 0 && index > 0) cursor += MAP_GAP.unit
        return place(child, level + 1)
      })
      centre = (children[0].centre + children[children.length - 1].centre) / 2
      for (const child of node.children) links.push({ from: node.key, to: child.key })
    }
    let y = centre - h / 2
    if (y < columnBottom[level] + MAP_GAP.y) y = columnBottom[level] + MAP_GAP.y
    columnBottom[level] = y + h
    cursor = Math.max(cursor, y + h + MAP_GAP.y)
    nodes.push({ key: node.key, level, x: columnX[level], y, w, h, title: node.title, meta: node.meta ?? null })
    if (node.key !== 'root' || !node.children.length) last = lastKey(node)
    return { centre: y + h / 2 }
  }
  place(root, 0)
  const width = Math.max(...nodes.map(node => node.x + node.w))
  const height = Math.max(...nodes.map(node => node.y + node.h))
  // Parents are placed after their children; drawing order follows the tree.
  const order = new Map()
  let index = 0
  const walk = node => {
    order.set(node.key, index++)
    node.children.forEach(walk)
  }
  walk(root)
  nodes.sort((a, b) => order.get(a.key) - order.get(b.key))
  return { nodes, links, width, height, last }
}

function lastKey(node) {
  let current = node
  while (current.children.length) current = current.children[current.children.length - 1]
  return current.key
}

// An outline being written (titles only) as a map tree, with keys that stay
// the same as it grows.
export function outlineTree(outline, fallbackTitle = '') {
  return {
    title: outline?.title || fallbackTitle,
    units: (outline?.units ?? []).map((unit, unitIndex) => ({
      key: `u${unitIndex}`,
      title: unit.title,
      lectures: (unit.lectures ?? []).map((lecture, lectureIndex) => ({
        key: `u${unitIndex}.${lectureIndex}`,
        title: lecture.title || '…',
        lessons: (lecture.lessons ?? []).map((lesson, lessonIndex) => ({ key: `u${unitIndex}.${lectureIndex}.${lessonIndex}`, title: typeof lesson === 'string' ? lesson : lesson?.title ?? '' })),
      })),
    })),
  }
}
