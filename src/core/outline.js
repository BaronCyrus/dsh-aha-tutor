// The structure of a material: its outline (table of contents) and the page
// numbers printed on its pages. Everything here works on plain data read
// from the file: lines of text with where they sit on the page, bookmarks,
// page labels, headings.
//
// A line is { text, y, size }: y runs from 0 at the bottom of the page to 1
// at the top, size is the font size.

export const OUTLINE_LIMITS = Object.freeze({ entries: 200, title: 120, levels: 3 })

// The top and bottom tenth of a page hold running heads and page numbers.
const ZONE = 0.1
const inZone = line => line.y >= 1 - ZONE || line.y <= ZONE

const visible = value => String(value ?? '').replace(/\s+/gu, '')

// A running head or foot repeats on many pages; its numbers change.
const furnitureForm = text => visible(text).replace(/\d+/gu, '#').toLowerCase()

// ── printed page numbers ────────────────────────────────────────────────────

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

export function romanValue(value) {
  const letters = String(value ?? '').toLowerCase()
  if (!/^[ivxlcdm]{1,8}$/u.test(letters)) return 0
  let total = 0
  for (let index = 0; index < letters.length; index += 1) {
    const here = ROMAN[letters[index]]
    const next = ROMAN[letters[index + 1]] ?? 0
    total += here < next ? -here : here
  }
  // Only the canonical spelling counts ("iiii" or "vx" is not a number).
  return total > 0 && toRoman(total) === letters ? total : 0
}

export function toRoman(number) {
  let rest = Math.floor(number)
  let out = ''
  for (const [value, letters] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) {
    while (rest >= value) {
      out += letters
      rest -= value
    }
  }
  return out
}

// A page number on its own line, perhaps dressed ("- 12 -", "·12·", "第12页"),
// or at either end of a running head ("12 数学 五年级上册").
const DRESS = '\\s\\-–—·•|_~()（）\\[\\]【】'
const FOLIO_ALONE = new RegExp(`^[${DRESS}第]*(\\d{1,4})[${DRESS}页]*$`, 'u')
const ROMAN_ALONE = new RegExp(`^[${DRESS}]*([ivxlcdm]{1,7})[${DRESS}]*$`, 'iu')
const FOLIO_LEAD = /^(\d{1,4})\s+\S/u
const FOLIO_TAIL = /\S\s+(\d{1,4})$/u

function folioOf(text) {
  const value = String(text ?? '').trim()
  const alone = FOLIO_ALONE.exec(value)
  if (alone) return { kind: 'arabic', number: Number(alone[1]) }
  const roman = ROMAN_ALONE.exec(value)
  if (roman && romanValue(roman[1])) return { kind: 'roman', number: romanValue(roman[1]) }
  const end = FOLIO_LEAD.exec(value) ?? FOLIO_TAIL.exec(value)
  return end ? { kind: 'arabic', number: Number(end[1]) } : null
}

// Pages whose printed numbers agree (page index minus number is the same)
// form a run; a run of at least three pages, with gaps of a few unnumbered
// pages (chapter openers, full-page figures), numbers every page in it and
// two pages either side. Where runs overlap, the longer one wins.
const MAX_GAP = 6
const MIN_RUN = 3

function folioRuns(folios, pageCount) {
  const byOffset = new Map()
  for (const folio of folios) {
    const key = `${folio.kind}:${folio.page - folio.number}`
    if (!byOffset.has(key)) byOffset.set(key, [])
    byOffset.get(key).push(folio)
  }
  const runs = []
  for (const members of byOffset.values()) {
    members.sort((a, b) => a.page - b.page)
    let run = [members[0]]
    for (const folio of members.slice(1)) {
      if (folio.page === run.at(-1).page) continue
      if (folio.page - run.at(-1).page > MAX_GAP) {
        runs.push(run)
        run = [folio]
      } else {
        run.push(folio)
      }
    }
    runs.push(run)
  }
  const needed = pageCount <= 8 ? 2 : MIN_RUN
  return runs.filter(run => run.length >= needed).sort((a, b) => b.length - a.length)
}

// The printed page numbers of a document from what its pages show, and the
// lines that are page furniture (running heads and feet, page numbers), so
// they can be left out of the text. pages: [{ lines }]. Returns labels (a
// string or null for each page; null throughout when the printed numbers
// are just the page order) and furniture (for each page, the indexes of its
// lines to leave out).
export function readPageNumbers(pages) {
  const count = pages.length
  const forms = new Map()
  pages.forEach((page, pageIndex) => {
    for (const line of page.lines ?? []) {
      if (!inZone(line)) continue
      const form = furnitureForm(line.text)
      if (!form) continue
      if (!forms.has(form)) forms.set(form, new Set())
      forms.get(form).add(pageIndex)
    }
  })
  const repeats = Math.max(3, Math.min(4, Math.ceil(count * 0.3)))
  const running = new Set([...forms].filter(([form, seen]) => form !== '#' && seen.size >= repeats).map(([form]) => form))

  const folios = []
  pages.forEach((page, pageIndex) => {
    for (const [lineIndex, line] of (page.lines ?? []).entries()) {
      if (!inZone(line)) continue
      const folio = folioOf(line.text)
      if (folio && folio.number > 0) folios.push({ ...folio, page: pageIndex, line: lineIndex })
    }
  })
  const labels = new Array(count).fill(null)
  const owner = new Array(count).fill(null)
  for (const run of count >= 2 ? folioRuns(folios, count) : []) {
    const offset = run[0].page - run[0].number
    const from = Math.max(0, run[0].page - 2)
    const to = Math.min(count - 1, run.at(-1).page + 2)
    for (let page = from; page <= to; page += 1) {
      const number = page - offset
      if (owner[page] || number < 1) continue
      owner[page] = run
      labels[page] = run[0].kind === 'roman' ? toRoman(number) : String(number)
    }
  }
  // Page numbers are furniture even when they are just the page order.
  const furniture = pages.map((page, pageIndex) => {
    const drop = []
    for (const [lineIndex, line] of (page.lines ?? []).entries()) {
      if (!inZone(line)) continue
      const folio = folioOf(line.text)
      const numbered = folio && labels[pageIndex] !== null && (folio.kind === 'roman' ? toRoman(folio.number) : String(folio.number)) === labels[pageIndex]
      if (numbered || running.has(furnitureForm(line.text))) drop.push(lineIndex)
    }
    return drop
  })
  const plain = labels.every((label, index) => label === null || label === String(index + 1))
  return { labels: plain ? new Array(count).fill(null) : labels, furniture, running }
}

// Page labels a PDF declares (pdf.js getPageLabels), unless they only
// repeat the page order. null when there are none worth keeping.
export function declaredLabels(labels, pageCount) {
  if (!Array.isArray(labels) || labels.length !== pageCount) return null
  const clean = labels.map(label => {
    const value = String(label ?? '').replace(/\s+/gu, ' ').trim().slice(0, 16)
    return value || null
  })
  return clean.every((label, index) => label === null || label === String(index + 1)) ? null : clean
}

// ── outlines ────────────────────────────────────────────────────────────────

const cleanTitle = value => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, OUTLINE_LIMITS.title)

// Bookmarks as pdf.js gives them ({ title, dest, items }), flattened in
// order with their depth. A single bookmark holding all the others (the
// book's own title) is left out.
export function flattenBookmarks(items) {
  let top = Array.isArray(items) ? items : []
  while (top.length === 1 && top[0]?.items?.length) top = top[0].items
  const flat = []
  const walk = (list, level) => {
    for (const item of list ?? []) {
      if (flat.length >= OUTLINE_LIMITS.entries * 2) return
      flat.push({ title: cleanTitle(item?.title), level, dest: item?.dest ?? null })
      if (item?.items?.length) walk(item.items, level + 1)
    }
  }
  walk(top, 1)
  return flat
}

// An outline in page order with each entry's last page: up to the page
// before the next entry at its level or above. Entries without a page in
// the document or a title are left out; levels below the third fold into
// it; a long outline loses its deepest level until it fits.
export function finishOutline(entries, pageCount) {
  let list = (entries ?? [])
    .map((entry, index) => ({ title: cleanTitle(entry.title), level: Math.max(1, Math.round(entry.level) || 1), page: Math.round(entry.page), index }))
    .filter(entry => entry.title && entry.page >= 1 && entry.page <= pageCount)
    .sort((a, b) => a.page - b.page || a.index - b.index)
  const seen = new Set()
  list = list.filter(entry => {
    const key = `${entry.page}:${visible(entry.title)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!list.length) return []
  const shallowest = Math.min(...list.map(entry => entry.level))
  for (const entry of list) entry.level = Math.min(OUTLINE_LIMITS.levels, entry.level - shallowest + 1)
  while (list.length > OUTLINE_LIMITS.entries && list.some(entry => entry.level > 1)) {
    const deepest = Math.max(...list.map(entry => entry.level))
    list = list.filter(entry => entry.level < deepest)
  }
  list = list.slice(0, OUTLINE_LIMITS.entries)
  return list.map((entry, index) => {
    const next = list.slice(index + 1).find(other => other.level <= entry.level)
    return { title: entry.title, level: entry.level, page: entry.page, end: next ? Math.max(entry.page, next.page - 1) : pageCount }
  })
}

// Headings of a document without bookmarks, found on its pages: a chapter,
// unit or section title ("第三单元 小数除法", "Chapter 2", "2.3 Limits")
// near the top of a page or set larger than the text, or any short line
// set much larger than the text in the upper half of a page. Contents pages
// are skipped (their titles are found again where the chapters begin), and
// a title is kept once. pages: [{ lines }]; running: forms of the running
// heads to skip (see readPageNumbers). Returns [{ title, level, page }].
const NUMBER = '[一二三四五六七八九十百零〇两\\d]+'
const CHAPTER = new RegExp(`^(?:第\\s*${NUMBER}\\s*[章单元篇编部]|(?:chapter|unit|part|module)\\s+(?:\\d+|[ivxlc]+)\\b)`, 'iu')
const SECTION = new RegExp(`^(?:第\\s*${NUMBER}\\s*[节课讲]|(?:section|lesson)\\s+\\d+|\\d{1,2}\\.\\d{1,2}(?:\\.\\d{1,2})?\\s+[^\\d\\s.]|§\\s*\\d+)`, 'iu')
// Recurring boxes of a textbook page, never chapters.
const BOXES = /^(?:例\s*\d*|例题\s*\d*|练习\s*[一二三四五六七八九十\d]*|习题\s*[\d.]*|做一做|练一练|想一想|议一议|试一试|读一读|说一说|算一算|填一填|你知道吗？?|思考|探究|实验|阅读|小结|复习题?|答案|目\s*录|前\s*言|contents|exercises?|examples?\s*\d*|problems?|summary|review)$/iu
const CONTENTS_TITLE = /^(?:目\s*录|contents|table of contents)$/iu
const CONTENTS_LINE = /^.{1,60}?(?:[.…·．_]{3,}|\s{2,})\s*\d{1,4}$/u
const SENTENCE_END = /[。，；：、.,;:!?！？]$/u
// Headings are not sentences: no commas or full stops inside.
const SENTENCE_INSIDE = /[，。；,;]|\.\s/u

export function headingOutline(pages, { running = new Set() } = {}) {
  const sizes = new Map()
  for (const page of pages) {
    for (const line of page.lines ?? []) {
      const weight = visible(line.text).length
      const size = Math.round((Number(line.size) || 0) * 2) / 2
      if (weight && size > 0) sizes.set(size, (sizes.get(size) ?? 0) + weight)
    }
  }
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const sizeOf = line => Number(line.size) || 0
  const found = []
  pages.forEach((page, pageIndex) => {
    const lines = (page.lines ?? []).filter(line => visible(line.text) && !running.has(furnitureForm(line.text)))
    const contents = lines.some(line => CONTENTS_TITLE.test(line.text.trim())) || lines.filter(line => CONTENTS_LINE.test(line.text.trim())).length >= 4
    // The first two lines of a page, when they are near its top.
    const top = [...lines].sort((a, b) => b.y - a.y).slice(0, 2).filter(line => line.y >= 0.75)
    // A page with no text at the text's size is a cover or a picture: its
    // big lines are not headings unless they say they are.
    const texted = lines.some(line => Math.abs(sizeOf(line) - body) <= body * 0.1)
    for (const line of lines) {
      const title = cleanTitle(line.text)
      const length = visible(title).length
      if (length < 2 || length > 40 || SENTENCE_END.test(title) || SENTENCE_INSIDE.test(title) || /^\d+$/u.test(visible(title))) continue
      const larger = body > 0 && sizeOf(line) >= body * 1.1
      let kind = ''
      if (CHAPTER.test(title) && (larger || top.includes(line))) kind = 'chapter'
      else if (SECTION.test(title) && (larger || top.includes(line))) kind = 'section'
      else if (texted && body > 0 && sizeOf(line) >= body * 1.25 && line.y >= 0.5 && !BOXES.test(title)) kind = 'size'
      if (kind) found.push({ title, kind, size: sizeOf(line), page: pageIndex + 1, contents })
    }
  })
  // Headings are ranked by size: the largest are the chapters, the next the
  // sections; one that names itself a chapter or section is one.
  const merged = []
  for (const size of [...new Set(found.map(entry => entry.size))].sort((a, b) => b - a)) if (!merged.length || size < merged.at(-1) * 0.92) merged.push(size)
  const rankOf = size => Math.min(OUTLINE_LIMITS.levels, merged.findIndex(step => size >= step * 0.92) + 1 || OUTLINE_LIMITS.levels)
  const levelOf = entry => (entry.kind === 'chapter' ? 1 : entry.kind === 'section' ? Math.max(2, rankOf(entry.size)) : rankOf(entry.size))
  const seen = new Set()
  const entries = []
  for (const entry of found.filter(item => !item.contents)) {
    const key = visible(entry.title).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ title: entry.title, level: levelOf(entry), page: entry.page })
  }
  entries.sort((a, b) => a.page - b.page)
  // More headings than pages is noise; keep the chapters, or nothing.
  if (entries.length > Math.max(60, pages.length * 1.5)) {
    const chapters = entries.filter(entry => entry.level === 1)
    return chapters.length >= 2 && chapters.length <= Math.max(60, pages.length) ? chapters : []
  }
  return entries.length >= 2 ? entries : []
}

// ── outlines of documents without pages ─────────────────────────────────────

// Sections of a document in order ({ title, level } with the position of
// their first chunk, `start`) as an outline over chunk positions: each
// entry runs to the chunk before the next entry at its level or above.
// total: the number of chunks.
export function sectionOutline(sections, total) {
  const list = (sections ?? []).filter(section => cleanTitle(section.title) && section.start < total).slice(0, OUTLINE_LIMITS.entries)
  if (!list.length) return []
  const shallowest = Math.min(...list.map(section => section.level))
  return list.map((section, index) => {
    const level = Math.min(OUTLINE_LIMITS.levels, section.level - shallowest + 1)
    const next = list.slice(index + 1).find(other => Math.min(OUTLINE_LIMITS.levels, other.level - shallowest + 1) <= level)
    return { title: cleanTitle(section.title), level, first: section.start + 1, last: Math.max(section.start + 1, next ? next.start : total) }
  })
}

// Where a paged outline's entries are among the chunks: the first and last
// chunk numbers (1-based) of each entry's pages, and the printed numbers of
// its first and last pages. chunks: [{ page }] in order; labels: the
// printed number of each page, or null.
export function placeOutline(entries, chunks, labels) {
  return (entries ?? []).map(entry => {
    let first = 0
    let last = 0
    chunks.forEach((chunk, index) => {
      if (chunk.page >= entry.page && chunk.page <= entry.end) {
        if (!first) first = index + 1
        last = index + 1
      }
    })
    const label = labels?.[entry.page - 1]
    const endLabel = labels?.[entry.end - 1]
    return { ...entry, ...(first ? { first, last } : {}), ...(label ? { label } : {}), ...(endLabel ? { endLabel } : {}) }
  })
}
