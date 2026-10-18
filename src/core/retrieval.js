// Lightweight lexical retrieval over material chunks, so prompts carry the
// passages that matter instead of whole books. CJK text is indexed as
// character bigrams, Latin text as lowercased words; scoring is BM25.

const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿가-힯]+/gu
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'be', 'with', 'as', 'by', 'at', 'it', 'this', 'that', 'from'])

export function tokenize(value) {
  const textValue = String(value ?? '').toLowerCase()
  const tokens = []
  for (const run of textValue.match(CJK_RUN) ?? []) {
    if (run.length === 1) tokens.push(run)
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2))
  }
  for (const word of textValue.replace(CJK_RUN, ' ').match(WORD) ?? []) {
    if (word.length > 1 && !STOP.has(word)) tokens.push(word)
  }
  return tokens
}

export function buildIndex(chunks) {
  const docs = chunks.map(chunk => {
    const counts = new Map()
    const tokens = tokenize(chunk.text)
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return { chunk, counts, length: tokens.length }
  })
  const df = new Map()
  for (const doc of docs) for (const token of doc.counts.keys()) df.set(token, (df.get(token) ?? 0) + 1)
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length)
  return { docs, df, avg }
}

export function search(index, query, { limit = 6, k1 = 1.4, b = 0.75 } = {}) {
  const terms = [...new Set(tokenize(query))]
  if (!terms.length || !index.docs.length) return []
  const total = index.docs.length
  const scored = index.docs.map(doc => {
    let score = 0
    for (const term of terms) {
      const tf = doc.counts.get(term)
      if (!tf) continue
      const df = index.df.get(term) ?? 0
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / (index.avg || 1)))))
    }
    return { chunk: doc.chunk, score }
  })
  return scored.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
}

// Pick passages for a prompt within a character budget. Without a query the
// first chunks (the material's beginning) are used.
export function selectPassages(chunks, query, { maxChars = 12000, limit = 12 } = {}) {
  if (!chunks?.length) return []
  const picked = query ? search(buildIndex(chunks), query, { limit }).map(entry => entry.chunk) : chunks.slice(0, limit)
  const result = []
  let used = 0
  for (const chunk of picked) {
    if (used + chunk.text.length > maxChars) {
      const room = maxChars - used
      if (room > 400) result.push({ ...chunk, text: `${chunk.text.slice(0, room)}…` })
      break
    }
    result.push(chunk)
    used += chunk.text.length
  }
  return result
}

export function formatPassages(passages, sourceTitle) {
  return passages.map(passage => {
    const where = passage.page ? `p.${passage.page}` : passage.slide ? `slide ${passage.slide}` : passage.section ?? ''
    return `<<${sourceTitle ?? passage.source ?? 'source'}${where ? ` · ${where}` : ''}>>\n${passage.text}`
  }).join('\n\n')
}
