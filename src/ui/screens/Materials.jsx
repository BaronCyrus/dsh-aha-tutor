import { useState } from 'react'

import { Confirm, describeMaterial, Empty, ErrorLine, Spinner, UploadZone } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'

export function MaterialsScreen() {
  const { api, t, navigate, toast } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)

  async function make(kind, material) {
    setBusy(`${kind}:${material.id}`)
    setError(null)
    try {
      if (kind === 'course') {
        const { job } = await api.call('course/start', { goal: material.brief?.suggestedGoal ?? '', materialIds: [material.id] })
        navigate('craft', { jobId: job.id })
        return
      }
      const endpoint = { sheet: 'studio/sheet', cards: 'studio/cards', notes: 'studio/notes', quiz: 'studio/quiz' }[kind]
      const result = await api.run(endpoint, { materialIds: [material.id] })
      toast(t('saved'))
      if (kind === 'sheet') navigate('sheet', { sheetId: result.item.id })
      else if (kind === 'cards') navigate('cards', { deckId: result.item.id })
      else if (kind === 'notes') navigate('item', { kind: 'notes', id: result.item.id })
      else navigate('item', { kind: 'quiz', id: result.item.id })
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(null)
    }
  }

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}>
      <h2 className="aha-title">{t('materialsTitle')}</h2>
      <p className="aha-hint">{t('materialsHint')}</p>
    </div>
    <UploadZone onAdded={() => materials.reload()} />
    <ErrorLine error={error ?? materials.error} />
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : (materials.value ?? []).length ? <div className="aha-col">
      {materials.value.map(material => <div key={material.id} className="aha-card">
        <div className="aha-spread">
          <div className="aha-col" style={{ gap: 2 }}>
            <b>{material.title}</b>
            <span className="aha-hint">{describeMaterial(material, t)}</span>
          </div>
          <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setRemoving(material)}>{t('delete')}</button>
        </div>
        {material.brief?.summary ? <p className="aha-hint">{material.brief.summary}</p> : null}
        {material.brief?.topics?.length ? <div className="aha-row" style={{ gap: 4 }}>{material.brief.topics.slice(0, 10).map(topic => <span key={topic} className="aha-tag">{topic}</span>)}</div> : null}
        {material.kind !== 'image' ? <div className="aha-row" style={{ gap: 6 }}>
          {[['course', 'makeCourse'], ['sheet', 'makeSheet'], ['cards', 'makeCards'], ['notes', 'makeNotes'], ['quiz', 'makeQuiz']].map(([kind, label]) => <button key={kind} type="button" className="aha-btn" data-size="sm" data-kind={kind === 'course' ? 'primary' : undefined} disabled={Boolean(busy)} onClick={() => make(kind, material)}>{busy === `${kind}:${material.id}` ? <span className="aha-spinner" /> : null}{t(label)}</button>)}
          <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('item', { kind: 'digest', materialId: material.id })}>{t('digest')}</button>
        </div> : <p className="aha-hint">{t('imageNeedsVision')}</p>}
      </div>)}
    </div> : <Empty>{t('noMaterials')}</Empty>}
    {removing ? <Confirm danger text={`${t('delete')}「${removing.title}」?`} onCancel={() => setRemoving(null)} onConfirm={async () => { await api.call('material/remove', { id: removing.id }); setRemoving(null); materials.reload() }} /> : null}
  </div>
}
