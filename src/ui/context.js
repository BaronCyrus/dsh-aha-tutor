// Builds the AppContext value shared by the full page, the side-panel board
// and the conversation cards.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApi } from './api.js'
import { usePersistentState } from './hooks.js'
import { createSpeech } from './speech.js'

export const ROUTE_EVENT = 'aha-tutor:navigate'
export const ROUTE_KEY = 'aha-tutor:route'

export function useAppValue({ rpc, t, language, dsh, navigate = () => undefined, back = () => undefined }) {
  const api = useMemo(() => createApi(rpc), [rpc])
  const speech = useMemo(() => createSpeech({ fetchAudio: text => fetchSpeech(api, text) }), [api])
  useEffect(() => () => speech.dispose(), [speech])
  const [hostSettings, setHostSettings] = useState({})
  const [voiceId, setVoiceId] = usePersistentState('voice', '')
  const [toastText, setToastText] = useState(null)
  const toastTimer = useRef(null)
  const toast = useCallback(message => {
    setToastText(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastText(null), 3600)
  }, [])
  const reloadSettings = useCallback(() => api.call('settings/get').then(setHostSettings).catch(() => undefined), [api])
  useEffect(() => {
    reloadSettings()
    api.call('app/info', { language }).catch(() => undefined)
  }, [reloadSettings, language])
  const settings = useMemo(() => ({ ...hostSettings, voiceId }), [hostSettings, voiceId])
  const value = useMemo(() => ({ api, t, language, speech, settings, setVoiceId, reloadSettings, navigate, back, toast, dsh }), [api, t, language, speech, settings, setVoiceId, reloadSettings, navigate, back, toast, dsh])
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
      let message = 'tts failed'
      try {
        message = (await response.json())?.error?.message ?? message
      } catch {
        // not JSON
      }
      throw new Error(message)
    }
  } catch (error) {
    if (error?.message && error.message !== 'Failed to fetch') throw error
  }
  const result = await api.call('tts/speak', { text })
  return { base64: result.base64, mime: result.mime }
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
