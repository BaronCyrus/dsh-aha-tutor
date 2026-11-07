// Everything that works without a course: the material library, study
// materials made from it (cheat sheets, flashcards, notes, quizzes, digests),
// instant-help sessions on the board, and two-minute explainer shorts.

import { orderOptions } from '../core/choice-order.js'
import { LIMITS, materialQuizRange, materialsTitle, normalizeCards, normalizeCheatsheet, normalizePractice, partCardRange, shareRange, takeEvenly, text, thinEvenly, uniqueCards } from '../core/course-model.js'
import { assertId, isId, newId } from '../core/ids.js'
import { pictureAsk, QUESTION_PICTURES } from '../core/pictures.js'
import { createCard, review } from '../core/srs.js'
import { checkRange, checkSheet, readPages, scrubCard, scrubDeep, scrubItem, scrubPages, scrubStep, shownBoard, shownSheet } from '../core/citations.js'
import { buildIndex, documentParts, formatPassages, materialParts, passageRange, search, snippetOf, spreadPassages } from '../core/retrieval.js'
import { allChunks, materialImages, materialPassages, materialTopics, outlineText, readMaterials, readProfile } from './context.js'
import { fieldCounter, generateJson, generateSteps, generateText, TutorError } from './generate.js'
import { createFolders } from './folders.js'
import { waitAtMost } from './jobs.js'
import { createPictures, shownPicture } from './pictures.js'
import { ingestFile, ingestUrl, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './materials.js'
import { assistPrompt, cheatsheetPrompt, detectLanguage, digestPartPrompt, digestPrompt, flashcardsPrompt, materialBriefPrompt, quizPrompt, shortPrompt, summaryPrompt } from './prompts.js'
import { createRecognizer } from './recognize.js'
import { cleanLayout } from './lessons.js'

const ASSIST_MODES = ['explain', 'solve', 'visualize']
const MAX_TURNS = 30
// How long deleting a thread waits for an answer still being written to it.
const REMOVE_WAIT_MS = 5000
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
// Room for what the materials of a study aid cover, in its prompts.
const SCOPE_OUTLINE_CHARS = 12_000
// A list joined with "; ", cut after its last whole entry within max.
const clipList = (value, max) => (value.length <= max ? value : `${value.slice(0, value.lastIndexOf('; ', max) > 0 ? value.lastIndexOf('; ', max) : max)}…`)

export function createStudio({ store, llm, jobs, now = () => new Date(), uiLanguage = () => 'zh-CN', folders = createFolders({ store, now }), pictures = createPictures({ store, llm, jobs, now }), removeWaitMs = REMOVE_WAIT_MS }) {
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
      // The outline (bookmarks or headings) and where printed page numbers
      // came from ('pdf' labels or the 'pages' themselves), when found.
      outline: result.outline ?? null,
      printed: result.printed ?? null,
      createdAt: stamp(),
      brief: null,
      ...extra,
    }
    if (result.kind === 'image' && bytes) await store.writeBlob(store.paths.materialBlob(id), bytes)
    if (result.chunks?.length) await store.writeJson(store.paths.materialChunks(id), result.chunks)
    if (result.chunks?.length) {
      try {
        const excerpts = spreadPassages(result.chunks, { maxChars: 12000 })
        const read = readPages(excerpts)
        meta.brief = await generateJson(llm, {
          purpose: 'quick',
          prompt: materialBriefPrompt({ title: meta.title, contents: meta.outline ? outlineText(meta.outline, { maxChars: 3000 }) : '', passages: formatPassages(excerpts, ''), language: detectLanguage(result.chunks[0].text, uiLanguage()) }),
          maxTokens: 1500,
          signal,
          normalize: raw => scrubDeep({
            summary: text(raw?.summary, 800),
            topics: (Array.isArray(raw?.topics) ? raw.topics : []).map(topic => text(topic, 80)).filter(Boolean).slice(0, 30),
            level: text(raw?.level, 20),
            suggestedGoal: text(raw?.suggestedGoal, 300),
          }, read),
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

  // The folder a new material goes into: the one asked for while it still
  // exists, else none (a folder deleted during an upload).
  const folderFor = async folderId => ((await folders.find(folderId)) ? folderId : null)

  // From the HTTP upload route (bytes) or the RPC fallback (base64). The
  // file's name and size are kept, so a folder uploaded again skips it.
  function upload({ name, base64, bytes: raw, folderId }) {
    const fileName = text(name, 200) || 'file'
    if (!raw && (typeof base64 !== 'string' || !base64)) throw new TutorError('invalid', 'No file data')
    if (raw ? raw.length > MAX_UPLOAD_BYTES : base64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) throw new TutorError('too-large', `The file is larger than ${MAX_UPLOAD_MB} MB`)
    return jobs.start('material/upload', async api => {
      api.progress(0, 2, 'reading')
      const bytes = raw ? (Buffer.isBuffer(raw) ? raw : Buffer.from(raw)) : Buffer.from(base64, 'base64')
      const result = await ingestFile({ name: fileName, bytes, signal: api.signal, recognize: recognizer(api) })
      api.progress(1, 2, 'summarizing')
      const meta = await saveMaterial(result, { bytes, signal: api.signal, extra: { fileName, fileSize: bytes.length, folderId: await folderFor(folderId) } })
      return { material: meta }
    })
  }

  function addUrl({ url, folderId }) {
    return jobs.start('material/url', async api => {
      api.progress(0, 2, 'fetching')
      const result = await ingestUrl(url, { signal: api.signal, recognize: recognizer(api) })
      api.progress(1, 2, 'summarizing')
      return { material: await saveMaterial(result, { signal: api.signal, extra: { folderId: await folderFor(folderId) } }) }
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
  // folder: only the materials in this folder, or in none ('none').
  async function searchMaterials({ query, folder }) {
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
    const within = folder === undefined ? null : new Set(metas.filter(meta => (meta.folderId ?? 'none') === folder).map(meta => meta.id))
    const hits = within ? search(libraryIndex.index, wanted, { limit: 400 }).filter(({ chunk }) => within.has(chunk.materialId)).slice(0, 12) : search(libraryIndex.index, wanted, { limit: 12 })
    return {
      results: hits.map(({ chunk }) => ({
        materialId: chunk.materialId,
        title: chunk.materialTitle,
        page: chunk.page ?? null,
        label: chunk.label ?? null,
        slide: chunk.slide ?? null,
        snippet: snippetOf(chunk.text, wanted),
      })),
    }
  }

  async function getMaterial({ id }) {
    const meta = shownDigest(await store.readJson(store.paths.material(assertId(id, 'mat')), null))
    if (!meta) throw new TutorError('not-found', 'Material not found')
    const chunks = (await store.readJson(store.paths.materialChunks(id), [])) ?? []
    return { material: meta, preview: chunks.slice(0, 3).map(chunk => ({ page: chunk.page ?? null, label: chunk.label ?? null, slide: chunk.slide ?? null, text: chunk.text.slice(0, 600) })), chunkCount: chunks.length }
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
      // The pages a digest may give: those of the parts that were read.
      let pagesRead = readPages(material.chunks)
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
              normalize: raw => checkDigestPart(normalizeDigestPart(raw), readPages(parts[index])),
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
        pagesRead = readPages(parts.filter((part, index) => notes[index]).flat())
        api.progress(parts.length, parts.length + 1, 'writing')
        prompt = digestPrompt({ title, notes: digestNotesText(read, DIGEST_NOTES_CHARS), language })
      }
      const result = await generateJson(llm, { purpose: 'teach', prompt, maxTokens: 9000, signal: api.signal, normalize: raw => checkDigest(normalizeDigest(raw), pagesRead, material.chunks) })
      // Parts that could not be read are named in the digest, not hidden.
      if (missing.length) result.missing = missing
      const meta = await store.updateJson(store.paths.material(id), null, value => ({ ...value, digest: { ...result, pagesChecked: true, createdAt: stamp() } }))
      return { material: meta }
    }, { key: `digest:${id}` })
  }

  // ── study materials from the library ─────────────────────────────────────

  async function scopeOf(materialIds) {
    const ids = [...new Set(Array.isArray(materialIds) ? materialIds : [])].filter(id => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, LIMITS.materials)
    if (!ids.length) throw new TutorError('no-material', 'Pick at least one material')
    const materials = await readMaterials(store, ids)
    if (!materials.some(item => item.chunks.length)) throw new TutorError('material-no-text', 'These materials have no text')
    const titles = materials.map(item => item.meta.title)
    const language = detectLanguage(materials.find(item => item.chunks.length)?.chunks[0]?.text ?? titles.join(' + '), uiLanguage())
    // What each material covers, its share of the room, so many of them
    // still make a short list.
    const share = Math.max(300, Math.floor(SCOPE_OUTLINE_CHARS / materials.length))
    const outline = materials.map(item => clipList(materialTopics(item.meta), share)).filter(Boolean).join('\n')
    return { ids, materials, title: materialsTitle(titles, language), language, outline }
  }

  function makeSheet({ materialIds, focus }) {
    return jobs.start('studio/sheet', async api => {
      const scope = await scopeOf(materialIds)
      const found = materialPassages(scope.materials, { query: text(focus, 300) || scope.outline, maxChars: 22000, whole: !text(focus, 300) })
      const sheet = await generateJson(llm, {
        purpose: 'teach',
        prompt: cheatsheetPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: found.text, language: scope.language, focus: text(focus, 300) }),
        maxTokens: 10000,
        signal: api.signal,
        normalize: raw => checkSheet(normalizeCheatsheet(raw), { read: found.passages, all: allChunks(scope.materials) }),
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
        // Made from no material, it cites none.
        normalize: raw => checkSheet(normalizeCheatsheet(raw)),
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
      const found = materialPassages(scope.materials, { query: wanted || scope.outline, maxChars: 22000, whole: !wanted })
      const markdown = await generateText(llm, {
        purpose: 'teach',
        prompt: summaryPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: found.text, language: scope.language, focus: wanted }),
        maxTokens: 8000,
        signal: api.signal,
      })
      // The notes cite only pages they were given.
      const item = { id: newId('chs'), kind: 'notes', title: titleOf(scope, wanted), language: scope.language, materialIds: scope.ids, markdown: scrubPages(markdown, readPages(found.passages)).slice(0, 60000), pagesChecked: true, createdAt: stamp() }
      await store.writeJson(store.paths.item('sheets', item.id), item)
      return { item }
    })
  }

  // The materials of a deck or quiz in parts, each written on its own: a
  // short material is one part, a long one about 20,000 characters a part,
  // and many short ones a few to a part. `source` labels a part's passages.
  function partsOf(scope) {
    const parts = materialParts(scope.materials.map(({ meta, chunks }) => ({ title: meta.title, chunks })))
    return parts.map((part, index) => ({ ...part, source: part.mixed ? null : part.title, label: parts.length > 1 ? { n: index + 1, of: parts.length, range: part.mixed ? '' : passageRange(part.passages) } : null }))
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
          prompt: flashcardsPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: formatPassages(part.passages, part.source), language: scope.language, range, part: part.label, focus: wanted }),
          maxTokens: 2000 + range.max * 250,
          signal: api.signal,
          onText,
          normalize: raw => {
            const cards = thinEvenly(normalizeCards(raw, LIMITS.cards * 2), range.max).map(card => scrubCard(card, readPages(part.passages)))
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
          prompt: quizPrompt({ scopeTitle: scope.title, outline: scope.outline, concepts: '', passages: formatPassages(part.passages, part.source), language: scope.language, range, part: part.label, focus: wanted }),
          maxTokens: 2000 + range.max * 500,
          signal: api.signal,
          onText,
          normalize: raw => {
            const items = thinEvenly(normalizePractice(raw, [], LIMITS.quizItems).items, range.max).map(entry => orderOptions(scrubItem(entry, readPages(part.passages))))
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
    return { item: shownItem(item) }
  }

  async function removeItem({ kind, id }) {
    const path = store.paths.item(kind, id)
    if (kind !== 'assist') {
      await store.removeDir(path)
      return { removed: id }
    }
    // An answer still being written (a question, 「讲这题」) would save the
    // thread again: it is stopped first, and whatever it still writes is
    // removed once it has ended. The thread's pictures go with it.
    const ended = jobs.cancelWhere(meta => meta.threadId === id)
    const clear = async () => {
      await store.removeDir(path)
      await pictures.removeThread(id)
    }
    await waitAtMost(ended, removeWaitMs)
    await clear()
    ended.then(clear).catch(() => undefined)
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
  // before the board is finished. pictureIds: pictures pasted into this
  // question (host/pictures.js); with them the question may have no words,
  // and then asks what pictureAsk says for the mode.
  function assist({ mode = 'explain', request, materialIds = [], pictureIds = [], threadId, newThreadId }) {
    const typed = text(request, 4000)
    const pictureList = [...new Set(Array.isArray(pictureIds) ? pictureIds : [])].filter(id => isId(id, 'pic')).slice(0, QUESTION_PICTURES)
    if (!typed && !pictureList.length) throw new TutorError('empty-question', 'Type your question')
    const chosen = ASSIST_MODES.includes(mode) ? mode : 'explain'
    const fresh = isId(newThreadId, 'thd') ? newThreadId : null
    return jobs.start('assist/turn', async api => {
      const thread = threadId ? await store.readJson(store.paths.item('assist', assertId(threadId, 'thd')), null) : null
      const id = thread?.id ?? fresh ?? newId('thd')
      const ids = [...new Set([...(thread?.materialIds ?? []), ...(Array.isArray(materialIds) ? materialIds : [])])].filter(id => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, LIMITS.materials)
      const materials = await readMaterials(store, ids)
      const language = thread?.language ?? detectLanguage(typed, uiLanguage())
      const ask = typed || pictureAsk(chosen, language)
      // This question's pictures, then the latest earlier ones of the
      // thread, as many as one call shows.
      const own = await pictures.forQuestion(pictureList, id)
      const earlierIds = [...new Set((thread?.turns ?? []).flatMap(turn => (turn.pictures ?? []).map(picture => picture.id)).reverse())].filter(pictureId => !pictureList.includes(pictureId))
      const earlier = (await pictures.existing(earlierIds.slice(0, QUESTION_PICTURES))).slice(0, QUESTION_PICTURES - own.length)
      const { way, views } = await pictures.prepare([...own, ...earlier], { signal: api.signal })
      const ownViews = views.slice(0, own.length)
      // Pictures alone, and the teacher would take in none of them.
      if (!typed && ownViews.every(view => view.seen === 'none')) {
        if (way === 'none') throw new TutorError('pictures-unseen', 'No model chosen in Aha settings can see pictures')
        const failed = ownViews.map(view => view.meta.failed).find(code => code && code !== 'failed')
        throw new TutorError(failed ?? 'pictures-unread', 'No text could be read from the pictures')
      }
      const profile = await readProfile(store)
      const history = (thread?.turns ?? []).slice(-4).map(turn => `Learner (${turn.mode}): ${turn.request}${turn.pictures?.length ? ` [with ${turn.pictures.length} picture(s)]` : ''}\nTutor board: ${(shownBoard(turn.board)?.steps ?? []).slice(0, 6).map(step => step.say).join(' ')}`).join('\n\n')
      const pictureImages = await pictures.images(views)
      const images = [...pictureImages, ...await assistImages(ids)].slice(0, QUESTION_PICTURES)
      const texts = views.map((view, index) => (view.seen === 'text' ? `Picture ${index + 1} (${index < own.length ? 'this question' : 'earlier in this session'}):\n${view.text}` : null)).filter(Boolean)
      const seenEarlier = views.slice(own.length).filter(view => view.seen === 'image').length
      const found = materialPassages(materials, { query: [typed, ...views.map(view => view.text)].filter(Boolean).join('\n') || ask, maxChars: 8000 })
      const allowed = readPages(found.passages)
      const written = await generateSteps(llm, {
        purpose: 'teach',
        effort: 'lowest',
        prompt: assistPrompt({
          mode: chosen,
          request: ask,
          language,
          passages: found.text,
          history,
          learner: { profile },
          pictures: views.length ? { shown: pictureImages.length, earlier: Math.min(seenEarlier, pictureImages.length), texts, unseen: ownViews.filter(view => view.seen === 'none').length } : undefined,
        }),
        images: images.length ? images : undefined,
        maxTokens: 10000,
        signal: api.signal,
        onStep: step => api.push(step),
        minSteps: 1,
        clean: step => scrubStep(step, allowed),
      })
      const board = { ...written, pagesChecked: true }
      // How the teacher took in each picture: 'image', 'text' or 'none'.
      const turn = { mode: chosen, request: ask, ...(own.length ? { pictures: ownViews.map(view => ({ id: view.meta.id, seen: view.seen })) } : {}), board, at: stamp() }
      let dropped = false
      // Append under the store's lock: an earlier answer may finish in the
      // background while this one was being written.
      // A thread is named by its first question; one of pictures alone, by
      // the topic its board opens with (every such question asks the same).
      const name = board.title || (typed ? ask : boardHeading(board) || ask)
      const saved = await store.updateJson(store.paths.item('assist', id), null, current => {
        const next = current ?? { id, title: name.slice(0, 60), language, materialIds: [], turns: [], createdAt: stamp() }
        const turns = [...(next.turns ?? []), turn]
        dropped = turns.slice(0, -MAX_TURNS).some(old => old.pictures?.length)
        next.turns = turns.slice(-MAX_TURNS)
        next.materialIds = [...new Set([...(next.materialIds ?? []), ...ids])].slice(0, LIMITS.materials)
        next.updatedAt = stamp()
        return next
      })
      await pictures.claim(pictureList, saved.id)
      // The oldest questions of a long thread are dropped, and their pictures with them.
      if (dropped) await pictures.removeUnused(saved.id, new Set(saved.turns.flatMap(kept => (kept.pictures ?? []).map(picture => picture.id))))
      return { threadId: saved.id, turn: saved.turns.length - 1, board, pictures: turn.pictures ?? [] }
    }, { meta: { threadId: threadId ?? fresh, title: (typed || pictureAsk(chosen, uiLanguage())).slice(0, 60) } })
  }

  // 存进资料库: a copy of a question's picture becomes a library material,
  // its text read and described like any upload. The picture stays with its
  // thread, and keeping it again gives the same material while that exists.
  function keepPicture({ id }) {
    return jobs.start('picture/keep', async api => {
      const meta = await pictures.get(id)
      if (!meta) throw new TutorError('picture-missing', 'This picture is gone')
      const kept = meta.materialId ? await store.readJson(store.paths.material(meta.materialId), null) : null
      if (kept) return { material: kept, picture: shownPicture(meta) }
      const data = await store.readBlob(store.paths.pictureBlob(id))
      if (!data) throw new TutorError('picture-missing', 'This picture is gone')
      api.progress(0, 2, 'reading')
      const name = pictureFileName(meta)
      const result = await ingestFile({ name, bytes: data, signal: api.signal, recognize: recognizer(api) })
      api.progress(1, 2, 'summarizing')
      const title = await pictureTitle(meta)
      const material = await saveMaterial(result, { bytes: data, signal: api.signal, extra: { fileName: name, fileSize: data.length, folderId: null, ...(title ? { title } : {}) } })
      const picture = await pictures.remember(id, { materialId: material.id })
      return { material, picture: shownPicture(picture ?? meta) }
    }, { key: `keep:${id}` })
  }

  // A kept picture is named after its thread ("…", or "… (2)" for the
  // second picture of the thread); one not asked about yet keeps its file name.
  async function pictureTitle(meta) {
    const thread = meta.threadId ? await store.readJson(store.paths.item('assist', meta.threadId), null) : null
    if (!thread?.title) return null
    const all = [...new Set((thread.turns ?? []).flatMap(turn => (turn.pictures ?? []).map(picture => picture.id)))]
    const place = all.indexOf(meta.id)
    return text(all.length > 1 && place >= 0 ? `${thread.title} (${place + 1})` : thread.title, 160)
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
        // Its source text carries no page numbers, so it names none.
        clean: step => scrubStep(step, new Set()),
      })
      const item = { id, title: board.title || subject || sourceTitle, topic: subject, sourceUrl: url ? String(url) : null, language, board: { ...board, pagesChecked: true }, createdAt: stamp() }
      await store.writeJson(store.paths.item('shorts', item.id), item)
      return { item }
    }, { meta: { id, title: subject } })
  }

  return Object.freeze({
    upload, addUrl, listMaterials, searchMaterials, getMaterial, renameMaterial, removeMaterial, digest,
    makeSheet, makeTopicSheet, makeNotes, makeCards, makeQuiz, listItems, getItem, removeItem, saveStandaloneLayout, reviewDeckCard,
    assist, assistImages, keepPicture, makeShort,
  })
}

// The topic a board opens with: the text of its first title.
function boardHeading(board) {
  for (const step of board?.steps ?? []) {
    const heading = (step.ops ?? []).find(op => op.t === 'title')?.text
    if (heading) return text(heading, 60)
  }
  return ''
}

// The name a picture is read under when it is kept: its own, ending in the
// extension of its format, so the library reads it as a picture.
const PICTURE_EXTENSION = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })
function pictureFileName(meta) {
  const extension = PICTURE_EXTENSION[meta.mime] ?? 'png'
  const base = String(meta.name ?? '').replace(/\.[^.]*$/u, '') || 'picture'
  return `${base}.${extension}`
}

// An item as it is shown: a board written before pages were checked shows
// no page numbers, nor do notes; a cheat sheet shows checked citations only.
function shownItem(item) {
  if (item.board) return { ...item, board: shownBoard(item.board) }
  if (Array.isArray(item.turns)) return { ...item, turns: item.turns.map(turn => ({ ...turn, board: shownBoard(turn.board) })) }
  if (item.kind === 'notes' && !item.pagesChecked && typeof item.markdown === 'string') return { ...item, markdown: scrubPages(item.markdown, new Set()) }
  if (item.sheet) return { ...item, sheet: shownSheet(item.sheet) }
  return item
}

// A material whose digest was written before its pages were checked shows
// that digest without pages.
function shownDigest(meta) {
  if (!meta?.digest || meta.digest.pagesChecked) return meta
  return { ...meta, digest: checkDigest(meta.digest, new Set(), []) }
}

// Notes on one part of a document give only that part's pages.
function checkDigestPart(note, read) {
  return {
    ...scrubDeep(note, read, new Set(['pages', 'page'])),
    sections: note.sections.map(section => ({ ...scrubDeep(section, read, new Set(['pages'])), pages: checkRange(section.pages, read) })),
    arguments: note.arguments.map(argument => ({ ...scrubDeep(argument, read, new Set(['page'])), page: checkRange(argument.page, read) })),
  }
}

// A digest gives only pages that were read, each with where it is in the
// file (`pdf`, for the reader to find it). chunks: the material's.
function checkDigest(digest, read, chunks) {
  const inFile = range => {
    const [from, to] = range.split('–')
    const first = chunks.find(chunk => (chunk.label ?? String(chunk.page)) === from)?.page
    const last = [...chunks].reverse().find(chunk => (chunk.label ?? String(chunk.page)) === (to ?? from))?.page
    return first && last ? { pdf: [first, last] } : {}
  }
  const keep = new Set(['pages', 'page', 'pdf', 'missing', 'createdAt', 'pagesChecked'])
  const clean = scrubDeep(digest, read, keep)
  return {
    ...clean,
    structure: (clean.structure ?? []).map(part => {
      const pages = checkRange(part.pages, read)
      return { ...part, pages, ...(pages ? inFile(pages) : {}) }
    }),
    arguments: (clean.arguments ?? []).map(argument => {
      const page = checkRange(argument.page, read)
      return { ...argument, page, ...(page ? inFile(page) : {}) }
    }),
  }
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
