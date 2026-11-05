// Page references in text: what a learner asks about ("书上第12页的例2") and,
// later, what a model claims it read.

// "第12页", "第 12–14 页", "12页", "第12至13页"
const CJK_PAGES = /(?:第\s*)?(\d{1,4})\s*(?:[-–—~～至到]\s*(?:第\s*)?(\d{1,4})\s*)?页/gu
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

// Every page reference in `text`, in order: { start, end, pages }, where
// pages are the page numbers it names, as strings.
export function pageMentions(text) {
  const value = String(text ?? '')
  const found = []
  for (const pattern of [CJK_PAGES, LATIN_PAGES]) {
    for (const match of value.matchAll(pattern)) found.push({ start: match.index, end: match.index + match[0].length, pages: pagesOf(match[1], match[2]) })
  }
  return found.filter(mention => mention.pages.length).sort((a, b) => a.start - b.start)
}

// The page numbers `text` names, each once.
export function mentionedPages(text) {
  return [...new Set(pageMentions(text).flatMap(mention => mention.pages))]
}
