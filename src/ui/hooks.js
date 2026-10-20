// Small React helpers shared by every screen.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export const AppContext = createContext(null)

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppContext missing')
  return value
}

// Load data from the host; reload() refetches. Ignores stale responses.
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, value: undefined })
  const generation = useRef(0)
  const reload = useCallback(() => {
    const current = ++generation.current
    setState(previous => ({ ...previous, loading: true, error: null }))
    Promise.resolve()
      .then(loader)
      .then(value => { if (generation.current === current) setState({ loading: false, error: null, value }) })
      .catch(error => { if (generation.current === current) setState(previous => ({ loading: false, error, value: previous.value })) })
  }, deps)
  useEffect(() => {
    reload()
    return () => { generation.current += 1 }
  }, [reload])
  return { ...state, reload, setValue: value => setState(previous => ({ ...previous, value: typeof value === 'function' ? value(previous.value) : value })) }
}

// Run a host job with progress. Leaving the screen only stops watching it
// (the host finishes and saves the work); cancel() stops the job itself.
export function useJob() {
  const { api } = useApp()
  const [state, setState] = useState({ running: false, progress: null, preview: null, error: null })
  const controller = useRef(null)
  const jobId = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  const run = useCallback(async (endpoint, payload, { onPartial, existing } = {}) => {
    controller.current?.abort()
    const local = new AbortController()
    controller.current = local
    jobId.current = existing?.id ?? null
    setState({ running: true, progress: null, preview: null, error: null })
    try {
      const options = {
        signal: local.signal,
        onPartial,
        onProgress: progress => { if (!local.signal.aborted) setState(previous => ({ ...previous, progress })) },
        onPreview: preview => { if (!local.signal.aborted) setState(previous => ({ ...previous, preview })) },
      }
      // `existing` resumes a job that is already running on the host.
      const first = existing ? { job: existing } : await api.call(endpoint, payload)
      if (first?.job?.id && !local.signal.aborted) jobId.current = first.job.id
      const result = await api.follow(first, options)
      if (!local.signal.aborted) setState({ running: false, progress: null, preview: null, error: null })
      return result
    } catch (error) {
      if (!local.signal.aborted) setState({ running: false, progress: null, preview: null, error })
      throw error
    }
  }, [api])
  const cancel = useCallback(() => {
    controller.current?.abort()
    if (jobId.current) api.cancel(jobId.current)
    jobId.current = null
    setState({ running: false, progress: null, preview: null, error: null })
  }, [api])
  return { ...state, run, cancel }
}

// True exactly once per token, even across remounts of the same route:
// screens use it to auto-start work handed over by another screen.
export function useOnce(token) {
  const [first] = useState(() => {
    if (!token) return false
    const key = `aha-tutor:once:${token}`
    try {
      if (window.sessionStorage.getItem(key)) return false
      window.sessionStorage.setItem(key, '1')
    } catch {
      // without storage, run once per mount
    }
    return true
  })
  return first
}

// True once `active` has stayed true for `ms`, and false again as soon as it
// is not: for showing something only when a wait goes on.
export function useLasting(active, ms) {
  const [lasted, setLasted] = useState(false)
  useEffect(() => {
    setLasted(false)
    if (!active) return undefined
    const timer = setTimeout(() => setLasted(true), ms)
    return () => clearTimeout(timer)
  }, [active, ms])
  return active && lasted
}

export function usePersistentState(key, initial) {
  const storageKey = `aha-tutor:${key}`
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // storage unavailable
    }
  }, [storageKey, value])
  return [value, setValue]
}

export function useDarkMode() {
  // DSH marks its dark theme with body[data-ds-dark-theme].
  const read = () => {
    if (document.body?.hasAttribute('data-ds-dark-theme')) return true
    const scheme = getComputedStyle(document.documentElement).colorScheme
    if (/dark/iu.test(scheme) && !/light/iu.test(scheme)) return true
    if (document.body) return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const update = () => setDark(read())
    media?.addEventListener?.('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-ds-theme-source'] })
    return () => {
      media?.removeEventListener?.('change', update)
      observer.disconnect()
    }
  }, [])
  return dark
}
