// Exact HTTP routes under DSH's connection (owner-only, same-origin): raw
// file uploads without base64 inflation, TTS audio as real audio bytes, and
// the board's bundled handwriting fonts.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { BOARD_FONT_FILES } from '../core/board-fonts.js'
import { publicCode } from './jobs.js'
import { MAX_UPLOAD_BYTES } from './materials.js'

export const UPLOAD_PATH = '/api/aha-tutor/upload'
export const TTS_PATH = '/api/aha-tutor/tts'
export const FONT_PATH = '/api/aha-tutor/font'

export async function readCapped(stream, max, signal) {
  const parts = []
  let size = 0
  if (!stream) return Buffer.alloc(0)
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    size += chunk.byteLength
    if (size > max) return null
    parts.push(Buffer.from(chunk))
  }
  return Buffer.concat(parts)
}

const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
const failure = (code, message, status) => json({ ok: false, error: { code: `aha-tutor/${code}`, message, details: {} } }, status)

export function uploadRoute({ studio }) {
  return {
    path: UPLOAD_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async request => {
      const name = new URL(request.url).searchParams.get('name') ?? 'file'
      let bytes
      try {
        bytes = await readCapped(request.body, MAX_UPLOAD_BYTES, request.signal)
      } catch {
        return failure('aborted', 'Upload interrupted', 400)
      }
      if (bytes === null) return failure('too-large', 'The file is larger than 60 MB', 413)
      try {
        return json({ ok: true, value: { job: studio.upload({ name, bytes }) } })
      } catch (error) {
        return failure(publicCode(error), error?.name === 'TutorError' ? error.message : 'Upload failed', 400)
      }
    },
  }
}

export function ttsRoute({ speak }) {
  return {
    path: TTS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let body
      try {
        body = await request.json()
      } catch {
        return failure('invalid', 'Invalid request', 400)
      }
      try {
        const result = await speak({ text: String(body?.text ?? '').slice(0, 4000), signal: request.signal })
        return new Response(result.audio, { status: 200, headers: { 'content-type': result.mime, 'cache-control': 'no-store' } })
      } catch (error) {
        const known = error?.name === 'TtsError' || error?.name === 'TutorError'
        return failure(known ? publicCode(error) : 'tts-failed', known ? error.message : 'Speech synthesis failed', ['auth', 'no-key'].includes(error?.code) ? 401 : 502)
      }
    },
  }
}

// The package's own assets/fonts folder. lib/ (installed) and src/host/
// (tests) sit at different depths, so the package is found by its name.
export function fontsDir() {
  return join(dirname(createRequire(import.meta.url).resolve('dsh-aha-tutor/package.json')), 'assets', 'fonts')
}

const FONT_FILES = new Set(BOARD_FONT_FILES.map(entry => entry.file))

// GET ?f=<file>: only the files in the generated manifest. Their names carry a
// content hash, so browsers may cache them for good.
export function fontRoute({ dir = fontsDir() } = {}) {
  const loaded = new Map()
  return {
    path: FONT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const name = new URL(request.url).searchParams.get('f') ?? ''
      if (!FONT_FILES.has(name)) return new Response('Not found', { status: 404 })
      try {
        if (!loaded.has(name)) loaded.set(name, await readFile(join(dir, name)))
      } catch {
        return new Response('Not found', { status: 404 })
      }
      return new Response(loaded.get(name), { status: 200, headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' } })
    },
  }
}
