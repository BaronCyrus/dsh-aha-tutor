// Everything that works without a course: the material library, study
// materials made from it (cheat sheets, flashcards, notes, quizzes, digests),
// instant-help sessions on the board, and two-minute explainer shorts.

import { normalizeCards, normalizeCheatsheet, normalizePractice, text } from '../core/course-model.js'
import { assertId, newId } from '../core/ids.js'
import { createCard, review } from '../core/srs.js'
import { materialImages, passagesFor, readMaterials, readProfile } from './context.js'
import { generateJson, generateSteps, generateText, TutorError } from './generate.js'
import { ingestFile, ingestUrl, MAX_UPLOAD_BYTES } from './materials.js'
import { assistPrompt, cheatsheetPrompt, detectLanguage, digestPrompt, flashcardsPrompt, materialBriefPrompt, quizPrompt, shortPrompt, summaryPrompt } from './prompts.js'
import { cleanLayout } from './lessons.js'

const ASSIST_MODES = ['explain', 'solve', 'visualize']
const MAX_TURNS = 30

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
          prompt: materialBriefPrompt({ title: meta.title, passages: result.chunks.slice(0, 8).map(chunk => chunk.text).join('\n\n').slice(0, 9000), language: detectLanguage(result.chunks[0].text, uiLanguage()) }),
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

  // From the HTTP upload route (bytes) or the RPC fallback (base64).
  function upload({ name, base64, bytes: raw }) {
    const fileName = text(name, 200) || 'file'
    if (!raw && (typeof base64 !== 'string' || !base64)) throw new TutorError('invalid', 'No file data')
    if (raw ? raw.length > MAX_UPLOAD_BYTES : base64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) throw new TutorError('too-large', 'The file is larger than 60 MB')
    return jobs.start('material/upload', async api => {
      api.progress(0, 2, 'reading')
      const bytes = raw ? Buffer.from(raw) : Buffer.from(base64, 'base64')
      const result = await ingestFile({ name: fileName, bytes, signal: api.signal })
      api.progress(1, 2, 'summarizing')
      const meta = await saveMaterial(result, { bytes, signal: api.signal, extra: { fileName } })
      return { material: meta }
    })
  }

  function addUrl({ url }) {
    return jobs.start('material/url', async api => {
      api.progress(0, 2, 'fetching')
      const result = await ingestUrl(url, { signal: api.signal })
      api.progress(1, 2, 'summarizing')
      return { material: await saveMaterial(result, { signal: api.signal }) }
    })
  }

  async function listMaterials() {
    const ids = await store.listIds(store.paths.materials(), 'mat')
    const metas = (await Promise.all(ids.map(id => store.readJson(store.paths.material(id), null)))).filter(Boolean)
    return metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
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

  function digest({ id }) {
    return jobs.start('material/digest', async api => {
      const [material] = await readMaterials(store, [assertId(id, 'mat')])
      if (!material?.chunks.length) throw new TutorError('invalid', 'This material has no text to digest')
      const language = detectLanguage(material.chunks[0].text, uiLanguage())
      const result = await generateJson(llm, {
        purpose: 'teach',
        prompt: digestPrompt({ title: material.meta.title, passages: passagesFor([material], '', 24000), language }),
        maxTokens: 9000,
        signal: api.signal,
        normalize: raw => ({
          overview: text(raw?.overview, 2000),
          structure: (Array.isArray(raw?.structure) ? raw.structure : []).slice(0, 30).map(item => ({ heading: text(item?.heading, 160), points: (item?.points ?? []).map(point => text(point, 400)).filter(Boolean).slice(0, 10), pages: text(item?.pages, 30) })).filter(item => item.heading),
          keyIdeas: (raw?.keyIdeas ?? []).map(item => text(item, 400)).filter(Boolean).slice(0, 15),
          arguments: (raw?.arguments ?? []).slice(0, 15).map(item => ({ claim: text(item?.claim, 400), support: text(item?.support, 600), page: text(item?.page, 20) })).filter(item => item.claim),
          glossary: (raw?.glossary ?? []).slice(0, 30).map(item => ({ term: text(item?.term, 80), meaning: text(item?.meaning, 400) })).filter(item => item.term),
          questions: (raw?.questions ?? []).map(item => text(item, 300)).filter(Boolean).slice(0, 8),
        }),
      })
      const meta = await store.updateJson(store.paths.material(id), null, value => ({ ...value, digest: { ...result, createdAt: stamp() } }))
      return { material: meta }
    }, { key: `digest:${id}` })
  }

  // ── study materials from the library ─────────────────────────────────────

  async function scopeOf(materialIds) {
    const ids = (Array.isArray(materialIds) ? materialIds : []).filter(id => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, 8)
    if (!ids.length) throw new TutorError('invalid', 'Pick at least one material')
    const materials = await readMaterials(store, ids)
    if (!materials.some(item => item.chunks.length)) throw new TutorError('invalid', 'These materials have no text')
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

  function makeNotes({ materialIds }) {
    return jobs.start('studio/notes', async api => {
      const scope = await scopeOf(materialIds)
      const markdown = await generateText(llm, {
        purpose: 'teach',
        prompt: summaryPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: passagesFor(scope.materials, scope.outline, 22000), language: scope.language }),
        maxTokens: 8000,
        signal: api.signal,
      })
      const item = { id: newId('chs'), kind: 'notes', title: scope.title, language: scope.language, materialIds: scope.ids, markdown: markdown.slice(0, 60000), createdAt: stamp() }
      await store.writeJson(store.paths.item('sheets', item.id), item)
      return { item }
    })
  }

  function makeCards({ materialIds, count = 24 }) {
    return jobs.start('studio/cards', async api => {
      const scope = await scopeOf(materialIds)
      const cards = await generateJson(llm, {
        purpose: 'teach',
        prompt: flashcardsPrompt({ scopeTitle: scope.title, outline: scope.outline, passages: passagesFor(scope.materials, scope.outline, 18000), language: scope.language, count: Math.min(60, Math.max(8, Math.round(Number(count) || 24))) }),
        maxTokens: 9000,
        signal: api.signal,
        normalize: raw => {
          const value = normalizeCards(raw)
          if (!value.length) throw new Error('no cards')
          return value
        },
      })
      const item = { id: newId('dck'), kind: 'cards', title: scope.title, language: scope.language, materialIds: scope.ids, cards, srs: {}, createdAt: stamp() }
      await store.writeJson(store.paths.item('decks', item.id), item)
      return { item }
    })
  }

  function makeQuiz({ materialIds, count = 10 }) {
    return jobs.start('studio/quiz', async api => {
      const scope = await scopeOf(materialIds)
      const quiz = await generateJson(llm, {
        purpose: 'teach',
        prompt: quizPrompt({ scopeTitle: scope.title, outline: `${scope.outline}\n\n${passagesFor(scope.materials, scope.outline, 16000)}`, concepts: '', language: scope.language, count: Math.min(25, Math.max(5, Math.round(Number(count) || 10))) }),
        maxTokens: 9000,
        signal: api.signal,
        normalize: raw => {
          const set = normalizePractice(raw, [])
          if (set.items.length < 3) throw new Error('quiz too short')
          return set
        },
      })
      const item = { id: newId('dck'), kind: 'quiz', title: scope.title, language: scope.language, materialIds: scope.ids, items: quiz.items, createdAt: stamp() }
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
    if (!ask) throw new TutorError('invalid', 'Type your question')
    const chosen = ASSIST_MODES.includes(mode) ? mode : 'explain'
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
        prompt: assistPrompt({ mode: chosen, request: ask, language, passages: passagesFor(materials, ask, 8000), history, learner: { profile } }),
        images: images.length ? images : undefined,
        maxTokens: 10000,
        signal: api.signal,
        onStep: step => api.push(step),
        minSteps: 1,
      })
      const turn = { mode: chosen, request: ask, board, at: stamp() }
      if (!thread) thread = { id: /^thd_[a-z0-9]{6,40}$/u.test(String(newThreadId)) ? newThreadId : newId('thd'), title: board.title || ask.slice(0, 60), language, materialIds: ids, turns: [], createdAt: stamp() }
      thread.turns = [...thread.turns, turn].slice(-MAX_TURNS)
      thread.materialIds = ids
      thread.updatedAt = stamp()
      await store.writeJson(store.paths.item('assist', thread.id), thread)
      return { threadId: thread.id, turn: thread.turns.length - 1, board }
    }, { meta: { threadId: threadId ?? null } })
  }

  // Images are offered to vision-capable models only.
  async function assistImages(ids) {
    return llm.supportsImages?.('teach') ? materialImages(store, await readMaterials(store, ids)) : []
  }

  // ── explainer shorts ─────────────────────────────────────────────────────

  function makeShort({ topic, url, newId: presetId }) {
    const subject = text(topic, 300)
    if (!subject && !url) throw new TutorError('invalid', 'Give a topic or a web address')
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
        prompt: shortPrompt({ topic: subject || sourceTitle, passages, language }),
        maxTokens: 8000,
        signal: api.signal,
        onStep: step => api.push(step),
        minSteps: 3,
      })
      const item = { id: /^sht_[a-z0-9]{6,40}$/u.test(String(presetId)) ? presetId : newId('sht'), title: board.title || subject || sourceTitle, topic: subject, sourceUrl: url ? String(url) : null, language, board, createdAt: stamp() }
      await store.writeJson(store.paths.item('shorts', item.id), item)
      return { item }
    })
  }

  return Object.freeze({
    upload, addUrl, listMaterials, getMaterial, renameMaterial, removeMaterial, digest,
    makeSheet, makeTopicSheet, makeNotes, makeCards, makeQuiz, listItems, getItem, removeItem, saveStandaloneLayout, reviewDeckCard,
    assist, assistImages, makeShort,
  })
}
