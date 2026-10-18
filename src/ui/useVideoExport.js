// Export any board (a lesson, an explainer short) as a video file.

import { useEffect, useRef, useState } from 'react'

import { downloadBlob } from './api.js'
import { fetchSpeech } from './context.js'
import { useApp, useDarkMode } from './hooks.js'
import { exportVideo, videoSupported } from './video.js'

export function useVideoExport() {
  const { api, t, settings, toast } = useApp()
  const dark = useDarkMode()
  const [state, setState] = useState(null)
  const controller = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function start({ steps, title }) {
    if (!steps?.length || state) return
    if (!videoSupported()) {
      toast(t('exportUnsupported'))
      return
    }
    const local = new AbortController()
    controller.current = local
    setState({ percent: 0 })
    try {
      const theme = settings.boardTheme === 'dark' || (settings.boardTheme !== 'light' && dark) ? 'dark' : 'light'
      const blob = await exportVideo({
        steps,
        title,
        theme,
        watermark: `${t('appName')} · ${t('appTagline')}`,
        fetchAudio: settings.voiceEngine === 'cloud' ? text => fetchSpeech(api, text) : null,
        signal: local.signal,
        onProgress: progress => setState({ percent: Math.round((progress.done / Math.max(1, progress.total)) * 100), phase: progress.phase }),
      })
      downloadBlob(`${String(title || 'aha').replace(/[<>:"/\\|?*]/gu, ' ').slice(0, 60)}.webm`, blob)
    } catch (error) {
      if (!local.signal.aborted) toast(error.message === 'unsupported' ? t('exportUnsupported') : t('errorGeneric', { message: error.message }))
    } finally {
      setState(null)
    }
  }

  return { exporting: state, start, cancel: () => controller.current?.abort(), cloud: settings.voiceEngine === 'cloud' }
}
