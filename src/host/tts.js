// Cloud text-to-speech, host-side only: keys never reach the browser. Each
// provider turns one narration into MP3 bytes. Long text is split at sentence
// boundaries to respect per-request limits, and MP3 parts are concatenated
// (frame streams join cleanly). Synthesized audio is cached on disk by a hash
// of everything that affects the sound, so replaying a lesson costs nothing.

import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { writeFileAtomic } from './store.js'

export const TTS_PROVIDERS = Object.freeze(['openai', 'volcengine', 'minimax', 'azure'])
const REQUEST_TIMEOUT_MS = 45_000
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const CACHE_MAX_BYTES = 300 * 1024 * 1024

export class TtsError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'TtsError'
    this.code = code
    this.status = status
  }
}

// Field descriptions drive the settings form; `secret` fields are stored
// with DSH credentials, the rest in plugin preferences.
export const PROVIDER_FIELDS = Object.freeze({
  openai: [
    { key: 'baseUrl', default: 'https://api.openai.com/v1' },
    { key: 'model', default: 'gpt-4o-mini-tts' },
    { key: 'voice', default: 'alloy' },
    { key: 'apiKey', secret: true },
  ],
  volcengine: [
    { key: 'appId', default: '' },
    { key: 'cluster', default: 'volcano_tts' },
    { key: 'voice', default: 'BV001_streaming' },
    { key: 'apiKey', secret: true },
  ],
  minimax: [
    { key: 'baseUrl', default: 'https://api.minimaxi.com' },
    { key: 'groupId', default: '' },
    { key: 'model', default: 'speech-02-hd' },
    { key: 'voice', default: 'female-shaonv' },
    { key: 'apiKey', secret: true },
  ],
  azure: [
    { key: 'region', default: 'eastasia' },
    { key: 'voice', default: 'zh-CN-XiaoxiaoNeural' },
    { key: 'apiKey', secret: true },
  ],
})

export function providerDefaults(provider) {
  const fields = PROVIDER_FIELDS[provider] ?? []
  return Object.fromEntries(fields.filter(field => !field.secret).map(field => [field.key, field.default]))
}

// https everywhere; plain http only for a TTS server on this machine.
export function checkEndpoint(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new TtsError('address', 'TTS address is not a valid URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new TtsError('address', 'TTS address must use https (http only for localhost)')
  }
  if (url.username || url.password) throw new TtsError('address', 'TTS address must not contain credentials')
  return url
}

const SENTENCE_END = /([。！？!?；;…]+|\.(?=\s)|\n+)/u

export function splitForTts(content, maxUnits) {
  const textValue = String(content ?? '').trim()
  if (!textValue) return []
  const units = value => [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x7f ? 3 : 1), 0)
  if (units(textValue) <= maxUnits) return [textValue]
  const pieces = textValue.split(SENTENCE_END).reduce((acc, part, index, all) => {
    if (index % 2 === 0) acc.push(part + (all[index + 1] ?? ''))
    return acc
  }, []).map(part => part.trim()).filter(Boolean)
  const chunks = []
  let current = ''
  for (const piece of pieces) {
    if (units(piece) > maxUnits) {
      if (current) chunks.push(current)
      current = ''
      let buffer = ''
      for (const char of piece) {
        if (units(buffer + char) > maxUnits) {
          chunks.push(buffer)
          buffer = ''
        }
        buffer += char
      }
      if (buffer) current = buffer
      continue
    }
    if (units(`${current}${piece}`) > maxUnits) {
      chunks.push(current)
      current = piece
    } else {
      current += piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}

async function boundedFetch(fetchImpl, url, init, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error', signal: combined })
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    throw new TtsError(timeout.aborted ? 'timeout' : 'network', timeout.aborted ? 'TTS request timed out' : 'Could not reach the TTS service')
  }
  return response
}

async function readBounded(response) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) throw new TtsError('too-large', 'TTS response is too large')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_AUDIO_BYTES) throw new TtsError('too-large', 'TTS response is too large')
  return buffer
}

function httpError(status) {
  if (status === 401 || status === 403) return new TtsError('auth', 'The TTS service rejected the key', status)
  if (status === 429) return new TtsError('rate-limit', 'The TTS service is rate limiting requests', status)
  if (status >= 500) return new TtsError('server', 'The TTS service returned a server error', status)
  return new TtsError('request', `The TTS service refused the request (${status})`, status)
}

function rateNumber(rate) {
  const value = Number(rate)
  return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1
}

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/gu, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char])
}

const synthesizers = {
  async openai({ text, config, secret, rate, fetchImpl, signal }) {
    const base = checkEndpoint(config.baseUrl || 'https://api.openai.com/v1')
    const path = base.pathname.replace(/\/+$/u, '')
    const url = new URL(`${path}/audio/speech`, base)
    const response = await boundedFetch(fetchImpl, url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ model: config.model || 'gpt-4o-mini-tts', input: text, voice: config.voice || 'alloy', response_format: 'mp3', speed: rateNumber(rate) }),
    }, signal)
    if (!response.ok) throw httpError(response.status)
    return readBounded(response)
  },

  async volcengine({ text, config, secret, rate, fetchImpl, signal }) {
    if (!config.appId) throw new TtsError('app-id', 'Volcengine App ID is required')
    const response = await boundedFetch(fetchImpl, 'https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer;${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: { appid: config.appId, token: 'access_token', cluster: config.cluster || 'volcano_tts' },
        user: { uid: 'aha-tutor' },
        audio: { voice_type: config.voice || 'BV001_streaming', encoding: 'mp3', speed_ratio: rateNumber(rate) },
        request: { reqid: randomUUID(), text, operation: 'query' },
      }),
    }, signal)
    if (!response.ok) throw httpError(response.status)
    let body
    try {
      body = await response.json()
    } catch {
      throw new TtsError('response', 'Volcengine returned an unreadable response')
    }
    if (body?.code !== 3000 || typeof body?.data !== 'string') {
      throw new TtsError(body?.code === 3001 || body?.code === 3003 ? 'auth' : 'request', `Volcengine TTS failed (${body?.code ?? 'unknown'})`)
    }
    const audio = Buffer.from(body.data, 'base64')
    if (audio.length > MAX_AUDIO_BYTES) throw new TtsError('too-large', 'TTS response is too large')
    return audio
  },

  async minimax({ text, config, secret, rate, fetchImpl, signal }) {
    const base = checkEndpoint(config.baseUrl || 'https://api.minimaxi.com')
    const url = new URL('/v1/t2a_v2', base)
    if (config.groupId) url.searchParams.set('GroupId', config.groupId)
    const response = await boundedFetch(fetchImpl, url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model || 'speech-02-hd',
        text,
        stream: false,
        voice_setting: { voice_id: config.voice || 'female-shaonv', speed: rateNumber(rate), vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      }),
    }, signal)
    if (!response.ok) throw httpError(response.status)
    let body
    try {
      body = await response.json()
    } catch {
      throw new TtsError('response', 'MiniMax returned an unreadable response')
    }
    const status = body?.base_resp?.status_code
    if (status !== 0 || typeof body?.data?.audio !== 'string') {
      throw new TtsError(status === 1004 || status === 2049 ? 'auth' : 'request', `MiniMax TTS failed (${status ?? 'unknown'})`)
    }
    const audio = Buffer.from(body.data.audio, 'hex')
    if (audio.length > MAX_AUDIO_BYTES) throw new TtsError('too-large', 'TTS response is too large')
    return audio
  },

  async azure({ text, config, secret, rate, fetchImpl, signal }) {
    const region = String(config.region || '').trim().toLowerCase()
    if (!/^[a-z0-9]{2,30}$/u.test(region)) throw new TtsError('azure', 'Azure region is invalid')
    const voice = String(config.voice || 'zh-CN-XiaoxiaoNeural')
    if (!/^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9:]+$/u.test(voice)) throw new TtsError('azure', 'Azure voice name is invalid')
    const lang = voice.split('-').slice(0, 2).join('-')
    const percent = Math.round((rateNumber(rate) - 1) * 100)
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${percent >= 0 ? '+' : ''}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`
    const response = await boundedFetch(fetchImpl, `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': secret,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'dsh-aha-tutor',
      },
      body: ssml,
    }, signal)
    if (!response.ok) throw httpError(response.status)
    return readBounded(response)
  },
}

// Request size limits in "units" (ASCII = 1, other = 3, roughly UTF-8 bytes).
const CHUNK_UNITS = Object.freeze({ openai: 3800, volcengine: 900, minimax: 9000, azure: 6000 })

export function createTts({ cacheDir, fetchImpl = globalThis.fetch, getSecret }) {
  if (typeof getSecret !== 'function') throw new TypeError('createTts needs getSecret')
  let pruning

  const cacheKey = (provider, config, rate, text) => createHash('sha256')
    .update(JSON.stringify([provider, config.baseUrl ?? '', config.model ?? '', config.voice ?? '', config.cluster ?? '', config.region ?? '', rateNumber(rate), text]))
    .digest('hex')
    .slice(0, 40)

  async function synthesize({ provider, config = {}, text, rate = 1, signal }) {
    if (!TTS_PROVIDERS.includes(provider)) throw new TtsError('config', 'Unknown TTS provider')
    const content = String(text ?? '').trim().slice(0, 4000)
    if (!content) throw new TtsError('empty', 'Nothing to speak')
    const merged = { ...providerDefaults(provider), ...config }
    const key = cacheKey(provider, merged, rate, content)
    const file = cacheDir ? join(cacheDir, `${key}.mp3`) : null
    if (file) {
      try {
        const cached = await readFile(file)
        if (cached.length > 0) return { audio: cached, mime: 'audio/mpeg', cached: true }
      } catch {
        // not cached yet
      }
    }
    const secret = await getSecret(provider)
    if (!secret) throw new TtsError('no-key', 'No key saved for this TTS provider')
    const parts = []
    for (const chunk of splitForTts(content, CHUNK_UNITS[provider])) {
      parts.push(await synthesizers[provider]({ text: chunk, config: merged, secret, rate, fetchImpl, signal }))
    }
    const audio = Buffer.concat(parts)
    if (!audio.length) throw new TtsError('response', 'The TTS service returned no audio')
    if (file) {
      await writeFileAtomic(file, audio).catch(() => undefined)
      pruning ??= prune().finally(() => { pruning = undefined })
    }
    return { audio, mime: 'audio/mpeg', cached: false }
  }

  // Keep the cache under its size budget, oldest files first.
  async function prune() {
    if (!cacheDir) return
    let names
    try {
      names = await readdir(cacheDir)
    } catch {
      return
    }
    const files = []
    for (const name of names) {
      if (!name.endsWith('.mp3')) continue
      try {
        const info = await stat(join(cacheDir, name))
        files.push({ name, size: info.size, time: info.mtimeMs })
      } catch {
        // vanished
      }
    }
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= CACHE_MAX_BYTES) break
      await unlink(join(cacheDir, file.name)).catch(() => undefined)
      total -= file.size
    }
  }

  return Object.freeze({ synthesize, prune })
}
