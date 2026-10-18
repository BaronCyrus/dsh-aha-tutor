// Shared lookups for building prompts: the learner profile, mastery of the
// concepts at hand, and the material passages relevant to a lesson.

import { conceptIndex, findLesson } from '../core/course-model.js'
import { summarizeForPrompt } from '../core/mastery.js'
import { formatPassages, selectPassages } from '../core/retrieval.js'

export const EMPTY_PROFILE = Object.freeze({ background: '', goals: [], strengths: [], weaknesses: [], preferences: {}, notes: [], updatedAt: null })

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

export async function readMaterials(store, materialIds = []) {
  const items = []
  for (const id of materialIds.slice(0, 8)) {
    try {
      const meta = await store.readJson(store.paths.material(id), null)
      if (!meta) continue
      const chunks = meta.kind === 'image' ? [] : (await store.readJson(store.paths.materialChunks(id), [])) ?? []
      items.push({ meta, chunks })
    } catch {
      // a removed material is skipped
    }
  }
  return items
}

export function materialsSummary(materials) {
  return materials.map(({ meta }) => {
    const size = meta.pages ? `${meta.pages} pages` : meta.slides ? `${meta.slides} slides` : meta.kind
    const lines = [`- ${meta.title} (${size})`]
    if (meta.brief?.summary) lines.push(`  ${meta.brief.summary}`)
    if (meta.brief?.topics?.length) lines.push(`  Topics: ${meta.brief.topics.slice(0, 24).join('; ')}`)
    return lines.join('\n')
  }).join('\n')
}

export function passagesFor(materials, query, maxChars = 9000) {
  const blocks = []
  let budget = maxChars
  for (const { meta, chunks } of materials) {
    if (!chunks.length || budget < 600) continue
    const share = Math.max(1200, Math.floor(budget / Math.max(1, materials.length)))
    const picked = selectPassages(chunks.map(chunk => ({ ...chunk, source: meta.title })), query, { maxChars: share })
    if (!picked.length) continue
    const block = formatPassages(picked, meta.title)
    blocks.push(block)
    budget -= block.length
  }
  return blocks.join('\n\n')
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
