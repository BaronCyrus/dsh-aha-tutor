// Page references in text: what a learner asks about ("书上第12页的例2"),
// and what a model claims it read. A page the model names is shown only when
// it was among the pages that call actually read (scrubPages), and a cheat
// sheet's citation only when the words it quotes are found in the material
// (checkCite), on the page where they are.

// "第12页", "第 12–14 页", "第12至13页", and "12页" after a word that points
// at a page ("课本12页", "翻到12页"), not one that counts them ("共3页").
const CJK_PAGES = /(?:第\s*|(?<=(?:课本|教材|书本|书上|书|讲义|资料|原文|看|翻到|翻开|见|参见|参看|详见|在|到)\s?))(\d{1,4})\s*(?:[-–—~～至到]\s*(?:第\s*)?(\d{1,4})\s*)?页/gu
// "p.12", "p. 12", "pp. 12–14", "page 12", "pages 12-14"
const LATIN_PAGES = /\b(?:pp?\.|pages?)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\b/giu
// A range longer than this names its two ends only.
const MAX_RANGE = 20

function pagesOf(first, last) {
  const from = Number(first)
  const to = last ? Number(last) : from
  if (!(from > 0)) return []
  if (!(to >= from) || to - from > MAX_RANGE) return [String(from), ...(to > from ? [String(to)] : [])]
  return Array.from({ length: to - from + 1 }, (_, index) => String(from + index))
}

// Every page reference in `text`, in order: { start, end, pages, ends,
// latin }, where pages are the page numbers it names (as strings) and ends
// its first and last.
export function pageMentions(text) {
  const value = String(text ?? '')
  const found = []
  for (const [pattern, latin] of [[CJK_PAGES, false], [LATIN_PAGES, true]]) {
    for (const match of value.matchAll(pattern)) {
      const pages = pagesOf(match[1], match[2])
      if (pages.length) found.push({ start: match.index, end: match.index + match[0].length, pages, ends: [String(Number(match[1])), String(Number(match[2] ?? match[1]))], latin })
    }
  }
  found.sort((a, b) => a.start - b.start)
  return found.filter((mention, index) => !found.slice(0, index).some(other => mention.start < other.end))
}

// The page numbers `text` names, each once.
export function mentionedPages(text) {
  return [...new Set(pageMentions(text).flatMap(mention => mention.pages))]
}

// The pages some passages are on, as their labels name them: the number
// printed on the page, else its place in the file.
export function readPages(passages) {
  return new Set((passages ?? []).map(passage => passage?.label ?? (passage?.page ? String(passage.page) : null)).filter(Boolean))
}

// ── leaving out pages that were not read ────────────────────────────────────

const OPEN = new Set(['(', '（', '['])
const CLOSE = { '(': ')', '（': '）', '[': ']' }
// What a bracketed citation may hold besides its pages.
const CITATION_WORDS = /^(?:\s|[,，;；:：.。、]|见|参见|参看|详见|课本|教材|书本|书上|书|讲义|资料|原文|上|中|的|和|与|及|see|cf|also|on|in|at|the|textbook|book|text|and|p|pp)*$/iu
const BOOK_BEFORE = /(?:课本|教材|书本|书上|书|讲义|资料|原文)(?:的|上|中)?\s*$/u
const STOPS = /[。！？!?]/gu

// The bracketed stretch around [start, end) when it is only a citation
// ("（见课本第12页）", "(p. 12)"): [open, close + 1], else null.
function citationBrackets(value, start, end) {
  let open = -1
  for (let at = start - 1; at >= Math.max(0, start - 16); at -= 1) {
    if (OPEN.has(value[at])) {
      open = at
      break
    }
    if (Object.values(CLOSE).includes(value[at])) return null
  }
  if (open < 0) return null
  const close = value.indexOf(CLOSE[value[open]], end)
  if (close < 0 || close - end > 16) return null
  const rest = value.slice(open + 1, start) + value.slice(end, close)
  const others = pageMentions(rest)
  const words = others.reduceRight((left, mention) => left.slice(0, mention.start) + left.slice(mention.end), rest)
  return CITATION_WORDS.test(words) ? [open, close + 1] : null
}

// `text` with every page reference to a page outside `allowed` (a Set of
// page numbers as strings) left out: a bracketed citation goes whole; "课本
// 第12页的例2" becomes "课本的例2", "看第12页的图" becomes "看书上的图", "see
// page 12" becomes "see the book". A range counts when both its ends were
// read. Sentence ends are kept, so a step's sentences keep their count.
export function scrubPages(text, allowed) {
  const value = String(text ?? '')
  const mentions = pageMentions(value).filter(mention => !mention.ends.every(page => allowed?.has(page)))
  if (!mentions.length) return value
  let out = ''
  let at = 0
  for (const mention of mentions) {
    if (mention.start < at) continue
    const brackets = citationBrackets(value, mention.start, mention.end)
    if (brackets) {
      const [from, to] = brackets
      out += value.slice(at, from).replace(/[ \t]+$/u, '')
      out += (value.slice(from, to).match(STOPS) ?? []).join('')
      at = to
      continue
    }
    const before = value.slice(at, mention.start)
    at = mention.end
    if (mention.latin) {
      const on = /\b(?:on|at|in)\s+$/iu.exec(before)
      out += on ? `${before.slice(0, on.index)}in the book` : `${before}the book`
    } else if (BOOK_BEFORE.test(value.slice(0, mention.start))) {
      out += before.replace(/\s+$/u, '')
      // "课本的第12页的例2" reads "课本的例2", not "课本的的例2".
      if ('上的中'.includes(value[at]) && out.endsWith(value[at])) at += 1
    } else {
      out += `${before}书上`
      if (value[at] === '上') at += 1
    }
  }
  out += value.slice(at)
  return out.replace(/[（(]\s*[)）]/gu, '').replace(/ {2,}/gu, ' ').replace(/ +([,.;:!?，。；：！？、])/gu, '$1').trim()
}

const scrubList = (list, clean) => (Array.isArray(list) ? list.map(entry => (typeof entry === 'string' ? clean(entry) : entry)) : list)

// A practice, quiz or check question with its pages checked (see
// scrubPages). The answer key of a blank, number or choice stays as it is.
export function scrubItem(item, allowed) {
  if (!item || typeof item !== 'object') return item
  const clean = value => (typeof value === 'string' ? scrubPages(value, allowed) : value)
  const next = { ...item }
  for (const key of ['prompt', 'explanation']) if (typeof item[key] === 'string') next[key] = clean(item[key])
  for (const key of ['hints', 'rubric']) if (Array.isArray(item[key])) next[key] = scrubList(item[key], clean)
  if (Array.isArray(item.options)) next.options = item.options.map(option => (option && typeof option === 'object' ? { ...option, text: clean(option.text) } : option))
  if ((item.kind === 'short' || item.kind === 'work') && typeof item.answer === 'string') next.answer = clean(item.answer)
  return next
}

const WORDED = new Set(['title', 'h', 'p', 'note'])

// A board step with its pages checked (see scrubPages): what is said, what
// is written and its check. A heading or paragraph that was only a
// citation is left out.
export function scrubStep(step, allowed) {
  if (!step || typeof step !== 'object') return step
  const clean = value => (typeof value === 'string' ? scrubPages(value, allowed) : value)
  const ops = (step.ops ?? []).map(op => {
    const next = { ...op }
    for (const key of ['text', 'caption', 'title']) if (typeof next[key] === 'string') next[key] = clean(next[key])
    if (Array.isArray(next.items)) next.items = scrubList(next.items, clean).filter(entry => entry !== '')
    if (Array.isArray(next.head)) next.head = scrubList(next.head, clean)
    if (Array.isArray(next.rows)) next.rows = next.rows.map(row => scrubList(row, clean))
    return next
  }).filter(op => !(WORDED.has(op.t) && !op.text) && !(op.t === 'list' && !op.items?.length))
  return { ...step, say: clean(step.say), ops, ...(step.check ? { check: scrubItem(step.check, allowed) } : {}) }
}

// Every string in a plain object (a handout, a digest, a brief) with its
// pages checked, except the keys named in `keep`.
export function scrubDeep(value, allowed, keep = new Set()) {
  if (typeof value === 'string') return scrubPages(value, allowed)
  if (Array.isArray(value)) return value.map(entry => scrubDeep(entry, allowed, keep))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, keep.has(key) ? entry : scrubDeep(entry, allowed, keep)]))
}

// A course blueprint with its pages checked: the titles, summaries and
// objectives it writes name only pages its materials' contents list.
const BLUEPRINT_KEEP = new Set(['id', 'sources', 'terms', 'kind', 'depth', 'estMinutes', 'unitId', 'starterFiles', 'language', 'emoji', 'level', 'concepts', 'points'])
export function scrubBlueprint(blueprint, allowed) {
  return scrubDeep(blueprint, allowed, BLUEPRINT_KEEP)
}

// ── quotes ──────────────────────────────────────────────────────────────────

// Text as compared for quotes: the same characters whatever their width or
// case, without spaces, punctuation or hyphens (line breaks in a PDF put
// them anywhere).
export function squeeze(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}­]+/gu, '')
}

// The passage holding `quote`: all of it, or failing that one half of a
// long quote (a model slips at one end). Among several, the one on page
// `prefer` (as printed), else the first. null when none holds it.
export function locateQuote(quote, passages, prefer) {
  const wanted = squeeze(quote)
  if (wanted.length < 6) return null
  const probes = [wanted]
  if (wanted.length >= 20) probes.push(wanted.slice(0, Math.ceil(wanted.length / 2)), wanted.slice(Math.floor(wanted.length / 2)))
  for (const probe of probes) {
    const found = (passages ?? []).filter(passage => squeeze(passage?.text).includes(probe))
    if (found.length) return found.find(passage => (passage.label ?? String(passage.page)) === String(prefer ?? '')) ?? found[0]
  }
  return null
}

// A cheat sheet's citation, checked: the words it quotes are looked for in
// the passages the sheet was written from (`read`), then in the whole of
// its materials (`all`). Found, it cites the page they are on (as printed;
// `pdf` is its place in the file), or the section of a material without
// pages, with its material; not found, there is no citation.
export function checkCite(cite, { read = [], all = [] } = {}) {
  if (!cite || typeof cite !== 'object') return null
  const quote = String(cite.quote ?? '').trim()
  const found = locateQuote(quote, read, cite.page) ?? locateQuote(quote, all, cite.page)
  if (!found?.page && !found?.section) return null
  return {
    ...(found.page ? { page: found.label ?? String(found.page), pdf: found.page } : { section: String(found.section).slice(0, 80) }),
    source: String(found.source ?? cite.source ?? '').slice(0, 120),
    ...(found.materialId ? { materialId: found.materialId } : {}),
    quote: quote.slice(0, 200),
    verified: true,
  }
}

// ── page ranges in notes ────────────────────────────────────────────────────

// "12–18", "p. 12-18", "12": the first and last page, or null.
export function rangeEnds(value) {
  const match = /^\s*(?:pp?\.?\s*)?(\d{1,4})\s*(?:[-–—~～至到,，]\s*(\d{1,4}))?\s*页?\s*$/iu.exec(String(value ?? ''))
  return match ? [String(Number(match[1])), String(Number(match[2] ?? match[1]))] : null
}

// A page or range a note gives, kept when both its ends were read (and
// written the same way every time), else ''.
export function checkRange(value, allowed) {
  const ends = rangeEnds(value)
  if (!ends || !ends.every(page => allowed?.has(page))) return ''
  return ends[0] === ends[1] ? ends[0] : `${ends[0]}–${ends[1]}`
}

// ── what is kept and what is shown ──────────────────────────────────────────

const NO_PAGES = new Set()

// A board as it is shown: one written before pages were checked
// (`pagesChecked`) shows no page numbers at all.
export function shownBoard(board) {
  if (!Array.isArray(board?.steps) || board.pagesChecked) return board
  return { ...board, steps: board.steps.map(step => scrubStep(step, NO_PAGES)) }
}

// The same for an answer kept with a lesson (a raised hand, a
// re-explanation, a correction).
export function shownAside(aside) {
  if (!Array.isArray(aside?.steps) || aside.pagesChecked) return aside
  return { ...aside, steps: aside.steps.map(step => scrubStep(step, NO_PAGES)) }
}

// A flashcard with its pages checked.
export function scrubCard(card, allowed) {
  return card && typeof card === 'object' ? { ...card, front: scrubPages(card.front, allowed), back: scrubPages(card.back, allowed) } : card
}

// A cheat sheet as written, checked: every citation by the words it quotes
// (see checkCite), every text by the pages read. read: the passages it was
// written from; all: every chunk of its materials.
export function checkSheet(sheet, { read = [], all = [] } = {}) {
  const allowed = readPages(read)
  return {
    ...sheet,
    title: scrubPages(sheet.title, allowed),
    sections: (sheet.sections ?? []).map(section => ({
      ...section,
      title: scrubPages(section.title, allowed),
      items: (section.items ?? []).map(item => ({ ...item, title: scrubPages(item.title, allowed), text: scrubPages(item.text, allowed), cite: checkCite(item.cite, { read, all }) })),
    })),
    citesChecked: true,
  }
}

// A cheat sheet as it is shown: a citation that was never checked (older
// sheets, imported ones) is not shown.
export function shownSheet(sheet) {
  if (!sheet?.sections) return sheet
  return { ...sheet, sections: sheet.sections.map(section => ({ ...section, items: (section.items ?? []).map(item => (item.cite && item.cite.verified !== true ? { ...item, cite: null } : item)) })) }
}
