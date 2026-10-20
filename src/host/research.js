// Web research before a course is designed: a few searches through DSH's own
// web service (ctx.web, with whatever search provider DSH is set up with), so
// the questions and the blueprint reflect how the subject is taught today.
// Nothing here talks to a search vendor or handles its credentials. When DSH
// cannot search, the course is designed without it and the reason is kept.

import { text } from '../core/course-model.js'
import { generateJson } from './generate.js'
import { researchQueriesPrompt } from './prompts.js'

const MAX_QUERIES = 3
const RESULTS_PER_QUERY = 6
const MAX_SOURCES = 10

// WebError codes from ctx.web, grouped into what the learner is told.
const UNAVAILABLE = new Set(['WEB_PROVIDER_UNAVAILABLE', 'WEB_PROVIDER_CONFIGURED_MISSING', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', 'WEB_PROVIDER_AMBIGUOUS'])

export function cleanQueries(raw, goal) {
  const queries = [...new Set((Array.isArray(raw) ? raw : []).map(query => text(query, 120)).filter(Boolean))].slice(0, MAX_QUERIES)
  return queries.length ? queries : [text(goal, 120)].filter(Boolean)
}

// Search results are untrusted: keep http(s) links only, cap every field, and
// merge the queries' results round-robin so each query contributes.
export function mergeSources(lists) {
  const seen = new Set()
  const out = []
  const longest = Math.max(0, ...lists.map(list => list.length))
  for (let rank = 0; rank < longest && out.length < MAX_SOURCES; rank += 1) {
    for (const list of lists) {
      const source = list[rank]
      const url = safeUrl(source?.url)
      if (!url || seen.has(url) || out.length >= MAX_SOURCES) continue
      seen.add(url)
      out.push({
        url,
        title: text(source.title, 200) || new URL(url).hostname,
        snippet: text(source.snippet ?? source.text ?? source.excerpt, 400),
        publishedAt: text(source.publishedAt ?? source.date, 40),
      })
    }
  }
  return out
}

function safeUrl(value) {
  const raw = text(value, 500)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
}

export function skipReason(error) {
  const code = String(error?.code ?? '')
  if (code === 'WEB_PROVIDER_CREDENTIAL_MISSING') return 'no-credential'
  if (UNAVAILABLE.has(code)) return 'unavailable'
  return error ? 'failed' : 'empty'
}

// getWeb(): DSH's web service, or nothing when this DSH has none.
export function createResearch({ getWeb, llm, logger }) {
  // Returns { queries, sources, at } or { skipped, queries?, sources: [] }.
  async function run({ goal, language, signal, onSearching }) {
    const web = getWeb?.()
    if (typeof web?.search !== 'function') return { skipped: 'unavailable', sources: [] }
    let queries
    try {
      queries = await generateJson(llm, {
        purpose: 'quick',
        prompt: researchQueriesPrompt({ goal, language }),
        maxTokens: 400,
        signal,
        normalize: raw => cleanQueries(raw?.queries, goal),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      queries = cleanQueries([], goal)
    }
    onSearching?.(queries)
    const settled = await Promise.allSettled(queries.map(query => web.search({ query, maxResults: RESULTS_PER_QUERY }, signal)))
    signal?.throwIfAborted?.()
    const failure = settled.find(result => result.status === 'rejected')?.reason
    if (failure) logger?.debug?.('aha-tutor web research: %s', failure?.code ?? failure?.message)
    const sources = mergeSources(settled.filter(result => result.status === 'fulfilled').map(result => result.value?.sources ?? []))
    if (!sources.length) return { skipped: skipReason(failure), queries, sources: [] }
    return { queries, sources, at: new Date().toISOString() }
  }

  return Object.freeze({ run })
}
