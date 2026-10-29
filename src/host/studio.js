// Everything that works without a course: the material library, study
// materials made from it (cheat sheets, flashcards, notes, quizzes, digests),
// instant-help sessions on the board, and two-minute explainer shorts.

import { LIMITS, materialQuizRange, normalizeCards, normalizeCheatsheet, normalizePractice, partCardRange, shareRange, takeEvenly, text, thinEvenly, uniqueCards } from '../core/course-model.js'
import { assertId, newId } from '../core/ids.js'
import { createCard, review } from '../core/srs.js'
import { buildIndex, documentParts, formatPassages, materialParts, passageRange, search, snippetOf, spreadPassages } from '../core/retrieval.js'
import { materialImages, passagesFor, readMaterials, readProfile } from './context.js'
import { fieldCounter, generateJson, generateSteps, generateText, TutorError } from './generate.js'
import { ingestFile, ingestUrl, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './materials.js'
import { assistPrompt, cheatsheetPrompt, detectLanguage, digestPartPrompt, digestPrompt, flashcardsPrompt, materialBriefPrompt, quizPrompt, shortPrompt, summaryPrompt } from './prompts.js'
import { createRecognizer } from './recognize.js'
import { cleanLayout } from './lessons.js'

const ASSIST_MODES = ['explain', 'solve', 'visualize']
const MAX_TURNS = 30
// A document up to this size is digested in one call; a longer one is read
// part by part (about 20,000 characters each, at most 24 parts) first.
const DIGEST_SINGLE_CHARS = 24_000
const DIGEST_NOTES_CHARS = 48_000
// Parts of a material written at the same time for a deck or a quiz, and
// the failures that only cost a part.
const PART_WORKERS = 3
const PART_FAILURES = new Set(['bad-output', 'llm-empty', 'llm-timeout', 'llm-failed', 'llm-context'])

// A study aid's title: the materials, and the focus when there is one.
const titleOf = (scope, focus) => (focus ? `${scope.title} · ${focus}` : scope.title)

export function createStudio({ store, llm, jobs, now = () => new Date(), uiLanguage = () => 'zh-CN' }) {
  const stamp = () => now().toISOString()

  // ── materials ──────────────────────────────────────────────────────────────

  async function saveMaterial(result, { bytes, signal, extra = {} }) {
    const id = newId('mat')
    const meta = {
      id,
      title: text(result.title, 160) || 'Untitled',
      kind: result.kind,
      pages: result.pages ?? null,
      slides: result.slides ?? null,
      chars: result.chars ?? 0,
      truncated: result.truncated === true,
      mime: result.mime ?? null,
      url: result.url ?? null,
      ocr: result.ocr ?? null,
      createdAt: stamp(),
      brief: null,
      ...extra,
    }
    if (result.kind === 'image' && bytes) await store.writeBlob(store.paths.materialBlob(id), bytes)
    if (result.chunks?.length) await store.writeJson(store.paths.materialChunks(id), result.chunks)
    if (result.chunks?.length) {
      try {
        meta.brief = await generateJson(llm, {
          purpose: 'quick',
          prompt: materialBriefPrompt({ title: meta.title, passages: formatPassages(spreadPassages(result.chunks, { maxChars: 12000 }), ''), language: detectLanguage(result.chunks[0].text, uiLanguage()) }),
          maxTokens: 1500,
          signal,
          normalize: raw => ({
            summary: text(raw?.summary, 800),
            topics: (Array.isArray(raw?.topics) ? raw.topics : []).map(topic => text(topic, 80)).filter(Boolean).slice(0, 30),
            level: text(raw?.level, 20),
            suggestedGoal: text(raw?.suggestedGoal, 300),
          }),
        })
      } catch (error) {
        if (signal?.aborted) throw error
        meta.brief = null
      }
    }
    await store.writeJson(store.paths.material(id), meta)
    return meta
  }

  // Text in pictures is read by the learner's model, with the pages read so
  // far as the job's progress.
  const recognizer = api => createRecognizer({ llm, signal: api.signal, onProgress: (done, total) => api.progress(done, total, 'recognizing') })

  // From the HTTP upload route (bytes) or the RPC fallback (base64).
  function upload({ name, base64, bytes: raw }) {
    const fileName = text(name, 200) || 'file'
    if (!raw && (typeof base64 !== 'string' || !base64)) throw new TutorError('invalid', 'No file data')
    if (raw ? raw.length > MAX_UPLOAD_BYTES : base64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) throw new TutorError('too-large', `The file is larger than ${MAX_UPLOAD_MB} MB`)
    return jobs.start('material/upload', async api => {
      api.progress(0, 2, 'reading')
      const bytes = raw ? (Buffer.isBuffer(raw) ? raw : Buffer.from(raw)) : Buffer.from(base64, 'base64')
      const result = await ingestFile({ name: fileName, bytes, signal: api.signal, recognize: recognizer(api) })
      api.progress(1, 2, 'summarizing')
      const meta = await saveMaterial(result, { bytes, signal: api.signal, extra: { fileName } })
      return { material: meta }
    })
  }

  function addUrl({ url }) {
    return jobs.start('material/url', async api => {
      api.progress(0, 2, 'fetching')
      const result = await ingestUrl(url, { signal: api.signal, recognize: recognizer(api) })
      api.progress(1, 2, 'summarizing')
      return { material: await saveMaterial(result, { signal: api.signal }) }
    })
  }

  async function listMaterials() {
    const ids = await store.listIds(store.paths.materials(), 'mat')
    const metas = (await Promise.all(ids.map(id => store.readJson(store.paths.material(id), null)))).filter(Boolean)
    return metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  // The library's text, indexed once and kept until a material is added,
  // removed or renamed (its key is every material's id, title and size).
  let libraryIndex = null
  const SEARCH_CHUNKS = 30_000

  // Search the text of every material in the library at once, best passages
  // first, each with its material, its page or slide, and an excerpt.
  async function searchMaterials({ query }) {
    const wanted = text(query, 200)
    if (!wanted) return { results: [] }
    // A photo counts once the text in it was read.
    const metas = (await listMaterials()).filter(meta => meta.kind !== 'image' || meta.chars > 0)
    const key = metas.map(meta => `${meta.id}:${meta.title}:${meta.chars ?? meta.pages ?? ''}`).join('|')
    if (libraryIndex?.key !== key) {
      const chunks = []
      for (const meta of metas) {
        if (chunks.length >= SEARCH_CHUNKS) break
        const own = (await store.readJson(store.paths.materialChunks(meta.id), [])) ?? []
        for (const chunk of own.slice(0, SEARCH_CHUNKS - chunks.length)) chunks.push({ ...chunk, materialId: meta.id, materialTitle: meta.title })
      }
      libraryIndex = { key, index: buildIndex(chunks) }
    }
    return {
      results: search(libraryIndex.index, wanted, { limit: 12 }).map(({ chunk }) => ({
        materialId: chunk.materialId,
        title: chunk.materialTitle,
        page: chunk.page ?? null,
        slide: chunk.slide ?? null,
        snippet: snippetOf(chunk.text, wanted),
      })),
    }
  }

  async function getMaterial({ id }) {
    const meta = await store.readJson(store.paths.material(assertId(id, 'mat')), null)
    if (!meta) throw new TutorError('not-found', 'Material not found')
    const chunks = (await store.readJson(store.paths.materialChunks(id), [])) ?? []
    return { material: meta, preview: chunks.slice(0, 3).map(chunk => ({ page: chunk.page ?? null, slide: chunk.slide ?? null, text: chunk.text.slice(0, 600) })), chunkCount: chunks.length }
  }

  async function renameMaterial({ id, title }) {
    const meta = await store.updateJson(store.paths.material(assertId(id, 'mat')), null, value => {
      if (!value) throw new TutorError('not-found', 'Material not found')
      return { ...value, title: text(title, 160) || value.title }
    })
    return { material: meta }
  }

  async function removeMaterial({ id }) {
    await store.removeDir(store.paths.materialDir(assertId(id, 'mat')))
    return { removed: id }
  }

  // The whole document is read: short ones in one call, long ones part by
  // part (two parts at a time) and then combined from the notes.
  function digest({ id }) {
    return jobs.start('material/digest', async api => {
      const [material] = await readMaterials(store, [assertId(id, 'mat')])
      if (!material?.chunks.length) throw new TutorError('material-no-text', 'This material has no text to digest')
      const title = material.meta.title
      const language = detectLanguage(material.chunks[0].text, uiLanguage())
      const size = material.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
      let prompt
      let missing = []
      if (size <= DIGEST_SINGLE_CHARS) {
        api.progress(0, 1, 'writing')
        prompt = digestPrompt({ title, passages: formatPassages(material.chunks, ''), language })
      } else {
        const parts = documentParts(material.chunks)
        const notes = new Array(parts.length).fill(null)
        const readPart = async index => {
          try {
            notes[index] = await generateJson(llm, {
              purpose: 'teach',
              prompt: digestPartPrompt({ title, part: index + 1, parts: parts.length, range: passageRange(parts[index]), passages: formatPassages(parts[index], ''), language }),
              maxTokens: 6000,
              signal: api.signal,
              normalize: normalizeDigestPart,
            })
          } catch (error) {
            if (api.signal.aborted) throw error
          }
        }
        const queue = parts.map((part, index) => index)
        let done = 0
        api.progress(0, parts.length + 1, 'reading')
        const worker = async () => {
          while (queue.length) {
            api.signal.throwIfAborted()
            await readPart(queue.shift())
            done += 1
            api.progress(done, parts.length + 1, 'reading')
          }
        }
        await Promise.all([worker(), worker()])
        // One more try for parts that failed (a cut-off or malformed answer).
        for (const [index, note] of notes.entries()) if (!note) await readPart(index)
        const read = notes.map((note, index) => (note ? { part: index + 1, of: parts.length, range: passageRange(parts[index]), ...note } : null)).filter(Boolean)
        // Notes on a fraction of the book would pass for a digest of all of it.
        if (read.length < Math.ceil(parts.length / 2)) throw new TutorError('bad-output', 'The model could not read enough of this document. Try again or pick a stronger model in settings.')
        missing = parts.map((part, index) => (notes[index] ? null : passageRange(part) || `${index + 1}/${parts.length}`)).filter(Boolean)
        api.progress(parts.length, parts.length + 1, 'writing')
        prompt = digestPrompt({ title, notes: digestNotesText(read, DIGEST_NOTES_CHARS), language })
      }
      const result = await generateJson(llm, { purpose: 'teach', prompt, maxTokens: 9000, signal: api.signal, normalize: normalizeDigest })
      // Parts that could not be read are named in the digest, not hidden.
      if (missing.length) result.missing = missing
      const meta = await store.updateJson(store.paths.material(id), null, value => ({ ...value, digest: { ...result, createdAt: stamp() } }))
      return { material: meta }
    }, { key: `digest:${id}` })
  }

  // ── study materials from the library ─────────────────────────────────────

  async function scopeOf(materialIds) {
    const ids = (Array.isArray(materialIds) ? materialIds : []).filter(id => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, 8)
    if (!ids.length) throw new TutorError('no-material', 'Pick at least one material')
    const materials = await readMaterials(store, ids)
    if (!materials.some(item => item.chunks.length)) throw new TutorError('material-no-text', 'These materials have no text')
    const title = materials.map(item => item.meta.title).join(' + ')
    const language = detectLanguage(materials.find(item => item.chunks.length)?.chunks[0]?.text ?? title, uiLanguage())
    const outline = materials.map(item => item.meta.brief?.topics?.join('; ') ?? '').filter(Boolean).join('\n')
    return { ids, materials, title, language, outline }
  }

  function makeSheet({ materialIds, focus }) {
    return jobs.start('studio/sheet', async api => {
      const scope = await scopeOf(materialIds)
      const sheet = await generateJson(llm, {
        purpose: 'teach',
        prompt: cheatsheetPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: passagesFor(scope.materials, text(focus, 300) || scope.outline, 22000), language: scope.language, focus: text(focus, 300) }),
        maxTokens: 10000,
        signal: api.signal,
        normalize: normalizeCheatsheet,
      })
      const item = { id: newId('chs'), kind: 'cheatsheet', title: sheet.title || scope.title, language: scope.language, materialIds: scope.ids, sheet, createdAt: stamp() }
      await store.writeJson(store.paths.item('sheets', item.id), item)
      return { item }
    })
  }

  // A cheat sheet from a topic alone (used from conversations).
  function makeTopicSheet({ topic, focus, signal }) {
    const subject = text(topic, 300)
    if (!subject) throw new TutorError('invalid', 'Give a topic')
    return (async () => {
      const language = detectLanguage(subject, uiLanguage())
      const sheet = await generateJson(llm, {
        purpose: 'teach',
        prompt: cheatsheetPrompt({ scopeTitle: subject, outline: '', passages: '', language, focus: text(focus, 300) }),
        maxTokens: 9000,
        signal,
        normalize: normalizeCheatsheet,
      })
      const item = { id: newId('chs'), kind: 'cheatsheet', title: sheet.title || subject, language, materialIds: [], sheet, createdAt: stamp() }
      await store.writeJson(store.paths.item('sheets', item.id), item)
      return item
    })()
  }

  function makeNotes({ materialIds, focus }) {
    return jobs.start('studio/notes', async api => {
      const scope = await scopeOf(materialIds)
      const wanted = text(focus, 300)
      const markdown = await generateText(llm, {
        purpose: 'teach',
        prompt: summaryPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: passagesFor(scope.materials, wanted || scope.outline, 22000), language: scope.language, focus: wanted }),
        maxTokens: 8000,
        signal: api.signal,
      })
      const item = { id: newId('chs'), kind: 'notes', title: titleOf(scope, wanted), language: scope.language, materialIds: scope.ids, markdown: markdown.slice(0, 60000), createdAt: stamp() }
      await store.writeJson(store.paths.item('sheets', item.id), item)
      return { item }
    })
  }

  // The materials of a deck or quiz in parts, each written on its own: a
  // short material is one part, a long one about 20,000 characters a part.
  function partsOf(scope) {
    const parts = materialParts(scope.materials.map(({ meta, chunks }) => ({ title: meta.title, chunks })))
    return parts.map((part, index) => ({ ...part, label: parts.length > 1 ? { n: index + 1, of: parts.length, range: passageRange(part.passages) } : null }))
  }

  // Write something for every part, a few parts at a time: write(part,
  // onText) resolves to a list. The job shows how many parts are done and,
  // as the preview, how many entries have been written (counting `field` in
  // the answers as they stream), never more than a part may keep (maxOf) or
  // than the whole may (limit), so the count only grows. A part that fails is
  // tried once more; when fewer than half could be read the job fails,
  // otherwise the parts left out are named.
  async function eachPart(api, parts, { field, maxOf, limit }, write) {
    const lists = parts.map(() => null)
    const written = parts.map(() => 0)
    let done = 0
    const show = () => {
      api.progress(done, parts.length, 'reading')
      api.preview({ written: Math.min(limit, written.reduce((sum, count) => sum + count, 0)) })
    }
    const attempt = async index => {
      try {
        lists[index] = await write(parts[index], fieldCounter(field, count => { written[index] = Math.min(count, maxOf(parts[index])); show() }))
      } catch (error) {
        // Only what went wrong with this part is left to the retry; the
        // model's sign-in, quota or absence stops the whole job.
        if (api.signal.aborted || !PART_FAILURES.has(error?.code)) throw error
        written[index] = 0
      }
    }
    const queue = parts.map((part, index) => index)
    const worker = async () => {
      while (queue.length) {
        api.signal.throwIfAborted()
        const index = queue.shift()
        await attempt(index)
        if (!lists[index]) await attempt(index)
        written[index] = lists[index]?.length ?? 0
        done += 1
        show()
      }
    }
    show()
    await Promise.all(Array.from({ length: Math.min(PART_WORKERS, parts.length) }, worker))
    if (lists.filter(Boolean).length < Math.ceil(parts.length / 2)) throw new TutorError('bad-output', 'The model could not read enough of these materials. Try again or pick a stronger model in settings.')
    return { lists: lists.map(list => list ?? []), missing: parts.filter((part, index) => !lists[index]).map(part => part.label?.range || part.title) }
  }

  // Flashcards on the whole of the materials: two to four per key point the
  // model finds in each part, written without thinking (they restate the
  // text), at most LIMITS.libraryCards, no question asked twice. With a
  // focus, only what falls within it.
  function makeCards({ materialIds, focus }) {
    return jobs.start('studio/cards', async api => {
      const scope = await scopeOf(materialIds)
      const wanted = text(focus, 300)
      const { lists, missing } = await eachPart(api, partsOf(scope), { field: '"front"', maxOf: part => partCardRange(part.chars).max, limit: LIMITS.libraryCards }, (part, onText) => {
        const range = partCardRange(part.chars)
        return generateJson(llm, {
          purpose: 'teach',
          effort: 'lowest',
          prompt: flashcardsPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: formatPassages(part.passages, part.title), language: scope.language, range, part: part.label, focus: wanted }),
          maxTokens: 2000 + range.max * 250,
          signal: api.signal,
          onText,
          normalize: raw => {
            const cards = thinEvenly(normalizeCards(raw, LIMITS.cards * 2), range.max)
            if (!cards.length && !wanted) throw new Error(`No cards came back: write at least ${range.min}.`)
            return cards
          },
        })
      })
      const cards = takeEvenly(uniqueCards(lists), LIMITS.libraryCards).map((card, index) => ({ ...card, id: `c${index + 1}` }))
      if (!cards.length) throw new TutorError('focus-empty', 'Nothing in these materials falls within the focus')
      const item = { id: newId('dck'), kind: 'cards', title: titleOf(scope, wanted), language: scope.language, materialIds: scope.ids, ...(wanted ? { focus: wanted } : {}), ...(missing.length ? { missing } : {}), cards, srs: {}, createdAt: stamp() }
      await store.writeJson(store.paths.item('decks', item.id), item)
      return { item }
    })
  }

  // A quiz as long as the materials: 5 to 30 questions, shared out over the
  // parts. With a focus, how much of each part counts is known only once it
  // is read, so every part may write as much as a material of its size,
  // and the quiz is cut to size evenly afterwards.
  function makeQuiz({ materialIds, focus }) {
    return jobs.start('studio/quiz', async api => {
      const scope = await scopeOf(materialIds)
      const wanted = text(focus, 300)
      const parts = partsOf(scope)
      const whole = materialQuizRange(parts.reduce((sum, part) => sum + part.chars, 0))
      const rangeOf = part => (wanted ? materialQuizRange(part.chars) : shareRange(whole, parts.length))
      const { lists, missing } = await eachPart(api, parts, { field: '"prompt"', maxOf: part => rangeOf(part).max, limit: LIMITS.quizItems }, (part, onText) => {
        const range = rangeOf(part)
        return generateJson(llm, {
          purpose: 'teach',
          prompt: quizPrompt({ scopeTitle: scope.title, outline: scope.outline, concepts: '', passages: formatPassages(part.passages, part.title), language: scope.language, range, part: part.label, focus: wanted }),
          maxTokens: 2000 + range.max * 500,
          signal: api.signal,
          onText,
          normalize: raw => {
            const items = thinEvenly(normalizePractice(raw, [], LIMITS.quizItems).items, range.max)
            if (!wanted && items.length < Math.min(3, range.min)) throw new Error(`The quiz is too short: write at least ${range.min} questions.`)
            return items
          },
        })
      })
      const items = takeEvenly(lists, LIMITS.quizItems).map((entry, index) => ({ ...entry, id: `i${index + 1}` }))
      if (!items.length) throw new TutorError('focus-empty', 'Nothing in these materials falls within the focus')
      const item = { id: newId('dck'), kind: 'quiz', title: titleOf(scope, wanted), language: scope.language, materialIds: scope.ids, ...(wanted ? { focus: wanted } : {}), ...(missing.length ? { missing } : {}), items, createdAt: stamp() }
      await store.writeJson(store.paths.item('decks', item.id), item)
      return { item }
    })
  }

  async function listItems({ kind }) {
    if (!['sheets', 'decks', 'assist', 'shorts'].includes(kind)) throw new TutorError('invalid', 'Unknown collection')
    const ids = await store.listIds(store.paths.collection(kind), { sheets: 'chs', decks: 'dck', assist: 'thd', shorts: 'sht' }[kind])
    const items = (await Promise.all(ids.map(id => store.readJson(store.paths.item(kind, id), null)))).filter(Boolean)
    return items
      .map(item => ({ id: item.id, kind: item.kind ?? kind, title: item.title, language: item.language, createdAt: item.createdAt, updatedAt: item.updatedAt ?? item.createdAt, count: item.cards?.length ?? item.items?.length ?? item.turns?.length ?? item.board?.steps?.length ?? null }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async function getItem({ kind, id }) {
    const item = await store.readJson(store.paths.item(kind, id), null)
    if (!item) throw new TutorError('not-found', 'Not found')
    return { item }
  }

  async function removeItem({ kind, id }) {
    const path = store.paths.item(kind, id)
    await store.removeDir(path)
    return { removed: id }
  }

  async function saveStandaloneLayout({ id, layout }) {
    const item = await store.updateJson(store.paths.item('sheets', assertId(id, 'chs')), null, value => {
      if (!value?.sheet) throw new TutorError('not-found', 'Cheat sheet not found')
      value.sheet.layout = cleanLayout(layout, value.sheet)
      return value
    })
    return { item }
  }

  async function reviewDeckCard({ id, cardId, grade }) {
    const item = await store.updateJson(store.paths.item('decks', assertId(id, 'dck')), null, value => {
      if (!value?.cards?.some(card => card.id === cardId)) throw new TutorError('not-found', 'Card not found')
      value.srs ??= {}
      value.srs[cardId] = review(value.srs[cardId] ?? createCard(cardId, now().getTime()), grade, now().getTime())
      value.updatedAt = stamp()
      return value
    })
    return { srs: item.srs[cardId] }
  }

  // ── instant help on the board ────────────────────────────────────────────

  // newThreadId lets a caller (the teacher preset's tool) know the thread id
  // before the board is finished.
  function assist({ mode = 'explain', request, materialIds = [], threadId, newThreadId }) {
    const ask = text(request, 4000)
    if (!ask) throw new TutorError('empty-question', 'Type your question')
    const chosen = ASSIST_MODES.includes(mode) ? mode : 'explain'
    const fresh = /^thd_[a-z0-9]{6,40}$/u.test(String(newThreadId)) ? newThreadId : null
    return jobs.start('assist/turn', async api => {
      let thread = threadId ? await store.readJson(store.paths.item('assist', assertId(threadId, 'thd')), null) : null
      const ids = [...new Set([...(thread?.materialIds ?? []), ...(Array.isArray(materialIds) ? materialIds : [])])].filter(id => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, 8)
      const materials = await readMaterials(store, ids)
      const language = thread?.language ?? detectLanguage(ask, uiLanguage())
      const profile = await readProfile(store)
      const history = (thread?.turns ?? []).slice(-4).map(turn => `Learner (${turn.mode}): ${turn.request}\nTutor board: ${(turn.board?.steps ?? []).slice(0, 6).map(step => step.say).join(' ')}`).join('\n\n')
      const images = await assistImages(ids)
      const board = await generateSteps(llm, {
        purpose: 'teach',
        effort: 'lowest',
        prompt: assistPrompt({ mode: chosen, request: ask, language, passages: passagesFor(materials, ask, 8000), history, learner: { profile } }),
        images: images.length ? images : undefined,
        maxTokens: 10000,
        signal: api.signal,
        onStep: step => api.push(step),
        minSteps: 1,
      })
      const turn = { mode: chosen, request: ask, board, at: stamp() }
      const id = thread?.id ?? fresh ?? newId('thd')
      // Append under the store's lock: an earlier answer may finish in the
      // background while this one was being written.
      const saved = await store.updateJson(store.paths.item('assist', id), null, current => {
        const next = current ?? { id, title: board.title || ask.slice(0, 60), language, materialIds: [], turns: [], createdAt: stamp() }
        next.turns = [...(next.turns ?? []), turn].slice(-MAX_TURNS)
        next.materialIds = [...new Set([...(next.materialIds ?? []), ...ids])].slice(0, 8)
        next.updatedAt = stamp()
        return next
      })
      return { threadId: saved.id, turn: saved.turns.length - 1, board }
    }, { meta: { threadId: threadId ?? fresh, title: ask.slice(0, 60) } })
  }

  // Images are offered to vision-capable models only.
  async function assistImages(ids) {
    return llm.supportsImages?.('teach') ? materialImages(store, await readMaterials(store, ids)) : []
  }

  // ── explainer shorts ─────────────────────────────────────────────────────

  function makeShort({ topic, url, newId: presetId }) {
    const subject = text(topic, 300)
    if (!subject && !url) throw new TutorError('empty-topic', 'Give a topic or a web address')
    const id = /^sht_[a-z0-9]{6,40}$/u.test(String(presetId)) ? presetId : newId('sht')
    return jobs.start('short/make', async api => {
      let passages = ''
      let sourceTitle = ''
      if (url) {
        api.progress(0, 2, 'fetching')
        const page = await ingestUrl(url, { signal: api.signal })
        sourceTitle = page.title
        passages = page.chunks.slice(0, 10).map(chunk => chunk.text).join('\n\n').slice(0, 12000)
      }
      api.progress(1, 2, 'writing')
      const language = detectLanguage(subject || passages, uiLanguage())
      const board = await generateSteps(llm, {
        purpose: 'teach',
        effort: 'lowest',
        prompt: shortPrompt({ topic: subject || sourceTitle, passages, language }),
        maxTokens: 8000,
        signal: api.signal,
        onStep: step => api.push(step),
        minSteps: 3,
      })
      const item = { id, title: board.title || subject || sourceTitle, topic: subject, sourceUrl: url ? String(url) : null, language, board, createdAt: stamp() }
      await store.writeJson(store.paths.item('shorts', item.id), item)
      return { item }
    }, { meta: { id, title: subject } })
  }

  return Object.freeze({
    upload, addUrl, listMaterials, searchMaterials, getMaterial, renameMaterial, removeMaterial, digest,
    makeSheet, makeTopicSheet, makeNotes, makeCards, makeQuiz, listItems, getItem, removeItem, saveStandaloneLayout, reviewDeckCard,
    assist, assistImages, makeShort,
  })
}

function normalizeDigest(raw) {
  return {
    overview: text(raw?.overview, 2000),
    structure: (Array.isArray(raw?.structure) ? raw.structure : []).slice(0, 30).map(item => ({ heading: text(item?.heading, 160), points: (item?.points ?? []).map(point => text(point, 400)).filter(Boolean).slice(0, 10), pages: text(item?.pages, 30) })).filter(item => item.heading),
    keyIdeas: (raw?.keyIdeas ?? []).map(item => text(item, 400)).filter(Boolean).slice(0, 15),
    arguments: (raw?.arguments ?? []).slice(0, 15).map(item => ({ claim: text(item?.claim, 400), support: text(item?.support, 600), page: text(item?.page, 20) })).filter(item => item.claim),
    glossary: (raw?.glossary ?? []).slice(0, 30).map(item => ({ term: text(item?.term, 80), meaning: text(item?.meaning, 400) })).filter(item => item.term),
    questions: (raw?.questions ?? []).map(item => text(item, 300)).filter(Boolean).slice(0, 8),
  }
}

export function normalizeDigestPart(raw) {
  const value = {
    sections: (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 12).map(item => ({ heading: text(item?.heading, 160), pages: text(item?.pages, 30), points: (Array.isArray(item?.points) ? item.points : []).map(point => text(point, 300)).filter(Boolean).slice(0, 6) })).filter(item => item.heading),
    keyIdeas: (Array.isArray(raw?.keyIdeas) ? raw.keyIdeas : []).map(item => text(item, 300)).filter(Boolean).slice(0, 8),
    arguments: (Array.isArray(raw?.arguments) ? raw.arguments : []).slice(0, 8).map(item => ({ claim: text(item?.claim, 300), support: text(item?.support, 400), page: text(item?.page, 20) })).filter(item => item.claim),
    glossary: (Array.isArray(raw?.glossary) ? raw.glossary : []).slice(0, 12).map(item => ({ term: text(item?.term, 80), meaning: text(item?.meaning, 300) })).filter(item => item.term),
  }
  if (!value.sections.length && !value.keyIdeas.length) throw new Error('no notes for this part')
  return value
}

// Part notes as compact text, each part trimmed to an equal share of the budget.
export function digestNotesText(notes, maxChars) {
  const share = Math.max(600, Math.floor(maxChars / Math.max(1, notes.length)))
  return notes.map(note => {
    const lines = [`[Part ${note.part}/${note.of}${note.range ? ` · ${note.range}` : ''}]`]
    for (const section of note.sections) lines.push(`- ${section.heading}${section.pages ? ` (p.${section.pages})` : ''}: ${section.points.join('; ')}`)
    if (note.keyIdeas.length) lines.push(`Key ideas: ${note.keyIdeas.join('; ')}`)
    for (const argument of note.arguments) lines.push(`Claim: ${argument.claim}${argument.page ? ` (p.${argument.page})` : ''} — ${argument.support}`)
    if (note.glossary.length) lines.push(`Terms: ${note.glossary.map(entry => `${entry.term}: ${entry.meaning}`).join('; ')}`)
    const block = lines.join('\n')
    return block.length > share ? `${block.slice(0, share)}…` : block
  }).join('\n\n')
}
