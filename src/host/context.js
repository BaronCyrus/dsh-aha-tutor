// Shared lookups for building prompts: the learner profile, mastery of the
// concepts at hand, and the material passages relevant to a lesson.

import { conceptIndex, findLesson } from '../core/course-model.js'
import { summarizeForPrompt } from '../core/mastery.js'
import { fitPassages, formatPassages, samplePassages, selectPassages } from '../core/retrieval.js'

export const EMPTY_PROFILE = Object.freeze({ name: '', background: '', goals: [], strengths: [], weaknesses: [], preferences: {}, notes: [], updatedAt: null })

export async function readProfile(store) {
  return { ...EMPTY_PROFILE, ...((await store.readJson(store.paths.profile(), null)) ?? {}) }
}

export function emptyProgress(courseId) {
  return { courseId, lessons: {}, concepts: {}, reviews: {}, practice: {}, projects: {}, events: [], lastLessonId: null }
}

export async function readProgress(store, courseId) {
  return { ...emptyProgress(courseId), ...((await store.readJson(store.paths.progress(courseId), null)) ?? {}) }
}

// Mastery rows for a lesson's concepts plus the lesson before it.
export function masteryFor(course, progress, lessonId) {
  const row = findLesson(course, lessonId)
  if (!row) return []
  const index = conceptIndex(course)
  const ids = new Set(row.lesson.concepts.map(concept => concept.id))
  const all = [...index.values()]
  const position = all.findIndex(concept => concept.lessonId === lessonId)
  for (const concept of all.slice(Math.max(0, position - 6), position)) ids.add(concept.id)
  const states = [...ids].map(id => progress.concepts?.[id]).filter(Boolean)
  return summarizeForPrompt(states)
}

// A course uses at most this many materials.
export const COURSE_MATERIALS = 12

export async function readMaterials(store, materialIds = []) {
  const items = []
  for (const id of materialIds.slice(0, COURSE_MATERIALS)) {
    try {
      const meta = await store.readJson(store.paths.material(id), null)
      if (!meta) continue
      // A photo has text only when it was read (see recognize.js).
      const chunks = meta.kind === 'image' && !meta.chars ? [] : (await store.readJson(store.paths.materialChunks(id), [])) ?? []
      items.push({ meta, chunks })
    } catch {
      // a removed material is skipped
    }
  }
  return items
}

// The pages of an outline entry as the book prints them: "p.12–15".
export function entryPages(entry) {
  if (!entry?.page) return ''
  const from = entry.label ?? String(entry.page)
  const to = entry.endLabel ?? String(entry.end ?? entry.page)
  return from === to ? `p.${from}` : `p.${from}–${to}`
}

// A material's outline for a prompt, one entry a line, indented by level,
// with its pages. A long outline loses its deepest levels first.
export function outlineText(outline, { maxChars = 2500 } = {}) {
  let entries = outline?.entries ?? []
  const size = list => list.reduce((sum, entry) => sum + entry.title.length + entry.level * 2 + 16, 0)
  while (size(entries) > maxChars && entries.some(entry => entry.level > 1)) {
    const deepest = Math.max(...entries.map(entry => entry.level))
    entries = entries.filter(entry => entry.level < deepest)
  }
  const value = entries.map(entry => `${'  '.repeat(entry.level - 1)}- ${entry.title}${entryPages(entry) ? ` (${entryPages(entry)})` : ''}`).join('\n')
  return value.length > maxChars ? `${value.slice(0, value.lastIndexOf('\n', maxChars))}\n…` : value
}

// What a material covers, briefly: its outline's chapter titles, else the
// topics its brief found.
export function materialTopics(meta) {
  const entries = meta?.outline?.entries ?? []
  const top = entries.filter(entry => entry.level <= Math.min(2, Math.max(...entries.map(item => item.level))))
  return top.length ? top.map(entry => entry.title).slice(0, 60).join('; ') : (meta?.brief?.topics ?? []).join('; ')
}

export function materialsSummary(materials) {
  const share = Math.max(800, Math.floor(6000 / Math.max(1, materials.length)))
  return materials.map(({ meta }) => {
    const size = meta.pages ? `${meta.pages} pages` : meta.slides ? `${meta.slides} slides` : meta.kind
    const lines = [`- ${meta.title} (${size})`]
    if (meta.brief?.summary) lines.push(`  ${meta.brief.summary}`)
    if (meta.outline?.entries?.length) {
      lines.push(`  Contents${meta.printed ? ' (pages as printed in it)' : ''}:`)
      lines.push(outlineText(meta.outline, { maxChars: share }).split('\n').map(line => `    ${line}`).join('\n'))
    } else if (meta.brief?.topics?.length) {
      lines.push(`  Topics: ${meta.brief.topics.slice(0, 24).join('; ')}`)
    }
    return lines.join('\n')
  }).join('\n')
}

// Said before excerpts that were sampled because no passage matched.
export const SAMPLED_NOTE = '(No passage of the materials matched these words. The excerpts below come from the part of each material where this most likely is, or are spread across it: use only what is relevant.)'

// Where a passage is in its material, as the learner would name it: the
// page number printed on it, else its place in the file.
const pageOf = chunk => chunk.label ?? (chunk.page ? String(chunk.page) : null)

// The passages of some materials a prompt needs, within maxChars, each
// material its share: the pages the learner named first (`pages`, page
// numbers as strings), then the passages matching `query`, best first.
// When nothing in any material matches, excerpts from `around` (see
// samplePassages) stand in, introduced by SAMPLED_NOTE. Returns the text
// for the prompt and the passages in it.
export function materialPassages(materials, { query = '', maxChars = 9000, around, pages = [] } = {}) {
  const usable = materials.filter(({ chunks }) => chunks?.length)
  if (!usable.length) return { text: '', passages: [], sampled: false }
  const share = Math.max(600, Math.floor(maxChars / usable.length))
  const named = new Set(pages.map(String))
  const pick = sample => usable.map(({ meta, chunks }) => {
    const own = chunks.map(chunk => ({ ...chunk, source: meta.title, materialId: meta.id }))
    if (sample) return { meta, picked: samplePassages(own, { maxChars: share, around }).map(chunk => ({ ...chunk, sampled: true })) }
    const first = named.size ? fitPassages(own.filter(chunk => named.has(pageOf(chunk))), Math.floor(share * 0.6)) : []
    const taken = new Set(first.map(chunk => chunk.id))
    const room = share - first.reduce((sum, chunk) => sum + chunk.text.length, 0)
    const rest = !query && first.length ? [] : selectPassages(own.filter(chunk => !taken.has(chunk.id)), query, { maxChars: room, fallback: 'none' })
    return { meta, picked: [...first, ...rest] }
  })
  let blocks = pick(false)
  const sampled = Boolean(query) && !blocks.some(block => block.picked.length)
  if (sampled) blocks = pick(true)
  // Many materials together still keep to the budget, in their order.
  const kept = []
  let left = maxChars
  for (const block of blocks) {
    const picked = left >= 300 ? fitPassages(block.picked, left) : []
    if (!picked.length) continue
    left -= picked.reduce((sum, chunk) => sum + chunk.text.length, 0)
    kept.push({ meta: block.meta, picked })
  }
  const text = kept.map(block => formatPassages(block.picked, block.meta.title)).join('\n\n')
  return { text: text && sampled ? `${SAMPLED_NOTE}\n\n${text}` : text, passages: kept.flatMap(block => block.picked), sampled }
}

export function passagesFor(materials, query, maxChars = 9000, options = {}) {
  return materialPassages(materials, { ...options, query, maxChars }).text
}

// Images from uploaded materials, for vision-capable models only.
export async function materialImages(store, materials) {
  const images = []
  for (const { meta } of materials) {
    if (meta.kind !== 'image' || images.length >= 4) continue
    const blob = await store.readBlob(store.paths.materialBlob(meta.id))
    if (blob) images.push({ mime: meta.mime ?? 'image/png', base64: blob.toString('base64') })
  }
  return images
}
