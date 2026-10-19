// Long generations (blueprints, practice, lesson boards) run as jobs the
// browser polls: DSH has no host→browser push for third-party plugins.
// A job exposes progress, partial results (lesson steps stream in as they
// are written), and can be cancelled. Finished jobs are kept briefly so a
// late poll still gets the outcome.

import { newId } from '../core/ids.js'

const KEEP_FINISHED_MS = 10 * 60_000
const MAX_JOBS = 200

export function createJobs({ logger, now = Date.now } = {}) {
  const jobs = new Map()
  const byKey = new Map()

  function sweep() {
    const cutoff = now() - KEEP_FINISHED_MS
    for (const [id, job] of jobs) {
      if (job.finishedAt && job.finishedAt < cutoff) {
        jobs.delete(id)
        if (job.key && byKey.get(job.key) === id) byKey.delete(job.key)
      }
    }
    if (jobs.size > MAX_JOBS) {
      const finished = [...jobs.values()].filter(job => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt)
      for (const job of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id)
    }
  }

  // `key` deduplicates: starting the same work twice returns the running job
  // (unless that job was just cancelled and is still winding down).
  function start(kind, run, { key, meta } = {}) {
    sweep()
    if (key && byKey.has(key)) {
      const existing = jobs.get(byKey.get(key))
      if (existing && !existing.finishedAt && !existing.controller.signal.aborted) return snapshot(existing)
    }
    const controller = new AbortController()
    const job = {
      id: newId('job'),
      kind,
      key: key ?? null,
      meta: meta ?? {},
      status: 'running',
      progress: { done: 0, total: 0, label: '' },
      partial: [],
      result: undefined,
      error: undefined,
      startedAt: now(),
      finishedAt: null,
      controller,
    }
    jobs.set(job.id, job)
    if (key) byKey.set(key, job.id)

    const api = {
      signal: controller.signal,
      progress(done, total, label = job.progress.label) {
        job.progress = { done, total, label }
      },
      push(item) {
        job.partial.push(item)
      },
    }
    // Cancelling settles the job at once, even if the work has not reached a
    // point where it checks the signal yet.
    const aborted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('cancelled')), { once: true })
    })
    Promise.race([Promise.resolve().then(() => run(api)), aborted])
      .then(result => {
        job.status = 'done'
        job.result = result
      })
      .catch(error => {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed'
        job.error = controller.signal.aborted ? { code: 'cancelled', message: 'Cancelled' } : { code: error?.code ?? 'failed', message: publicMessage(error) }
        if (job.status === 'failed') logger?.warn?.('aha-tutor job %s failed: %s', kind, error?.message)
      })
      .finally(() => {
        job.finishedAt = now()
      })
    return snapshot(job)
  }

  function snapshot(job, { since = 0 } = {}) {
    return {
      id: job.id,
      kind: job.kind,
      meta: job.meta,
      status: job.status,
      progress: job.progress,
      partial: job.partial.slice(since),
      partialCount: job.partial.length,
      result: job.status === 'done' ? job.result : undefined,
      error: job.error,
    }
  }

  function get(id, options) {
    const job = jobs.get(id)
    return job ? snapshot(job, options) : null
  }

  function cancel(id) {
    const job = jobs.get(id)
    if (job && !job.finishedAt) job.controller.abort(new Error('cancelled'))
    return job ? snapshot(job) : null
  }

  function running(key) {
    const id = byKey.get(key)
    const job = id ? jobs.get(id) : undefined
    return job && !job.finishedAt && !job.controller.signal.aborted ? snapshot(job) : null
  }

  // Cancel the job running under `key`, if any (regenerating replaces it).
  function cancelKey(key) {
    const job = running(key)
    return job ? cancel(job.id) : null
  }

  function dispose() {
    for (const job of jobs.values()) if (!job.finishedAt) job.controller.abort(new Error('plugin stopped'))
    jobs.clear()
    byKey.clear()
  }

  return Object.freeze({ start, get, cancel, cancelKey, running, dispose })
}

// Only messages written for users cross to the browser.
export function publicMessage(error) {
  if (error?.userMessage) return String(error.userMessage)
  if (['MaterialError', 'TtsError', 'TutorError'].includes(error?.name)) return String(error.message)
  return 'Generation failed'
}
