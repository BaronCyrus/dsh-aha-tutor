// Exact HTTP routes under DSH's connection (owner-only, same-origin): raw
// file uploads without base64 inflation, and TTS audio as real audio bytes.

import { MAX_UPLOAD_BYTES } from './materials.js'

export const UPLOAD_PATH = '/api/aha-tutor/upload'
export const TTS_PATH = '/api/aha-tutor/tts'

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
        return failure(error?.code ?? 'failed', error?.name === 'TutorError' ? error.message : 'Upload failed', 400)
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
        return failure(error?.code ?? 'tts', known ? error.message : 'Speech synthesis failed', error?.code === 'auth' ? 401 : 502)
      }
    },
  }
}
