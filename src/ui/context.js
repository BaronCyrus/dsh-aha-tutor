// Builds the AppContext value shared by the full page, the side-panel board
// and the conversation cards.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, createApi } from './api.js'
import { usePersistentState } from './hooks.js'
import { cloudVoiceOf, createSpeech } from './speech.js'

export const ROUTE_EVENT = 'aha-tutor:navigate'
export const ROUTE_KEY = 'aha-tutor:route'
// Settings changed in one view reach the other open views: a side-panel
// board or conversation cards, and the plugin in other DSH windows of this
// browser. A message { voiceId } carries a new system voice, which lives in
// the browser only; any other message means "read the settings again".
export const SETTINGS_CHANNEL = 'aha-tutor:settings'

export function useAppValue({ rpc, t, language, dsh, navigate = () => undefined, back = () => undefined }) {
  const api = useMemo(() => createApi(rpc), [rpc])
  const speech = useMemo(() => createSpeech({ fetchAudio: text => fetchSpeech(api, text) }), [api])
  useEffect(() => () => speech.dispose(), [speech])
  const [hostSettings, setHostSettings] = useState({})
  const [voiceId, keepVoiceId] = usePersistentState('voice', '')
  const channel = useRef(null)
  const [toastText, setToastText] = useState(null)
  const toastTimer = useRef(null)
  const toast = useCallback(message => {
    setToastText(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastText(null), 3600)
  }, [])
  // Speech learns the cloud voice before the page re-renders, so speaking
  // right after a save (Settings' Test) already uses the new voice.
  const reloadSettings = useCallback(() => api.call('settings/get').then(value => {
    speech.configure({ cloudVoice: cloudVoiceOf(value) })
    setHostSettings(value)
  }).catch(() => undefined), [api, speech])
  // A channel never hears its own messages, so each view hears the others.
  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return undefined
    const open = new BroadcastChannel(SETTINGS_CHANNEL)
    open.onmessage = event => {
      if (typeof event.data?.voiceId === 'string') keepVoiceId(event.data.voiceId)
      else reloadSettings()
    }
    channel.current = open
    return () => {
      open.close()
      if (channel.current === open) channel.current = null
    }
  }, [reloadSettings, keepVoiceId])
  // After a save in this view: read the settings again, then tell the others.
  const settingsSaved = useCallback(async () => {
    await reloadSettings()
    channel.current?.postMessage({})
  }, [reloadSettings])
  const setVoiceId = useCallback(id => {
    keepVoiceId(id)
    channel.current?.postMessage({ voiceId: id })
  }, [keepVoiceId])
  useEffect(() => {
    reloadSettings()
    api.call('app/info', { language }).catch(() => undefined)
  }, [reloadSettings, language])
  const settings = useMemo(() => ({ ...hostSettings, voiceId }), [hostSettings, voiceId])
  const value = useMemo(() => ({ api, t, language, speech, settings, setVoiceId, settingsSaved, navigate, back, toast, dsh }), [api, t, language, speech, settings, setVoiceId, settingsSaved, navigate, back, toast, dsh])
  return { value, toastText }
}

// Cloud audio comes from the host's HTTP route; older hosts without fetch
// routes fall back to base64 over RPC.
export async function fetchSpeech(api, text) {
  try {
    const response = await fetch(new URL('api/aha-tutor/tts', document.baseURI), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (response.ok) return { blob: await response.blob() }
    if (response.status !== 404) {
      let failure = null
      try {
        failure = (await response.json())?.error ?? null
      } catch {
        // not JSON
      }
      throw new ApiError(failure?.code ?? 'tts-failed', failure?.message ?? 'tts failed')
    }
  } catch (error) {
    if (error?.message && error.message !== 'Failed to fetch') throw error
  }
  const result = await api.call('tts/speak', { text })
  return { base64: result.base64, mime: result.mime }
}

// The full page's screen, remembered across visits. crashed() marks the
// route on show when its screen crashes: that route is forgotten, so a reload
// or the next visit opens the home page instead of the crash. Any route set
// later, a retry's copy of the same one included, is remembered again.
export function useRoute() {
  const [route, setRoute] = usePersistentState('route', { screen: 'home', params: {} })
  const [crashedRoute, setCrashedRoute] = useState(null)
  useEffect(() => {
    if (crashedRoute === route) forgetRoute()
  }, [crashedRoute, route])
  const crashed = useCallback(() => setCrashedRoute(route), [route])
  return { route, setRoute, crashed }
}

export function forgetRoute() {
  try {
    window.localStorage.removeItem(ROUTE_KEY)
  } catch {
    // storage unavailable
  }
}

// Ask the full page to show a screen (from a conversation card).
export function openMainScreen(dsh, screen, params = {}) {
  const route = { screen, params }
  try {
    window.localStorage.setItem(ROUTE_KEY, JSON.stringify(route))
  } catch {
    // storage unavailable
  }
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail: route }))
  dsh?.selectPanel?.()
}
