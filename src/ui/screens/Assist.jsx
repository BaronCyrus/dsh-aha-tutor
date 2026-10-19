import { useEffect, useState } from 'react'

import { Classroom } from '../Classroom.jsx'
import { ErrorLine, MaterialPicker, Spinner } from '../components.jsx'
import { useApp, useLoad, useOnce } from '../hooks.js'
import { newId } from '../../core/ids.js'

const MODES = [['explain', 'modeExplain', '💡'], ['solve', 'modeSolve', '🧮'], ['visualize', 'modeVisualize', '📈']]

export function AssistScreen({ draftMode, draftRequest, draftMaterials, token }) {
  const { api, t } = useApp()
  const history = useLoad(() => api.call('items/list', { kind: 'assist' }), [])
  const [mode, setMode] = useState(MODES.some(([value]) => value === draftMode) ? draftMode : 'explain')
  const [request, setRequest] = useState(draftRequest ?? '')
  const [materialIds, setMaterialIds] = useState(Array.isArray(draftMaterials) ? draftMaterials : [])
  const [picking, setPicking] = useState(false)
  const [session, setSession] = useState(null)
  const [error, setError] = useState(null)
  const autostart = useOnce(token)

  async function send(text = request) {
    const ask = text.trim()
    if (!ask) return
    setError(null)
    const threadId = session?.threadId ?? newId('thd')
    // Asking again while the previous answer is still being written replaces it.
    if (session?.stream && !session.done) api.cancel(session.stream)
    try {
      const { job } = await api.call('assist/ask', { mode, request: ask, materialIds, threadId: session?.threadId, newThreadId: session?.threadId ? undefined : threadId })
      setSession(current => ({ threadId, turn: current ? current.turn + 1 : 0, stream: job, done: false, steps: [], title: ask.slice(0, 80), language: undefined, key: `${threadId}:${Date.now()}` }))
      setRequest('')
    } catch (failure) {
      setError(failure)
    }
  }

  useEffect(() => {
    if (autostart && draftRequest) send(draftRequest)
  }, [])

  async function openThread(id) {
    setError(null)
    try {
      const { item } = await api.call('items/get', { kind: 'assist', id })
      const turn = item.turns.length - 1
      setSession({ threadId: item.id, turn, stream: null, steps: item.turns[turn]?.board?.steps ?? [], title: item.turns[turn]?.request ?? item.title, language: item.language, key: `${item.id}:${turn}:open` })
    } catch (failure) {
      setError(failure)
    }
  }

  return <div className="aha-page" data-wide="true">
    <div className="aha-split">
      <div className="aha-col" style={{ minHeight: 0 }}>
        {session ? <Classroom key={session.key} scope={{ kind: 'thread', id: session.threadId, turn: session.turn }} title={session.title} steps={session.steps} stream={session.stream} language={session.language} recordChecks={false} onStreamDone={result => {
          setSession(current => (current?.stream?.id === session.stream?.id ? { ...current, done: true, turn: Number.isInteger(result?.turn) ? result.turn : current.turn } : current))
          history.reload()
        }} /> : <div className="aha-col" style={{ gap: 4 }}>
          <h2 className="aha-title">{t('assistTitle')}</h2>
          <p className="aha-hint">{t('assistHint')}</p>
        </div>}
        <div className="aha-composer">
          <div className="aha-row" style={{ gap: 6 }}>{MODES.map(([value, label, emoji]) => <button key={value} type="button" className="aha-chip" data-active={mode === value} onClick={() => setMode(value)}>{emoji} {t(label)}</button>)}</div>
          <textarea value={request} placeholder={session ? t('followUp') : t('assistPlaceholder')} onChange={event => setRequest(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send() }} />
          <div className="aha-spread">
            <button type="button" className="aha-btn" data-size="sm" onClick={() => setPicking(true)}>{materialIds.length ? t('attached', { count: materialIds.length }) : t('attach')}</button>
            <div className="aha-row">
              {session ? <button type="button" className="aha-btn" data-kind="ghost" onClick={() => setSession(null)}>{t('newThread')}</button> : null}
              <button type="button" className="aha-btn" data-kind="primary" disabled={!request.trim()} onClick={() => send()}>{t('ask')}</button>
            </div>
          </div>
        </div>
        <ErrorLine error={error} />
      </div>
      <aside className="aha-col" style={{ minHeight: 0, overflow: 'auto' }}>
        <h3 className="aha-cardTitle">{t('history')}</h3>
        {history.loading && !history.value ? <Spinner /> : (history.value ?? []).map(item => <button key={item.id} type="button" className="aha-option" onClick={() => openThread(item.id)}>
          <b>{item.title}</b><small>{new Date(item.updatedAt).toLocaleString()}</small>
        </button>)}
      </aside>
    </div>
    {picking ? <MaterialPicker selected={materialIds} onChange={setMaterialIds} onClose={() => setPicking(false)} /> : null}
  </div>
}
