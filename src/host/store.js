// Local JSON storage under $DSH_HOME/aha-tutor. Every path is built from a
// validated id, never from user text, so names stay legal on Windows and
// macOS and nothing can escape the data directory. Writes are atomic
// (temp file + rename) and serialized per file; Windows renames that fail
// while an indexer or antivirus holds the target are retried.

import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { assertId } from '../core/ids.js'

export const DATA_DIR_NAME = 'aha-tutor'
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

export function resolveDshHome(env = process.env) {
  return typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
}

export function resolveProjectsRoot(env = process.env) {
  return join(homedir(), 'AhaTutor', 'projects')
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })

async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!RETRYABLE.has(error?.code) || attempt >= attempts) throw error
      await sleep(15 * 2 ** attempt)
    }
  }
}

export async function writeFileAtomic(path, data) {
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
  await writeFile(temp, data)
  try {
    await renameWithRetry(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export function createStore({ root }) {
  if (typeof root !== 'string' || !root) throw new TypeError('store root is required')
  const queues = new Map()

  // Serialize every write to the same file; reads see completed writes.
  const exclusive = (path, task) => {
    const previous = queues.get(path) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    const tail = run.catch(() => undefined)
    queues.set(path, tail)
    tail.then(() => { if (queues.get(path) === tail) queues.delete(path) })
    return run
  }

  const paths = {
    root,
    courses: () => join(root, 'courses'),
    courseDir: id => join(root, 'courses', assertId(id, 'crs')),
    course: id => join(paths.courseDir(id), 'course.json'),
    progress: id => join(paths.courseDir(id), 'progress.json'),
    intake: id => join(paths.courseDir(id), 'intake.json'),
    cards: id => join(paths.courseDir(id), 'cards.json'),
    boardsDir: id => join(paths.courseDir(id), 'boards'),
    practiceDir: id => join(paths.courseDir(id), 'practice'),
    sheetsDir: id => join(paths.courseDir(id), 'sheets'),
    board: (id, lessonId) => join(paths.courseDir(id), 'boards', `${assertId(lessonId, 'les')}.json`),
    practice: (id, lessonId) => join(paths.courseDir(id), 'practice', `${assertId(lessonId, 'les')}.json`),
    sheet: (id, unitId) => join(paths.courseDir(id), 'sheets', `${assertId(unitId, 'unt')}.json`),
    unitQuiz: (id, unitId) => join(paths.courseDir(id), 'quizzes', `${assertId(unitId, 'unt')}.json`),
    materials: () => join(root, 'materials'),
    materialDir: id => join(root, 'materials', assertId(id, 'mat')),
    material: id => join(paths.materialDir(id), 'meta.json'),
    materialChunks: id => join(paths.materialDir(id), 'chunks.json'),
    materialBlob: id => join(paths.materialDir(id), 'original.bin'),
    collection: kind => join(root, assertKind(kind)),
    item: (kind, id) => join(root, assertKind(kind), `${assertId(id, KIND_PREFIX[kind])}.json`),
    profile: () => join(root, 'profile.json'),
    plan: () => join(root, 'plan.json'),
    prefs: () => join(root, 'prefs.json'),
    ttsCache: () => join(root, 'tts-cache'),
  }

  async function readJson(path, fallback = null) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback
      if (error instanceof SyntaxError) return fallback
      throw error
    }
  }

  function writeJson(path, value) {
    return exclusive(path, async () => {
      await mkdir(join(path, '..'), { recursive: true })
      await writeFileAtomic(path, `${JSON.stringify(value, null, 1)}\n`)
      return value
    })
  }

  // Read-modify-write under the file's lock.
  function updateJson(path, fallback, mutate) {
    return exclusive(path, async () => {
      const current = await readJson(path, fallback)
      const next = (await mutate(current)) ?? current
      await mkdir(join(path, '..'), { recursive: true })
      await writeFileAtomic(path, `${JSON.stringify(next, null, 1)}\n`)
      return next
    })
  }

  function writeBlob(path, data) {
    return exclusive(path, async () => {
      await mkdir(join(path, '..'), { recursive: true })
      await writeFileAtomic(path, data)
    })
  }

  async function readBlob(path) {
    try {
      return await readFile(path)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function removeDir(path) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true })
        return
      } catch (error) {
        if (!RETRYABLE.has(error?.code) || attempt >= 6) throw error
        await sleep(30 * 2 ** attempt)
      }
    }
  }

  async function listIds(dir, prefix) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      return entries
        .map(entry => (entry.isDirectory() ? entry.name : entry.name.replace(/\.json$/u, '')))
        .filter(name => name.startsWith(`${prefix}_`) && /^[a-z]{2,6}_[a-z0-9]{6,40}$/u.test(name))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async function exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  return Object.freeze({ paths, readJson, writeJson, updateJson, writeBlob, readBlob, removeDir, listIds, exists })
}

// Standalone collections (not tied to one course).
export const KIND_PREFIX = Object.freeze({
  assist: 'thd',
  shorts: 'sht',
  decks: 'dck',
  sheets: 'chs',
})

function assertKind(kind) {
  if (!Object.hasOwn(KIND_PREFIX, kind)) throw new TypeError(`unknown collection "${kind}"`)
  return kind
}
