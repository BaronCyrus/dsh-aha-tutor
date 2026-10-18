// The plugin's model port on top of DSH's LLM runtime. Each call picks a
// route by purpose — 'teach' (course design, lessons, materials) or 'quick'
// (grading, in-class questions, notes) — from the plugin preferences, falling
// back to the DSH default model. Direct calls are single attempts in DSH, so
// transient failures are retried here (only before any text was streamed).

import { TutorError } from './generate.js'

const RETRYABLE = new Set(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'])
const CALL_TIMEOUT_MS = 6 * 60_000
const MAX_RETRIES = 2

const USER_ERRORS = Object.freeze({
  AUTH: ['llm-auth', 'The model rejected the sign-in or key. Check the model provider in DSH settings.'],
  MISSING_CREDENTIAL: ['llm-auth', 'The selected model provider is not signed in. Set it up in DSH settings.'],
  INVALID_CREDENTIAL: ['llm-auth', 'The model provider key is invalid. Check it in DSH settings.'],
  ACCOUNT_SIGN_IN_REQUIRED: ['llm-auth', 'Sign in to the model provider in DSH first.'],
  RATE_LIMIT: ['llm-quota', 'The model is rate limiting requests. Wait a moment and try again.'],
  QUOTA: ['llm-quota', 'The model quota is used up.'],
  ACCOUNT_QUOTA: ['llm-quota', 'The model account quota is used up.'],
  CONTEXT_WINDOW_EXCEEDED: ['llm-context', 'The material is too long for this model. Pick fewer materials or a model with a larger context.'],
  NO_ADAPTER: ['llm-unavailable', 'The selected model is not available. Pick another model in Aha settings.'],
  TIMEOUT: ['llm-timeout', 'The model took too long to respond. Try again.'],
  ABORTED: ['cancelled', 'Cancelled'],
})

function toTutorError(code, fallback) {
  const known = USER_ERRORS[code]
  if (known) return new TutorError(known[0], known[1])
  return new TutorError('llm-failed', `The model call failed${code ? ` (${code})` : ''}${fallback ? `: ${fallback}` : ''}`)
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')) }, { once: true })
})

// getLlm(): DSH llm service; getDefault(): { provider, model } | undefined;
// getAttachments(): attachments service (for images); prefs.read(): routes.
export function createLlmPort({ getLlm, getDefault, getAttachments, prefs, logger }) {
  function route(purpose) {
    const settings = prefs.read()
    const provider = purpose === 'quick' ? settings.quickProvider : settings.teachProvider
    const model = purpose === 'quick' ? settings.quickModel : settings.teachModel
    if (provider && model) return { provider, model }
    if (purpose === 'quick' && settings.teachProvider && settings.teachModel) return { provider: settings.teachProvider, model: settings.teachModel }
    const selection = getDefault()
    if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
    throw new TutorError('llm-unavailable', 'No model is configured in DSH yet.')
  }

  async function modalities(purpose, signal) {
    const llm = getLlm()
    const target = route(purpose)
    try {
      const info = await llm.resolveModelInfo(target.provider, target.model, signal)
      return info?.inputModalities ?? null
    } catch {
      return null
    }
  }

  async function content(user, images, prepared) {
    const blocks = [{ type: 'text', text: String(user ?? '') }]
    if (!images?.length || prepared.inputModalities?.includes('image') !== true) return blocks
    const attachments = getAttachments()
    if (typeof attachments?.saveImage !== 'function') return blocks
    for (const [index, image] of images.slice(0, 4).entries()) {
      try {
        const ref = await attachments.saveImage({ data: Buffer.from(image.base64, 'base64'), mediaType: image.mime, name: `material-${index + 1}.${image.mime.split('/')[1] ?? 'png'}` })
        blocks.push({ type: 'image', attachment: ref })
      } catch (error) {
        logger?.debug?.('aha-tutor could not attach an image: %s', error?.message)
      }
    }
    return blocks
  }

  async function attempt({ purpose, system, user, images, maxTokens, signal, onText }) {
    const llm = getLlm()
    if (!llm) throw new TutorError('llm-unavailable', 'DSH has no model service in this profile.')
    const target = route(purpose)
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
    const fused = signal ? AbortSignal.any([signal, timeout]) : timeout
    let prepared
    try {
      prepared = await llm.prepareCall({ ...target, maxTokens }, fused, purpose === 'quick'
        ? (controls, model) => {
            const lowest = model?.reasoning?.efforts?.[0]
            return lowest ? { ...controls, reasoningEffort: lowest.id } : controls
          }
        : undefined)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      throw Object.assign(toTutorError(error?.code, error?.message), { retryable: false })
    }
    let textValue = ''
    let finish = null
    const messages = [{ role: 'user', content: await content(user, images, prepared) }]
    try {
      for await (const chunk of prepared.stream({ ...prepared.config, ...(system ? { system } : {}), messages, signal: fused })) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          textValue += chunk.text
          onText?.(chunk.text)
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        }
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      throw Object.assign(toTutorError(timeout.aborted ? 'TIMEOUT' : error?.code, error?.message), { retryable: RETRYABLE.has(error?.code), streamed: textValue.length > 0 })
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      const code = timeout.aborted ? 'TIMEOUT' : finish.kind === 'aborted' ? 'ABORTED' : finish.failure?.code
      throw Object.assign(toTutorError(code, finish.failure?.message), { retryable: RETRYABLE.has(code), retryAfterMs: finish.failure?.providerRetryAfterMs, streamed: textValue.length > 0 })
    }
    if (!textValue.trim()) throw Object.assign(toTutorError('EMPTY_RESPONSE'), { retryable: true, streamed: false })
    return textValue
  }

  async function call(options) {
    let lastError
    for (let tries = 0; tries <= MAX_RETRIES; tries += 1) {
      try {
        return await attempt(options)
      } catch (error) {
        lastError = error
        if (options.signal?.aborted || !error?.retryable || error?.streamed || tries === MAX_RETRIES) throw error
        await sleep(Math.min(20_000, Number(error.retryAfterMs) || 1500 * (tries + 1)), options.signal)
      }
    }
    throw lastError
  }

  return Object.freeze({
    complete: options => call({ ...options, onText: undefined }),
    stream: options => call(options),
    route,
    // Synchronous answer used by prompt builders; refreshed by refreshCapabilities.
    supportsImages: purpose => capabilities[purpose] === true,
    async refreshCapabilities(signal) {
      for (const purpose of ['teach', 'quick']) {
        try {
          capabilities[purpose] = (await modalities(purpose, signal))?.includes('image') === true
        } catch {
          capabilities[purpose] = false
        }
      }
      return { ...capabilities }
    },
    async listModels(signal) {
      const llm = getLlm()
      if (!llm) return []
      const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
      const rows = []
      for (const provider of providers) {
        try {
          const models = await llm.listModels(provider.id)
          for (const model of models) rows.push({ provider: provider.id, providerName: provider.name ?? provider.id, model: model.id, name: model.name ?? model.id, images: model.inputModalities?.includes('image') === true })
        } catch {
          // provider not signed in
        }
        signal?.throwIfAborted()
      }
      return rows
    },
  })
}

const capabilities = { teach: false, quick: false }
