import { useState } from 'react'

import { Empty, ErrorLine, MaterialPicker, Spinner, StudyJobLine } from '../components.jsx'
import { useApp, useJob, useLoad } from '../hooks.js'

const TOOLS = [['sheet', 'makeSheet', 'studio/sheet'], ['cards', 'makeCards', 'studio/cards'], ['notes', 'makeNotes', 'studio/notes'], ['quiz', 'makeQuiz', 'studio/quiz']]

export function StudioScreen() {
  const { api, t, navigate } = useApp()
  const sheets = useLoad(() => api.call('items/list', { kind: 'sheets' }), [])
  const decks = useLoad(() => api.call('items/list', { kind: 'decks' }), [])
  const [materialIds, setMaterialIds] = useState([])
  const [picking, setPicking] = useState(false)
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const job = useJob()

  async function make(kind, endpoint) {
    if (!materialIds.length) {
      setPicking(true)
      return
    }
    setBusy(kind)
    setError(null)
    try {
      const result = await job.run(endpoint, { materialIds, focus })
      openItem(result.item)
    } catch (failure) {
      if (failure?.code !== 'cancelled') setError(failure)
    } finally {
      setBusy(null)
    }
  }

  function openItem(item) {
    if (item.kind === 'cheatsheet') navigate('sheet', { sheetId: item.id })
    else if (item.kind === 'notes') navigate('item', { kind: 'notes', id: item.id })
    else if (item.kind === 'cards') navigate('cards', { deckId: item.id })
    else navigate('item', { kind: 'quiz', id: item.id })
  }

  async function remove(kind, id) {
    await api.call('items/remove', { kind, id })
    if (kind === 'sheets') sheets.reload()
    else decks.reload()
  }

  const section = (title, list, kind) => <section className="aha-col">
    <h3 className="aha-cardTitle">{title}</h3>
    {list.loading && !list.value ? <Spinner /> : (list.value ?? []).length ? <div className="aha-grid">
      {list.value.map(item => <div key={item.id} className="aha-card" data-click="true" onClick={() => openItem(item)}>
        <span className="aha-tag">{item.kind === 'cheatsheet' ? t('sheets') : item.kind === 'notes' ? t('notes') : item.kind === 'cards' ? t('decks') : t('quizzes')}</span>
        <b>{item.title}</b>
        <div className="aha-spread"><span className="aha-hint">{new Date(item.updatedAt).toLocaleDateString()}</span><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={event => { event.stopPropagation(); remove(kind, item.id) }}>{t('delete')}</button></div>
      </div>)}
    </div> : <Empty>{t('empty')}</Empty>}
  </section>

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}><h2 className="aha-title">{t('studioTitle')}</h2><p className="aha-hint">{t('studioHint')}</p></div>
    <section className="aha-card">
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={() => setPicking(true)}>{materialIds.length ? t('attached', { count: materialIds.length }) : t('pickMaterials')}</button>
        <input className="aha-input" style={{ flex: 1, minWidth: 220 }} value={focus} placeholder={t('focusPlaceholder')} onChange={event => setFocus(event.currentTarget.value)} />
      </div>
      <div className="aha-row">{TOOLS.map(([kind, label, endpoint]) => <button key={kind} type="button" className="aha-btn" data-kind="primary" disabled={Boolean(busy)} onClick={() => make(kind, endpoint)}>{busy === kind ? <span className="aha-spinner" /> : null}{t(label)}</button>)}</div>
      {busy ? <StudyJobLine kind={busy} job={job} /> : null}
      <ErrorLine error={error} />
    </section>
    {section(`${t('sheets')} · ${t('notes')}`, sheets, 'sheets')}
    {section(`${t('decks')} · ${t('quizzes')}`, decks, 'decks')}
    {picking ? <MaterialPicker selected={materialIds} onChange={setMaterialIds} onClose={() => setPicking(false)} /> : null}
  </div>
}
