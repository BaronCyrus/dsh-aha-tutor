// Board layout: steps' ops flow into pages of two columns. Explicit `col`
// and `page` ops are honored; when the model forgets them, estimated heights
// break columns and pages automatically so nothing runs off the board.

const COLUMN_CAPACITY = 26

function lines(textValue, perLine) {
  return Math.max(1, Math.ceil(String(textValue ?? '').length / perLine))
}

export function estimateHeight(op) {
  switch (op.t) {
    case 'title':
      return 1.6
    case 'h':
      return 1.4
    case 'p':
      return lines(op.text, 26) * 1.05
    case 'math':
      return 2
    case 'list':
      return op.items.reduce((sum, item) => sum + lines(item, 24), 0) * 1.05
    case 'note':
      return lines(op.text, 24) + 1
    case 'table':
      return (op.rows.length + 1) * 1.1 + 0.6
    case 'code':
      return Math.min(14, op.code.split('\n').length * 0.8 + 1)
    case 'svg':
    case 'chart':
      return 8.5
    case 'anim':
      return Math.round(op.height / 34)
    default:
      return 0
  }
}

// Returns { pages: [{ title, columns: [[entry], [entry]] }], where: Map(opId → { page, column }) }
// Each entry: { op, step } (step index the op belongs to).
export function layoutBoard(steps) {
  const pages = []
  const where = new Map()
  let page = null
  let column = 0
  let used = 0
  // Set when overflow (not the script) moved writing to the right column, so
  // the script's own `col` that follows does not also turn the page.
  let overflowed = false

  const newPage = title => {
    page = { title: title ?? '', columns: [[], []] }
    pages.push(page)
    column = 0
    used = 0
    overflowed = false
  }
  newPage('')

  steps.forEach((step, stepIndex) => {
    for (const op of step.ops ?? []) {
      if (op.t === 'page') {
        if (page.columns[0].length || page.columns[1].length) newPage(op.title)
        else page.title = op.title || page.title
        where.set(op.id, { page: pages.length - 1, column })
        continue
      }
      if (op.t === 'col') {
        if (column === 0) {
          column = 1
          used = 0
        } else if (overflowed) {
          overflowed = false
        } else {
          newPage('')
        }
        where.set(op.id, { page: pages.length - 1, column })
        continue
      }
      if (op.t === 'mark') {
        where.set(op.id, where.get(op.ref) ?? { page: pages.length - 1, column })
        continue
      }
      if (op.t === 'title') {
        if (page.columns[0].length || page.columns[1].length) newPage(op.text)
        else page.title = op.text
        where.set(op.id, { page: pages.length - 1, column: 0, title: true })
        continue
      }
      const height = estimateHeight(op)
      if (used > 0 && used + height > COLUMN_CAPACITY) {
        if (column === 0) {
          column = 1
          used = 0
          overflowed = true
        } else {
          newPage('')
        }
      }
      page.columns[column].push({ op, step: stepIndex })
      where.set(op.id, { page: pages.length - 1, column })
      used += height
    }
  })
  return { pages, where }
}

// Give inserted steps (answers to questions, re-explanations) unique op ids
// so they never collide with the lesson's own ops.
export function reidSteps(steps, prefix) {
  return steps.map((step, stepIndex) => {
    const map = new Map(step.ops.map(op => [op.id, `${prefix}${op.id}`]))
    return {
      ...step,
      id: `${prefix}${step.id ?? stepIndex}`,
      aside: true,
      ops: step.ops.map(op => ({ ...op, id: map.get(op.id), ...(op.t === 'mark' ? { ref: map.get(op.ref) ?? op.ref } : {}) })),
      ...(step.check ? { check: { ...step.check, id: `${prefix}${step.check.id}` } } : {}),
    }
  })
}

// The text a board will write, to fetch its font slices before the pencil
// reaches them (a slice swapped in mid-stroke would make the line jump).
export function boardText(steps, max = 12000) {
  const parts = []
  for (const step of steps) {
    for (const op of step.ops) {
      if (op.text) parts.push(op.text)
      if (op.caption) parts.push(op.caption)
      if (op.items) parts.push(...op.items)
      if (op.head) parts.push(...op.head)
      if (op.rows) for (const row of op.rows) parts.push(...row)
    }
  }
  return [...new Set([...parts.join('')])].join('').slice(0, max)
}
