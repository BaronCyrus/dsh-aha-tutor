// Plugin preferences (a JSON file next to the plugin's data) and cloud TTS
// keys (DSH's credential store, never sent back to the browser).

import { PROVIDER_FIELDS, providerDefaults, TTS_PROVIDERS } from './tts.js'
import { TutorError } from './generate.js'

export const PREF_DEFAULTS = Object.freeze({
  teachProvider: '',
  teachModel: '',
  quickProvider: '',
  quickModel: '',
  voiceEngine: 'browser',
  voiceRate: 1,
  boardTheme: 'auto',
  boardFont: 'hand',
  ttsProvider: 'openai',
  tts: Object.fromEntries(TTS_PROVIDERS.map(provider => [provider, providerDefaults(provider)])),
})

const ROUTE = /^[\w.:@/-]{0,200}$/u

export function cleanPrefs(input = {}, base = PREF_DEFAULTS) {
  const next = { ...base, tts: { ...base.tts } }
  for (const key of ['teachProvider', 'teachModel', 'quickProvider', 'quickModel']) {
    if (input[key] !== undefined) next[key] = ROUTE.test(String(input[key])) ? String(input[key]) : base[key]
  }
  if (['browser', 'cloud', 'off'].includes(input.voiceEngine)) next.voiceEngine = input.voiceEngine
  if (input.voiceRate !== undefined) {
    const rate = Number(input.voiceRate)
    if (Number.isFinite(rate)) next.voiceRate = Math.min(2, Math.max(0.5, Math.round(rate * 100) / 100))
  }
  if (['auto', 'light', 'dark'].includes(input.boardTheme)) next.boardTheme = input.boardTheme
  if (['hand', 'standard'].includes(input.boardFont)) next.boardFont = input.boardFont
  if (TTS_PROVIDERS.includes(input.ttsProvider)) next.ttsProvider = input.ttsProvider
  for (const provider of TTS_PROVIDERS) {
    const patch = input.tts?.[provider]
    if (!patch || typeof patch !== 'object') continue
    for (const field of PROVIDER_FIELDS[provider]) {
      if (field.secret || patch[field.key] === undefined) continue
      next.tts[provider] = { ...next.tts[provider], [field.key]: String(patch[field.key]).trim().slice(0, 300) }
    }
  }
  return next
}

export function createPrefs(store) {
  let cache = { ...PREF_DEFAULTS }
  return {
    async load() {
      const saved = await store.readJson(store.paths.prefs(), null)
      cache = cleanPrefs(saved ?? {}, PREF_DEFAULTS)
      return cache
    },
    read: () => cache,
    async save(patch) {
      cache = cleanPrefs(patch, cache)
      await store.writeJson(store.paths.prefs(), cache)
      return cache
    },
  }
}

// DSH credentials, record style (no fallback to environment variables).
export function createKeyStore({ getCredentials, credentialKey }) {
  const keyOf = provider => {
    if (!TTS_PROVIDERS.includes(provider)) throw new TutorError('invalid', 'Unknown TTS provider')
    return credentialKey('aha-tutor', `tts-${provider}`)
  }
  const service = () => {
    const credentials = getCredentials()
    if (!credentials) throw new TutorError('no-credentials', 'DSH credentials are not available in this profile')
    return credentials
  }
  return {
    async read(provider) {
      const record = await service().readRecord(keyOf(provider))
      return record?.kind === 'api-key' && typeof record.key === 'string' ? record.key : undefined
    },
    async status() {
      const result = {}
      for (const provider of TTS_PROVIDERS) {
        try {
          const info = await service().describeRecord(keyOf(provider))
          result[provider] = info?.configured === true
        } catch {
          result[provider] = false
        }
      }
      return result
    },
    async write(provider, value) {
      const key = String(value ?? '').trim()
      if (!/^[\x21-\x7E]{8,1024}$/u.test(key)) throw new TutorError('bad-key', 'The key looks wrong (8–1024 printable characters, no spaces)')
      await service().modifyRecord(keyOf(provider), async () => ({ kind: 'api-key', key }))
    },
    async remove(provider) {
      await service().deleteRecord(keyOf(provider))
    },
  }
}

export function createSettingsService({ prefs, keys, llmPort }) {
  return {
    async get() {
      const value = prefs.read()
      let keyStatus = {}
      try {
        keyStatus = await keys.status()
      } catch {
        keyStatus = {}
      }
      return { ...value, keys: keyStatus, fields: PROVIDER_FIELDS, images: { teach: llmPort.supportsImages('teach'), quick: llmPort.supportsImages('quick') } }
    },
    async save(patch) {
      await prefs.save(patch)
      llmPort.refreshCapabilities().catch(() => undefined)
      return this.get()
    },
    async setKey({ provider, key }) {
      await keys.write(provider, key)
      return this.get()
    },
    async clearKey({ provider }) {
      await keys.remove(provider)
      return this.get()
    },
    models: () => llmPort.listModels(),
  }
}
