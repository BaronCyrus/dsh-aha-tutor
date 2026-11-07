// Pictures pasted or dropped into a question (即时答疑): a screenshot of a
// problem, a photo of a page. They are kept with the thread that asked
// about them, not in the library, and are deleted with it; 存进资料库
// copies one into the library (studio.keepPicture). A picture no question
// has used yet is pending, and is removed a day after it came.
//
// How the teacher takes one in is decided each time it is asked about:
// a teaching model that sees images is given the picture itself; else the
// text in it, read by the quick route when that one sees images
// (recognize.js); else nothing, and the learner is told. Never another
// model than the learner chose.

import { text } from '../core/course-model.js'
import { newId, isId } from '../core/ids.js'
import { pictureMime } from '../core/pictures.js'
import { TutorError } from './generate.js'
import { publicCode } from './jobs.js'
import { MAX_IMAGE_BYTES } from './materials.js'
import { createRecognizer } from './recognize.js'

// A picture no question has used is removed after this long.
const PENDING_MS = 24 * 60 * 60_000
// The text read from one picture, at most.
const TEXT_CHARS = 6000
// The text read from a picture, as the browser shows it.
const SHOWN_TEXT_CHARS = 1500

const pictureName = name => text(String(name ?? '').split(/[\\/]/u).pop(), 120) || 'picture'

// What the browser may see of a picture.
export function shownPicture(meta) {
  return {
    id: meta.id,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    sight: meta.sight ?? null,
    text: typeof meta.text === 'string' ? meta.text.slice(0, SHOWN_TEXT_CHARS) : null,
    failed: meta.failed ?? null,
    materialId: meta.materialId ?? null,
    createdAt: meta.createdAt,
  }
}

export function createPictures({ store, llm, jobs, now = () => new Date(), pendingMs = PENDING_MS }) {
  const stamp = () => now().toISOString()
  const missing = () => new TutorError('picture-missing', 'This picture is gone; paste it again')

  async function get(id) {
    return isId(id, 'pic') ? store.readJson(store.paths.picture(id), null) : null
  }

  // How the teacher would take in a picture now: 'image' (the teaching
  // model sees images), 'text' (the quick route reads the text in it) or
  // 'none' (no model the learner chose sees images).
  async function sight(signal) {
    await llm.refreshCapabilities?.(signal)
    if (llm.supportsImages?.('teach')) return 'image'
    return llm.supportsImages?.('quick') ? 'text' : 'none'
  }

  // The text in a picture, read by the learner's model, as fields to save:
  // { text } (empty when it has none), { failed: code }, or { sight:
  // 'none' } when no model the learner chose sees images after all.
  async function readText(meta, data, signal) {
    const recognize = createRecognizer({ llm, signal, atOnce: 1 })
    const results = await recognize([{ where: { picture: 1 }, image: async () => ({ mime: meta.mime, data }) }])
    if (!results) return { sight: 'none' }
    const [result] = results
    if (result?.error) return { failed: publicCode(result.error) }
    return { text: String(result?.text ?? '').slice(0, TEXT_CHARS), failed: null }
  }

  // From the HTTP upload route (bytes) or the RPC fallback (base64). The
  // picture is shown (the job's preview) as soon as it is stored; its text
  // is read first when only the quick route sees images.
  function upload({ name, bytes, base64 }) {
    const data = bytes ? Buffer.from(bytes) : Buffer.from(typeof base64 === 'string' ? base64 : '', 'base64')
    if (!data.length) throw new TutorError('empty', 'This file is empty')
    if (data.length > MAX_IMAGE_BYTES) throw new TutorError('image-too-large', 'Pictures must be smaller than 10 MB')
    const mime = pictureMime(data)
    if (!mime) throw new TutorError('picture-unsupported', 'Only PNG, JPEG, WebP and GIF pictures can go with a question')
    return jobs.start('picture/upload', async api => {
      await sweep().catch(() => undefined)
      const id = newId('pic')
      const meta = { id, name: pictureName(name), mime, size: data.length, threadId: null, sight: null, text: null, failed: null, createdAt: stamp() }
      try {
        await store.writeBlob(store.paths.pictureBlob(id), data)
        await store.writeJson(store.paths.picture(id), meta)
        api.preview(shownPicture(meta))
        meta.sight = await sight(api.signal)
        if (meta.sight === 'text') {
          api.progress(0, 1, 'recognizing')
          Object.assign(meta, await readText(meta, data, api.signal))
        }
        await store.writeJson(store.paths.picture(id), meta)
      } catch (error) {
        // Cancelled or failed before it could be used: nothing is left behind.
        await store.removeDir(store.paths.pictureDir(id)).catch(() => undefined)
        throw error
      }
      return { picture: shownPicture(meta) }
    })
  }

  // The bytes the browser shows.
  async function blob(id) {
    const meta = await get(id)
    if (!meta) return null
    const data = await store.readBlob(store.paths.pictureBlob(id))
    return data ? { mime: meta.mime, data } : null
  }

  // A picture taken out of a question before it was asked. One a question
  // has used stays with its thread.
  async function discard(id) {
    const meta = await get(id)
    if (meta && !meta.threadId) await store.removeDir(store.paths.pictureDir(id))
    return { removed: id }
  }

  // The pictures of a question about thread threadId, in order: pending
  // ones, or ones this thread used before. Any other is refused.
  async function forQuestion(ids, threadId) {
    const metas = []
    for (const id of ids) {
      const meta = await get(id)
      if (!meta || (meta.threadId && meta.threadId !== threadId)) throw missing()
      metas.push(meta)
    }
    return metas
  }

  // Earlier pictures of a thread that are still there, in the order given.
  async function existing(ids) {
    const metas = []
    for (const id of ids) {
      const meta = await get(id)
      if (meta) metas.push(meta)
    }
    return metas
  }

  // How the teacher takes in each picture of a question now: { way, views:
  // [{ meta, seen, text }] }, way being sight() and seen 'image', 'text' or
  // 'none'. Text not read yet is read now (and kept) when only the quick
  // route sees images; text read before is used even when no route sees
  // images any more.
  async function prepare(metas, { signal } = {}) {
    if (!metas.length) return { way: null, views: [] }
    const way = await sight(signal)
    const views = []
    for (const meta of metas) {
      if (way === 'image') {
        views.push({ meta, seen: 'image', text: null })
        continue
      }
      let current = meta
      if (way === 'text' && typeof meta.text !== 'string') {
        const data = await store.readBlob(store.paths.pictureBlob(meta.id))
        if (!data) throw missing()
        const read = await readText(meta, data, signal)
        current = await store.updateJson(store.paths.picture(meta.id), meta, value => ({ ...value, ...read, sight: read.sight ?? 'text' }))
      }
      const textValue = typeof current.text === 'string' ? current.text.trim() : ''
      views.push({ meta: current, seen: textValue ? 'text' : 'none', text: textValue || null })
    }
    return { way, views }
  }

  // The pictures shown to the model as images, base64 as llm.complete takes them.
  async function images(views) {
    const shown = []
    for (const view of views) {
      if (view.seen !== 'image') continue
      const data = await store.readBlob(store.paths.pictureBlob(view.meta.id))
      if (data) shown.push({ mime: view.meta.mime, base64: data.toString('base64') })
    }
    return shown
  }

  // A question was saved with these pictures: they belong to its thread.
  async function claim(ids, threadId) {
    for (const id of ids) {
      await store.updateJson(store.paths.picture(id), null, meta => (meta && !meta.threadId ? { ...meta, threadId } : meta)).catch(() => undefined)
    }
  }

  async function all() {
    const ids = await store.listIds(store.paths.pictures(), 'pic')
    return (await Promise.all(ids.map(id => get(id)))).filter(Boolean)
  }

  // Everything a thread's questions used, removed with the thread.
  async function removeThread(threadId) {
    for (const meta of await all()) {
      if (meta.threadId === threadId) await store.removeDir(store.paths.pictureDir(meta.id))
    }
  }

  // Pictures of a thread its questions no longer name (the oldest questions
  // of a long thread are dropped).
  async function removeUnused(threadId, kept) {
    for (const meta of await all()) {
      if (meta.threadId === threadId && !kept.has(meta.id)) await store.removeDir(store.paths.pictureDir(meta.id))
    }
  }

  // Pending pictures older than a day: pasted, then never asked about.
  async function sweep() {
    const cutoff = now().getTime() - pendingMs
    for (const meta of await all()) {
      if (!meta.threadId && Date.parse(meta.createdAt) < cutoff) await store.removeDir(store.paths.pictureDir(meta.id))
    }
  }

  // Pictures as the browser shows them, null for those gone.
  async function list(ids) {
    return { pictures: await Promise.all(ids.map(async id => {
      const meta = await get(id)
      return meta ? shownPicture(meta) : null
    })) }
  }

  async function remember(id, fields) {
    return store.updateJson(store.paths.picture(id), null, meta => (meta ? { ...meta, ...fields } : meta))
  }

  return Object.freeze({ upload, get, list, blob, discard, forQuestion, existing, prepare, images, claim, removeThread, removeUnused, sweep, remember })
}
