import { useEffect, useRef, useState } from 'react'

import { Classroom } from '../Classroom.jsx'
import { Confirm, ErrorLine, MaterialPicker, MoreMenu, Spinner, useLibraryIntake } from '../components.jsx'
import { useApp, useLoad, useOnce } from '../hooks.js'
import { PictureChips, pictureUse, TurnPictures, unusableAlone, useFileDrop, usePictureUploads } from '../pictures.jsx'
import { VoiceButton } from '../VoiceButton.jsx'
import { LIMITS } from '../../core/course-model.js'
import { newId } from '../../core/ids.js'
import { isPictureFile, pictureAsk } from '../../core/pictures.js'

const MODES = [['explain', 'modeExplain', '💡'], ['solve', 'modeSolve', '🧮'], ['visualize', 'modeVisualize', '📈']]

// draftPictures: pictures pasted on the home page, asked about at once.
export function AssistScreen({ draftMode, draftRequest, draftMaterials, draftPictures, token }) {
  const { api, t, language } = useApp()
  const history = useLoad(() => api.call('items/list', { kind: 'assist' }), [])
  const [mode, setMode] = useState(MODES.some(([value]) => value === draftMode) ? draftMode : 'explain')
  const [request, setRequest] = useState(draftRequest ?? '')
  const [materialIds, setMaterialIds] = useState(Array.isArray(draftMaterials) ? draftMaterials : [])
  const [picking, setPicking] = useState(false)
  const [session, setSession] = useState(null)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [leftOut, setLeftOut] = useState(0)
  const autostart = useOnce(token)
  const pictures = usePictureUploads(draftPictures)
  // Files that are not pictures go into the library and come along as
  // materials (an upload ends after renders that changed the list).
  const attachedNow = useRef(materialIds)
  attachedNow.current = materialIds
  const intake = useLibraryIntake({
    onAdded: added => {
      const current = attachedNow.current
      const fresh = added.map(item => item.id).filter(id => !current.includes(id))
      const room = Math.max(0, LIMITS.materials - current.length)
      setMaterialIds([...current, ...fresh.slice(0, room)])
      setLeftOut(Math.max(0, fresh.length - room))
    },
  })
  const drop = useFileDrop(({ files, folders }) => {
    const shots = files.filter(file => isPictureFile(file))
    if (shots.length) pictures.add(shots)
    intake.take({ files: files.filter(file => !isPictureFile(file)), folders })
  })

  async function send(text = request, shown = pictures.ready) {
    const ask = text.trim()
    if (!ask && !shown.length) return
    setError(null)
    // Pictures alone that the teacher could not take in are not sent.
    const alone = ask ? null : unusableAlone(shown)
    if (alone) {
      setError(alone)
      return
    }
    const threadId = session?.threadId ?? newId('thd')
    // Asking again while the previous answer is still being written replaces it.
    if (session?.stream && !session.done) api.cancel(session.stream)
    try {
      const { job } = await api.call('assist/ask', { mode, request: ask, materialIds, pictureIds: shown.map(picture => picture.id), threadId: session?.threadId, newThreadId: session?.threadId ? undefined : threadId })
      const title = ask || pictureAsk(mode, language)
      setSession(current => ({ threadId, turn: current ? current.turn + 1 : 0, stream: job, done: false, steps: [], title: title.slice(0, 80), language: undefined, key: `${threadId}:${Date.now()}`, pictures: shown.map(picture => ({ id: picture.id, seen: pictureUse(picture) })) }))
      setRequest('')
      pictures.clear()
    } catch (failure) {
      setError(failure)
    }
  }

  useEffect(() => {
    if (autostart && (draftRequest || pictures.ready.length)) send(draftRequest ?? '', pictures.ready)
  }, [])

  async function openThread(id) {
    setError(null)
    try {
      const { item } = await api.call('items/get', { kind: 'assist', id })
      const turn = item.turns.length - 1
      // Opening the thread on screen again keeps its place and only brings it into view.
      setSession({ threadId: item.id, turn, stream: null, steps: item.turns[turn]?.board?.steps ?? [], title: item.turns[turn]?.request ?? item.title, language: item.language, key: `${item.id}:${turn}:open`, opened: Date.now(), pictures: item.turns[turn]?.pictures ?? [] })
    } catch (failure) {
      setError(failure)
    }
  }

  async function removeThread(item) {
    setRemoving(null)
    try {
      await api.call('items/remove', { kind: 'assist', id: item.id })
      if (session?.threadId === item.id) setSession(null)
      history.reload()
    } catch (failure) {
      setError(failure)
    }
  }

  const empty = !request.trim() && !pictures.ready.length
  return <div className="aha-page" data-wide="true">
    <div className="aha-split">
      <div className="aha-col" style={{ minHeight: 0 }}>
        {session ? <>
          {session.pictures?.length ? <TurnPictures key={session.key} pictures={session.pictures} /> : null}
          <Classroom key={session.key} scope={{ kind: 'thread', id: session.threadId, turn: session.turn }} title={session.title} steps={session.steps} stream={session.stream} language={session.language} recordChecks={false} reveal={session.opened} onStreamDone={result => {
            setSession(current => (current?.stream?.id === session.stream?.id ? { ...current, done: true, turn: Number.isInteger(result?.turn) ? result.turn : current.turn, pictures: Array.isArray(result?.pictures) && result.pictures.length ? result.pictures : current.pictures } : current))
            history.reload()
          }} />
        </> : <div className="aha-col" style={{ gap: 4 }}>
          <h2 className="aha-title">{t('assistTitle')}</h2>
          <p className="aha-hint">{t('assistHint')}</p>
        </div>}
        <div className="aha-composer" {...drop.box}>
          <div className="aha-row" style={{ gap: 6 }}>{MODES.map(([value, label, emoji]) => <button key={value} type="button" className="aha-chip" data-active={mode === value} onClick={() => setMode(value)}>{emoji} {t(label)}</button>)}</div>
          <textarea value={request} placeholder={session ? t('followUp') : t('assistPlaceholder')} onChange={event => setRequest(event.currentTarget.value)} onPaste={drop.paste} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !pictures.busy) send() }} />
          <PictureChips uploads={pictures} />
          <div className="aha-spread">
            <button type="button" className="aha-btn" data-size="sm" onClick={() => setPicking(true)}>{materialIds.length ? t('attached', { count: materialIds.length }) : t('attach')}</button>
            <div className="aha-row">
              {session ? <button type="button" className="aha-btn" data-kind="ghost" onClick={() => setSession(null)}>{t('newThread')}</button> : null}
              <VoiceButton onText={text => setRequest(current => (current.trim() ? `${current.trimEnd()} ${text}` : text))} />
              <button type="button" className="aha-btn" data-kind="primary" disabled={empty || pictures.busy} onClick={() => send()}>{t('ask')}</button>
            </div>
          </div>
          {drop.box['data-over'] ? <div className="aha-dropCover" aria-hidden="true">{t('dropToAttach')}</div> : null}
        </div>
        {intake.status}
        {leftOut ? <p className="aha-hint" role="status">{t('pickLeftOut', { count: leftOut, max: LIMITS.materials })}</p> : null}
        <ErrorLine error={error} />
      </div>
      <aside className="aha-col" style={{ minHeight: 0, overflow: 'auto' }}>
        <h3 className="aha-cardTitle">{t('history')}</h3>
        {history.loading && !history.value ? <Spinner /> : (history.value ?? []).map(item => <div key={item.id} className="aha-historyRow">
          <button type="button" className="aha-option" onClick={() => openThread(item.id)}>
            <b>{item.title}</b><small>{new Date(item.updatedAt).toLocaleString()}</small>
          </button>
          <MoreMenu items={[{ label: t('delete'), danger: true, onSelect: () => setRemoving(item) }]} />
        </div>)}
      </aside>
    </div>
    {picking ? <MaterialPicker selected={materialIds} onChange={setMaterialIds} onClose={() => setPicking(false)} /> : null}
    {removing ? <Confirm danger text={t('threadRemoveConfirm', { title: removing.title })} onConfirm={() => removeThread(removing)} onCancel={() => setRemoving(null)} /> : null}
  </div>
}
