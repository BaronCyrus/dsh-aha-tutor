// Sample courses shipped with the plugin, so the whiteboard classroom can be
// tried before spending any tokens.

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { parseCoursePack } from '../core/coursepack.js'
import { TutorError } from './generate.js'

const FILE = /^([a-z0-9-]{2,60})\.aha-course\.json$/u

export function createSamples({ dirUrl, courses }) {
  const dir = fileURLToPath(dirUrl)

  async function list() {
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const rows = []
    for (const name of names.sort()) {
      const match = FILE.exec(name)
      if (!match) continue
      try {
        const pack = parseCoursePack(await readFile(join(dir, name), 'utf8'))
        rows.push({ id: match[1], title: pack.course.title, subtitle: pack.course.subtitle ?? '', emoji: pack.course.emoji ?? '📘', language: pack.course.language ?? 'zh-CN' })
      } catch {
        // skip a broken sample
      }
    }
    return rows
  }

  async function importSample({ id }) {
    if (!/^[a-z0-9-]{2,60}$/u.test(String(id))) throw new TutorError('invalid', 'Unknown sample')
    let json
    try {
      json = await readFile(join(dir, `${id}.aha-course.json`), 'utf8')
    } catch {
      throw new TutorError('not-found', 'Sample not found')
    }
    return courses.importPack({ json })
  }

  return Object.freeze({ list, importSample })
}
