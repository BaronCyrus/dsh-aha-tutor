// Exact HTTP routes under DSH's connection (owner-only, same-origin): raw
// file uploads without base64 inflation, TTS audio as real audio bytes,
// recorded questions as raw WAV for transcription, the board's bundled
// handwriting fonts, and the pictures pasted into questions.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { BOARD_FONT_FILES } from '../core/board-fonts.js'
import { isId } from '../core/ids.js'
import { publicCode } from './jobs.js'
import { MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './materials.js'
import { MAX_SPEECH_BYTES } from './speech.js'

export const UPLOAD_PATH = '/api/aha-tutor/upload'
export const TTS_PATH = '/api/aha-tutor/tts'
export const FONT_PATH = '/api/aha-tutor/font'
export const SPEECH_PATH = '/api/aha-tutor/speech'
export const PICTURE_PATH = '/api/aha-tutor/picture'

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

// for=question: a picture pasted into a question (host/pictures.js), not a
// library material.
export function uploadRoute({ studio, pictures }) {
  return {
    path: UPLOAD_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async request => {
      const query = new URL(request.url).searchParams
      const name = query.get('name') ?? 'file'
      // The library folder to file it under; anything else files it under none.
      const folderId = isId(query.get('folder'), 'fld') ? query.get('folder') : null
      const picture = query.get('for') === 'question'
      let bytes
      try {
        bytes = await readCapped(request.body, picture ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES, request.signal)
      } catch {
        return failure('aborted', 'Upload interrupted', 400)
      }
      if (bytes === null) return picture ? failure('image-too-large', 'Pictures must be smaller than 10 MB', 413) : failure('too-large', `The file is larger than ${MAX_UPLOAD_MB} MB`, 413)
      try {
        return json({ ok: true, value: { job: picture ? pictures.upload({ name, bytes }) : studio.upload({ name, bytes, folderId }) } })
      } catch (error) {
        return failure(publicCode(error), error?.name === 'TutorError' ? error.message : 'Upload failed', 400)
      }
    },
  }
}

// A recorded question (16 kHz mono PCM16 WAV) in, its text out.
export function speechRoute({ speechInput }) {
  return {
    path: SPEECH_PATH,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async request => {
      let audio
      try {
        audio = await readCapped(request.body, MAX_SPEECH_BYTES, request.signal)
      } catch {
        return failure('aborted', 'Upload interrupted', 400)
      }
      if (audio === null) return failure('speech-too-long', 'The recording is too long', 413)
      try {
        return json({ ok: true, value: await speechInput.transcribe({ audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength), signal: request.signal }) })
      } catch (error) {
        const known = error?.name === 'TutorError'
        return failure(known ? publicCode(error) : 'speech-failed', known ? error.message : 'Speech recognition failed', known && error.code !== 'speech-failed' ? 400 : 502)
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

// GET ?id=<picture>: a picture pasted into a question, for its thumbnail.
// Only stored pictures of the four formats checked on upload are served,
// as what they are; an id never names another picture, so it may be cached.
export function pictureRoute({ pictures }) {
  return {
    path: PICTURE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      const found = isId(id, 'pic') ? await pictures.blob(id).catch(() => null) : null
      if (!found) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
      return new Response(found.data, { status: 200, headers: { 'content-type': found.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } })
    },
  }
}
