// Reading the text in pictures (scanned pages, slides and documents made of
// pictures, photos) with a model the learner chose, when it can see images:
// the quick route first, else the teaching route, never another model. A few
// pictures are read at a time. One that fails is reported with the material;
// a failure every picture would meet (sign-in, quota, a model without
// vision) stops the reading, and the rest are reported with it.

import { RECOGNIZE_EMPTY, recognizePrompt } from './prompts.js'

const AT_ONCE = 3
const STOPS = new Set(['llm-auth', 'llm-quota', 'llm-missing', 'llm-unavailable', 'llm-no-vision'])
// A dense page of formulas runs to a few thousand tokens.
const MAX_TOKENS = 6000

// 'quick' or 'teach', whichever route first reaches a model that sees
// images, or null.
export async function visionPurpose(llm, signal) {
  await llm.refreshCapabilities?.(signal)
  return ['quick', 'teach'].find(purpose => llm.supportsImages?.(purpose)) ?? null
}

// The transcript without fences or the no-text marker.
export function cleanTranscript(value) {
  const text = String(value ?? '').trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/u, '$1')
  return text.replaceAll(RECOGNIZE_EMPTY, '').trim()
}

// recognize(sources) as ingestFile takes it: [{ text } | { error }] for
// [{ where, image() }], or null when no chosen model can see images.
// onProgress(done, total) follows the pictures read.
export function createRecognizer({ llm, signal, onProgress, atOnce = AT_ONCE }) {
  let route = null
  async function read(purpose, image) {
    const prompt = recognizePrompt()
    const answer = await llm.complete({
      purpose,
      effort: 'lowest',
      system: prompt.system,
      user: prompt.user,
      images: [{ mime: image.mime, base64: Buffer.from(image.data).toString('base64') }],
      requireImages: true,
      maxTokens: MAX_TOKENS,
      signal,
    })
    return cleanTranscript(answer)
  }
  return async sources => {
    route ??= visionPurpose(llm, signal)
    const purpose = await route
    if (!purpose) return null
    const results = new Array(sources.length).fill(null)
    let next = 0
    let done = 0
    let stopped = null
    onProgress?.(0, sources.length)
    const worker = async () => {
      while (next < sources.length) {
        const index = next
        next += 1
        signal?.throwIfAborted()
        try {
          if (stopped) throw stopped
          const image = await sources[index].image()
          results[index] = { text: image ? await read(purpose, image) : '' }
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error
          if (STOPS.has(error?.code)) stopped ??= error
          results[index] = { error }
        }
        done += 1
        onProgress?.(done, sources.length)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, sources.length)) }, worker))
    return results
  }
}
