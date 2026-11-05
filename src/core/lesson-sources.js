// Lessons bound to the pages of the course's materials. Course design sees
// each material's outline with references ("M1.3" is the third entry of the
// first material) and names, for every lesson, the entries it teaches from;
// here those references become the chunks and pages they stand for, so a
// lesson reads its own pages first.
//
// A lesson's source: { materialId, first, last, title, page, end, label,
// endLabel }: chunk numbers first–last (1-based, inclusive) of the material,
// the outline entry's title, and the pages they are on (in the file, and as
// printed).

export const SOURCE_LIMITS = Object.freeze({ perLesson: 3, span: 4000, terms: 6 })

const MATERIAL_ID = /^mat_[a-z0-9]{6,40}$/u
const text = (value, max) => (value === null || value === undefined ? '' : String(value).replace(/\u0000/gu, '').trim().slice(0, max))
const count = value => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 1 && number <= 1_000_000 ? number : null
}

// A source as stored on a lesson, checked; null when it is not one.
export function normalizeSource(raw) {
  const materialId = typeof raw?.materialId === 'string' && MATERIAL_ID.test(raw.materialId) ? raw.materialId : null
  const first = count(raw?.first)
  const last = count(raw?.last)
  if (!materialId || !first || !last || last < first || last - first > SOURCE_LIMITS.span) return null
  const page = count(raw?.page)
  const end = count(raw?.end)
  const label = text(raw?.label, 16)
  const endLabel = text(raw?.endLabel, 16)
  return {
    materialId,
    first,
    last,
    title: text(raw?.title, 120),
    ...(page ? { page, end: end && end >= page ? end : page } : {}),
    ...(page && label ? { label } : {}),
    ...(page && endLabel ? { endLabel } : {}),
  }
}

export function normalizeSources(raw) {
  const seen = new Set()
  const sources = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const source = normalizeSource(item)
    const key = source ? `${source.materialId}:${source.first}:${source.last}` : ''
    if (!source || seen.has(key)) continue
    seen.add(key)
    sources.push(source)
    if (sources.length >= SOURCE_LIMITS.perLesson) break
  }
  return sources
}

// Words to find a lesson's passages with, in the language of its materials.
export function normalizeTerms(raw) {
  const terms = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，;；、]/u) : [])
    .map(term => text(typeof term === 'string' ? term : '', 40))
    .filter(Boolean)
  return [...new Set(terms)].slice(0, SOURCE_LIMITS.terms)
}

// The references course design sees: "M<n>" for the n-th material and
// "M<n>.<k>" for the k-th entry of its outline. materials: [{ meta, chunks }]
// in the course's order.
export function sourceIndex(materials) {
  return (materials ?? []).map(({ meta, chunks }, index) => ({ ref: `M${index + 1}`, meta, entries: meta?.outline?.entries ?? [], chunks: chunks ?? [] }))
}

const pageOf = chunk => chunk.label ?? (chunk.page ? String(chunk.page) : null)

// The pages "12-14" names, as printed (or the page order where nothing is
// printed); a long run names its ends.
function pagesNamed(value) {
  const match = /^\s*(?:pp?\.?\s*)?([0-9ivxlcdm]{1,6})\s*(?:[-–—~～至到]\s*([0-9ivxlcdm]{1,6}))?\s*页?\s*$/iu.exec(String(value ?? ''))
  if (!match) return null
  const [from, to] = [match[1].toLowerCase(), (match[2] ?? match[1]).toLowerCase()]
  if (/^\d+$/u.test(from) && /^\d+$/u.test(to) && Number(to) >= Number(from) && Number(to) - Number(from) <= 200) {
    return new Set(Array.from({ length: Number(to) - Number(from) + 1 }, (_, index) => String(Number(from) + index)))
  }
  return new Set([from, to])
}

function sourceOf(entry, material, from, to) {
  const chunks = material.chunks.slice(from - 1, to)
  const firstChunk = chunks.find(chunk => chunk.page)
  const lastChunk = [...chunks].reverse().find(chunk => chunk.page)
  return normalizeSource({
    materialId: material.meta.id,
    first: from,
    last: to,
    title: entry?.title ?? '',
    page: firstChunk?.page,
    end: lastChunk?.page,
    label: firstChunk?.label,
    endLabel: lastChunk?.label,
  })
}

// One reference as the model wrote it: "M1.3", "M1.3:12-14" (some of the
// entry's pages, as printed), "M1:12-14" (pages of the material), or a
// source in the stored shape (kept when its material is a course
// material). null when it names nothing that exists.
export function resolveSource(value, index) {
  if (value && typeof value === 'object') {
    const source = normalizeSource(value)
    const material = source && index.find(item => item.meta?.id === source.materialId)
    return material && source.last <= material.chunks.length ? source : null
  }
  const match = /^\s*\[?\s*M(\d{1,2})(?:\.(\d{1,3}))?\s*\]?\s*(?::\s*(.+))?$/iu.exec(String(value ?? ''))
  if (!match) return null
  const material = index[Number(match[1]) - 1]
  if (!material?.chunks.length) return null
  const entry = match[2] ? material.entries[Number(match[2]) - 1] : null
  if (match[2] && !entry?.first) return null
  let [from, to] = entry ? [entry.first, entry.last] : [1, material.chunks.length]
  const pages = match[3] ? pagesNamed(match[3]) : null
  if (pages) {
    const inside = []
    for (let number = from; number <= to; number += 1) if (pages.has(String(pageOf(material.chunks[number - 1]) ?? '').toLowerCase())) inside.push(number)
    if (inside.length) [from, to] = [inside[0], inside.at(-1)]
    else if (!entry) return null
  } else if (!entry) {
    return null
  }
  return sourceOf(entry, material, from, to)
}

// Every lesson of a blueprint as the model wrote it, with "src" (or
// "sources") resolved into sources and "terms" kept. Returns a copy.
export function bindBlueprint(raw, index) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.units)) return raw
  const bind = lesson => {
    if (!lesson || typeof lesson !== 'object') return lesson
    const wanted = [lesson.src, lesson.sources, lesson.source].flatMap(value => (Array.isArray(value) ? value : value ? [value] : []))
    const sources = normalizeSources(wanted.map(value => resolveSource(value, index)).filter(Boolean))
    const { src, source, ...rest } = lesson
    return { ...rest, sources, terms: normalizeTerms(lesson.terms) }
  }
  return {
    ...raw,
    units: raw.units.map(unit => ({
      ...unit,
      lectures: Array.isArray(unit?.lectures) ? unit.lectures.map(lecture => ({ ...lecture, lessons: Array.isArray(lecture?.lessons) ? lecture.lessons.map(bind) : lecture?.lessons })) : unit?.lectures,
    })),
  }
}

// A revision keeps the sources of a lesson it left as it was (same id and
// title), after any it named for it. before, after: blueprints.
export function keepSources(before, after) {
  const old = new Map()
  for (const unit of before?.units ?? []) for (const lecture of unit.lectures ?? []) for (const lesson of lecture.lessons ?? []) old.set(lesson.id, lesson)
  for (const unit of after?.units ?? []) {
    for (const lecture of unit.lectures ?? []) {
      for (const lesson of lecture.lessons ?? []) {
        const was = old.get(lesson.id)
        if (!was || was.title !== lesson.title) continue
        const sources = normalizeSources([...(lesson.sources ?? []), ...(was.sources ?? [])])
        if (sources.length) lesson.sources = sources
        if (!lesson.terms?.length && was.terms?.length) lesson.terms = was.terms
      }
    }
  }
  return after
}

// Units for a prompt without their lessons' sources and terms: the model
// names pages by reference, and a revision keeps those of unchanged lessons.
export function stripSources(units) {
  return (units ?? []).map(unit => ({ ...unit, lectures: (unit.lectures ?? []).map(lecture => ({ ...lecture, lessons: (lecture.lessons ?? []).map(({ sources, terms, ...lesson }) => lesson) })) }))
}

// Every source of some lessons, for passages on all of them.
export function sourcesOf(lessons) {
  return (lessons ?? []).flatMap(lesson => lesson?.sources ?? [])
}

// The words to find some lessons' passages by: their titles, objectives and
// concepts, and their terms in the materials' language.
export function lessonQuery(lessons) {
  return (lessons ?? []).map(lesson => [lesson.title, ...(lesson.objectives ?? []), ...(lesson.concepts ?? []).map(concept => concept.name), ...(lesson.terms ?? [])].join(' ')).join(' ')
}

// The chunks of a material a lesson's sources stand for, in order.
export function boundChunks(sources, materialId, chunks) {
  const picked = new Set()
  for (const source of sources ?? []) {
    if (source.materialId !== materialId) continue
    for (let number = source.first; number <= Math.min(source.last, chunks.length); number += 1) picked.add(number - 1)
  }
  return [...picked].sort((a, b) => a - b).map(index => chunks[index])
}
