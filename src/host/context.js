// Shared lookups for building prompts: the learner profile, mastery of the
// concepts at hand, and the material passages relevant to a lesson.

import { conceptIndex, findLesson, LIMITS } from '../core/course-model.js'
import { boundChunks } from '../core/lesson-sources.js'
import { summarizeForPrompt } from '../core/mastery.js'
import { buildIndex, fitPassages, formatPassages, samplePassages, search, selectPassages } from '../core/retrieval.js'

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
export const COURSE_MATERIALS = LIMITS.materials

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
// with its pages. A long outline loses its deepest levels first. ref: the
// material's reference ("M1"), to number the entries ("[M1.3]") by their
// place in the whole outline.
export function outlineText(outline, { maxChars = 2500, ref } = {}) {
  let entries = (outline?.entries ?? []).map((entry, index) => ({ ...entry, n: index + 1 }))
  const size = list => list.reduce((sum, entry) => sum + entry.title.length + entry.level * 2 + (ref ? 24 : 16), 0)
  while (size(entries) > maxChars && entries.some(entry => entry.level > 1)) {
    const deepest = Math.max(...entries.map(entry => entry.level))
    entries = entries.filter(entry => entry.level < deepest)
  }
  const value = entries.map(entry => `${'  '.repeat(entry.level - 1)}- ${ref ? `[${ref}.${entry.n}] ` : ''}${entry.title}${entryPages(entry) ? ` (${entryPages(entry)})` : ''}`).join('\n')
  return value.length > maxChars ? `${value.slice(0, value.lastIndexOf('\n', maxChars))}\n…` : value
}

// What a material covers, briefly: its outline's chapter titles, else the
// topics its brief found.
export function materialTopics(meta) {
  const entries = meta?.outline?.entries ?? []
  const top = entries.filter(entry => entry.level <= Math.min(2, Math.max(...entries.map(item => item.level))))
  return top.length ? top.map(entry => entry.title).slice(0, 60).join('; ') : (meta?.brief?.topics ?? []).join('; ')
}

// How much of its contents each of `count` materials shows in a course
// design prompt: 6,000 characters shared out, at least 800 each, and no more
// than 12,000 in all once there are more than 15 (a list that long keeps
// only its chapters).
export function contentsShare(count) {
  const materials = Math.max(1, count)
  return Math.max(Math.floor(6000 / materials), Math.min(800, Math.floor(12000 / materials)))
}

// The materials for course design: what each is, and its contents with
// pages. refs: number the materials and their contents entries (see
// lesson-sources.js), the first one as M<offset + 1>.
export function materialsSummary(materials, { refs = false, offset = 0 } = {}) {
  const share = contentsShare(materials.length)
  // A brief is up to 800 characters; more than ten materials shorten theirs.
  const about = Math.max(200, Math.floor(8000 / Math.max(1, materials.length)))
  return materials.map(({ meta }, index) => {
    const ref = refs ? `M${offset + index + 1}` : ''
    const size = meta.pages ? `${meta.pages} pages` : meta.slides ? `${meta.slides} slides` : meta.kind
    const lines = [`- ${ref ? `[${ref}] ` : ''}${meta.title} (${size})`]
    if (meta.brief?.summary) lines.push(`  ${meta.brief.summary.length > about ? `${meta.brief.summary.slice(0, about)}…` : meta.brief.summary}`)
    if (meta.outline?.entries?.length) {
      lines.push(`  Contents${meta.printed ? ' (pages as printed in it)' : ''}:`)
      lines.push(outlineText(meta.outline, { maxChars: share, ref }).split('\n').map(line => `    ${line}`).join('\n'))
    } else if (meta.brief?.topics?.length) {
      lines.push(`  Topics: ${meta.brief.topics.slice(0, 24).join('; ')}`)
    }
    return lines.join('\n')
  }).join('\n')
}

// The language a material is written in, from a sample of its text: the
// script most of its letters are in.
export function materialLanguage(chunks) {
  const sample = (chunks ?? []).filter((chunk, index, all) => index < 4 || index === Math.floor(all.length / 2)).map(chunk => chunk.text).join(' ').slice(0, 20000)
  const han = (sample.match(/[\u4e00-\u9fff]/gu) ?? []).length
  const kana = (sample.match(/[\u3040-\u30ff]/gu) ?? []).length
  const hangul = (sample.match(/[\uac00-\ud7af]/gu) ?? []).length
  const latin = (sample.match(/[a-z]/giu) ?? []).length
  const top = Math.max(han, kana, hangul, latin)
  if (!top) return null
  if (top === latin) return 'en'
  if (top === hangul) return 'ko'
  return kana > han / 4 ? 'ja' : 'zh-CN'
}

// What course design is asked for when lessons are bound to materials: the
// contents references, when a material has contents; words in a material's
// own language, when it is not the course's.
export function sourcing(materials, language) {
  const base = code => String(code ?? '').split('-')[0]
  const outlined = materials.some(({ meta }) => meta.outline?.entries?.length)
  const other = materials.map(({ chunks }) => materialLanguage(chunks)).find(code => code && base(code) !== base(language)) ?? null
  return { refs: outlined, termsLanguage: other }
}

// Said before excerpts that were sampled because no passage matched.
export const SAMPLED_NOTE = '(No passage of the materials matched these words. The excerpts below come from the part of each material where this most likely is, or are spread across it: use only what is relevant.)'

// Where a passage is in its material, as the learner would name it: the
// page number printed on it, else its place in the file.
const pageOf = chunk => chunk.label ?? (chunk.page ? String(chunk.page) : null)

// The least room worth giving one material's matching passages.
const MIN_SHARE = 600

// The passages of some materials a prompt needs, within maxChars: the pages
// the learner named first (`pages`, page numbers as printed), then the
// pages the lesson is bound to (`sources`, see lesson-sources.js; the parts
// matching `query` when they do not all fit), then the passages matching
// `query` anywhere, best first, each material its share (with too many
// materials for shares of MIN_SHARE, the best of all of them). When nothing in
// any material matches, excerpts from `around` (see samplePassages) stand
// in, introduced by SAMPLED_NOTE. whole: a material that fits in its share
// is given whole (a study aid on all of it). Returns the text for the
// prompt and the passages in it.
export function materialPassages(materials, { query = '', maxChars = 9000, around, pages = [], sources = [], whole = false } = {}) {
  const usable = materials.filter(({ chunks }) => chunks?.length)
  if (!usable.length) return { text: '', passages: [], sampled: false }
  const own = usable.map(({ meta, chunks }) => ({ meta, chunks: chunks.map(chunk => ({ ...chunk, source: meta.title, materialId: meta.id })) }))
  const keyOf = chunk => `${chunk.materialId}:${chunk.id}`
  const sizeOf = list => list.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const picked = own.map(() => [])
  const taken = new Set()
  let left = maxChars
  const take = (list, room) => {
    const fitted = fitPassages(list.filter(chunk => !taken.has(keyOf(chunk))), Math.min(room, left))
    for (const chunk of fitted) {
      picked[own.findIndex(material => material.meta.id === chunk.materialId)].push(chunk)
      taken.add(keyOf(chunk))
    }
    left -= sizeOf(fitted)
  }
  if (whole) {
    const share = Math.floor(maxChars / own.length)
    for (const material of own) if (sizeOf(material.chunks) <= share) take(material.chunks, share)
  }
  const named = new Set(pages.map(String))
  if (named.size) take(own.flatMap(material => material.chunks.filter(chunk => named.has(pageOf(chunk)))), Math.floor(maxChars * 0.4))
  if (sources?.length) {
    const bound = own.flatMap(material => boundChunks(sources, material.meta.id, material.chunks)).filter(chunk => !taken.has(keyOf(chunk)))
    const room = Math.floor(maxChars * 0.6)
    if (sizeOf(bound) <= room || !query) {
      take(bound, room)
    } else {
      // The parts of a long stretch that match best, in the book's order.
      const best = new Set(fitPassages(search(buildIndex(bound), query, { limit: bound.length }).map(entry => entry.chunk), room).map(keyOf))
      take(bound.filter(chunk => best.has(keyOf(chunk))), room)
    }
  }
  if (left >= 300) {
    const nothingYet = picked.every(list => !list.length)
    if (query && left / own.length < MIN_SHARE) {
      // Too many materials for each to get a share worth reading: the
      // passages that match best, whichever material they are in.
      const rest = own.flatMap(material => material.chunks.filter(chunk => !taken.has(keyOf(chunk))))
      take(selectPassages(rest, query, { maxChars: left, limit: Math.ceil(left / 400), fallback: 'none' }), left)
    } else {
      const share = Math.max(MIN_SHARE, Math.floor(left / own.length))
      for (const material of own) {
        if (!query && !nothingYet) break
        take(selectPassages(material.chunks.filter(chunk => !taken.has(keyOf(chunk))), query, { maxChars: share, fallback: 'none' }), share)
      }
    }
  }
  const sampled = Boolean(query) && picked.every(list => !list.length)
  if (sampled) {
    const share = Math.max(600, Math.floor(maxChars / own.length))
    left = maxChars
    own.forEach((material, index) => {
      picked[index] = fitPassages(samplePassages(material.chunks, { maxChars: Math.min(share, left), around }), Math.max(0, left)).map(chunk => ({ ...chunk, sampled: true }))
      left -= sizeOf(picked[index])
    })
  }
  const kept = own.map((material, index) => ({ meta: material.meta, picked: picked[index] })).filter(block => block.picked.length)
  const text = kept.map(block => formatPassages(block.picked, block.meta.title)).join('\n\n')
  return { text: text && sampled ? `${SAMPLED_NOTE}\n\n${text}` : text, passages: kept.flatMap(block => block.picked), sampled }
}

// Every chunk of some materials, each knowing its material: where a quote
// is looked for when it is not in the passages a call was given.
export function allChunks(materials) {
  return materials.flatMap(({ meta, chunks }) => (chunks ?? []).map(chunk => ({ ...chunk, source: meta.title, materialId: meta.id })))
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
