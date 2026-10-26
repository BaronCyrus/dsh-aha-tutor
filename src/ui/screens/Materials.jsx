import { Fragment, useEffect, useState } from 'react'

import { Confirm, describeMaterial, Empty, ErrorLine, readingNotes, Spinner, UploadZone } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// The query's words marked in an excerpt.
function Marked({ text, query }) {
  const words = [...new Set(query.split(/\s+/u).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!words.length) return text
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'giu')
  return text.split(pattern).map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>))
}

export function MaterialsScreen() {
  const { api, t, navigate, toast } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)
  // Typing filters by title and topic; Enter searches the text of everything.
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [flash, setFlash] = useState(null)

  async function searchText(event) {
    event?.preventDefault()
    const wanted = query.trim()
    if (!wanted) return
    setSearching(true)
    setError(null)
    try {
      const { results } = await api.call('material/search', { query: wanted })
      setFound({ query: wanted, results })
    } catch (failure) {
      setError(failure)
    } finally {
      setSearching(false)
    }
  }

  // A passage chosen in the results shows its material, lit for a moment.
  useEffect(() => {
    if (!flash) return undefined
    document.querySelector(`[data-material="${flash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = setTimeout(() => setFlash(null), 1700)
    return () => clearTimeout(timer)
  }, [flash])

  const wanted = query.trim().toLowerCase()
  const shown = (materials.value ?? []).filter(material => found || !wanted
    || material.title.toLowerCase().includes(wanted)
    || (material.brief?.topics ?? []).some(topic => topic.toLowerCase().includes(wanted))
    || (material.brief?.summary ?? '').toLowerCase().includes(wanted))

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
    {(materials.value ?? []).length ? <form className="aha-row aha-librarySearch" onSubmit={searchText} role="search">
      <input className="aha-input" type="search" value={query} placeholder={t('librarySearch')} aria-label={t('librarySearch')}
        onChange={event => { setQuery(event.currentTarget.value); setFound(null) }} />
      <button type="submit" className="aha-btn" disabled={!query.trim() || searching}>{searching ? <span className="aha-spinner" /> : null}{t('librarySearchText')}</button>
    </form> : null}
    {found ? <section className="aha-card aha-libraryHits" aria-live="polite">
      <div className="aha-spread">
        <b>{found.results.length ? t('libraryFound', { count: found.results.length }) : t('libraryNotFound', { query: found.query })}</b>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => { setFound(null); setQuery('') }}>{t('close')}</button>
      </div>
      {found.results.map((hit, index) => <button key={index} type="button" className="aha-libraryHit" onClick={() => setFlash(hit.materialId)}>
        <span className="aha-libraryHitWhere"><b>{hit.title}</b>{hit.page ? ` · ${t('pageN', { page: hit.page })}` : hit.slide ? ` · ${t('slideN', { slide: hit.slide })}` : ''}</span>
        <span className="aha-libraryHitText"><Marked text={hit.snippet} query={found.query} /></span>
      </button>)}
    </section> : null}
    <ErrorLine error={error ?? materials.error} />
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : shown.length ? <div className="aha-col">
      {shown.map(material => <div key={material.id} className="aha-card" data-material={material.id} data-flash={flash === material.id ? 'true' : undefined}>
        <div className="aha-spread">
          <div className="aha-col" style={{ gap: 2 }}>
            <b>{material.title}</b>
            <span className="aha-hint">{describeMaterial(material, t)}</span>
          </div>
          <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setRemoving(material)}>{t('delete')}</button>
        </div>
        {readingNotes(material, t).map(note => <p key={note} className="aha-hint aha-readingNote">{note}</p>)}
        {material.brief?.summary ? <p className="aha-hint">{material.brief.summary}</p> : null}
        {material.brief?.topics?.length ? <div className="aha-row" style={{ gap: 4 }}>{material.brief.topics.slice(0, 10).map(topic => <span key={topic} className="aha-tag">{topic}</span>)}</div> : null}
        {material.kind !== 'image' || material.chars > 0 ? <div className="aha-row" style={{ gap: 6 }}>
          {[['course', 'makeCourse'], ['sheet', 'makeSheet'], ['cards', 'makeCards'], ['notes', 'makeNotes'], ['quiz', 'makeQuiz']].map(([kind, label]) => <button key={kind} type="button" className="aha-btn" data-size="sm" data-kind={kind === 'course' ? 'primary' : undefined} disabled={Boolean(busy)} onClick={() => make(kind, material)}>{busy === `${kind}:${material.id}` ? <span className="aha-spinner" /> : null}{t(label)}</button>)}
          <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('item', { kind: 'digest', materialId: material.id })}>{t('digest')}</button>
        </div> : <p className="aha-hint">{t('imageNeedsVision')}</p>}
      </div>)}
    </div> : <Empty>{(materials.value ?? []).length ? t('libraryNoTitleMatch') : t('noMaterials')}</Empty>}
    {removing ? <Confirm danger text={`${t('delete')}「${removing.title}」?`} onCancel={() => setRemoving(null)} onConfirm={async () => { await api.call('material/remove', { id: removing.id }); setRemoving(null); materials.reload() }} /> : null}
  </div>
}
