// Browser side of the RPC channel, plus job polling: long generations return
// a job; we poll it (DSH has no push for plugins) and hand over streamed
// partial results — lesson steps — as soon as they exist.

export const CHANNEL = '/aha-tutor'
const POLL_MS = 650

export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export function createApi(rpc) {
  async function call(endpoint, payload = {}) {
    let response
    try {
      response = await rpc.call(CHANNEL, endpoint, payload ?? {})
    } catch (error) {
      throw new ApiError('network', error?.message || 'Connection to DSH failed')
    }
    if (!response?.ok) throw new ApiError(response?.error?.code ?? 'failed', response?.error?.message ?? 'Request failed')
    return response.value
  }

  // Accepts either a finished value or { job }. Resolves with the job result.
  async function follow(valueOrJob, { onPartial, onProgress, signal } = {}) {
    const job = valueOrJob?.job
    if (!job) return valueOrJob
    let since = 0
    let current = job
    for (;;) {
      if (current.partial?.length) {
        onPartial?.(current.partial, since)
        since += current.partial.length
      }
      if (current.progress) onProgress?.(current.progress)
      if (current.status === 'done') return current.result
      if (current.status === 'failed' || current.status === 'cancelled') throw new ApiError(current.error?.code ?? current.status, current.error?.message ?? current.status)
      if (current.status === 'missing') throw new ApiError('missing', 'The task was lost; try again')
      if (signal?.aborted) {
        call('job/cancel', { id: job.id }).catch(() => undefined)
        throw new ApiError('cancelled', 'cancelled')
      }
      await new Promise(resolve => { setTimeout(resolve, POLL_MS) })
      current = await call('job/get', { id: job.id, since })
    }
  }

  async function run(endpoint, payload, options) {
    return follow(await call(endpoint, payload), options)
  }

  return { call, follow, run }
}

// Read a File as base64 without blowing the stack on large inputs.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function downloadText(fileName, textValue, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([textValue], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
