import { Fragment, useEffect, useState } from 'react'

import { LIMITS } from '../../core/course-model.js'
import { Confirm, describeMaterial, Empty, ErrorLine, FolderBar, Modal, MoreMenu, OutlineList, PageRef, readingNotes, Spinner, StudyJobLine, UploadZone } from '../components.jsx'
import { ALL, inView, knownView, UNFILED } from '../folders.js'
import { useApp, useJob, useLoad, usePersistentState } from '../hooks.js'

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// The query's words marked in an excerpt.
function Marked({ text, query }) {
  const words = [...new Set(query.split(/\s+/u).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!words.length) return text
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'giu')
  return text.split(pattern).map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>))
}

// A folder's name, new or changed: refused names (one already used) are
// said under the box.
function FolderName({ folder, onDone, onCancel }) {
  const { api, t } = useApp()
  const [name, setName] = useState(folder?.name ?? '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  async function save(event) {
    event?.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = folder ? await api.call('folder/rename', { id: folder.id, name }) : await api.call('folder/create', { name })
      onDone(result.folder)
    } catch (failure) {
      setError(failure)
      setSaving(false)
    }
  }
  return <Modal title={t(folder ? 'folderRenameTitle' : 'folderNewTitle')} onClose={onCancel} width={420} footer={<>
    <button type="button" className="aha-btn" onClick={onCancel}>{t('cancel')}</button>
    <button type="button" className="aha-btn" data-kind="primary" disabled={!name.trim() || saving} onClick={save}>{t('confirm')}</button>
  </>}>
    <form onSubmit={save}>
      <input className="aha-input" style={{ width: '100%' }} autoFocus value={name} maxLength={60} placeholder={t('folderNamePlaceholder')} aria-label={t('folderNamePlaceholder')} onChange={event => setName(event.currentTarget.value)} />
    </form>
    <ErrorLine error={error} />
  </Modal>
}

export function MaterialsScreen() {
  const { api, t, navigate, toast } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const folderList = useLoad(() => api.call('folder/list'), [])
  const folders = folderList.value?.folders ?? []
  // The view last shown (every material, the unfiled ones, or a folder).
  const [savedView, setView] = usePersistentState('library-view', ALL)
  const view = folderList.value ? knownView(savedView, folders) : ALL
  const folder = folders.find(entry => entry.id === view) ?? null
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const job = useJob()
  const [removing, setRemoving] = useState(null)
  const [naming, setNaming] = useState(null)
  const [dropping, setDropping] = useState(null)
  const [tooMany, setTooMany] = useState(null)
  // Typing filters by title and topic; Enter searches the text of everything
  // in the view.
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [flash, setFlash] = useState(null)

  const reload = () => {
    materials.reload()
    folderList.reload()
  }

  function show(next) {
    setView(next)
    setFound(null)
  }

  async function searchText(event) {
    event?.preventDefault()
    const wanted = query.trim()
    if (!wanted) return
    setSearching(true)
    setError(null)
    try {
      const { results } = await api.call('material/search', { query: wanted, ...(view === ALL ? {} : { folder: view }) })
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

  const all = materials.value ?? []
  const inFolder = inView(all, view)
  const wanted = query.trim().toLowerCase()
  const shown = inFolder.filter(material => found || !wanted
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
      const result = await job.run(endpoint, { materialIds: [material.id] })
      toast(t('saved'))
      if (kind === 'sheet') navigate('sheet', { sheetId: result.item.id })
      else if (kind === 'cards') navigate('cards', { deckId: result.item.id })
      else if (kind === 'notes') navigate('item', { kind: 'notes', id: result.item.id })
      else navigate('item', { kind: 'quiz', id: result.item.id })
    } catch (failure) {
      if (failure?.code !== 'cancelled') setError(failure)
    } finally {
      setBusy(null)
    }
  }

  // A course from the whole folder, in its order: at most LIMITS.materials
  // of it, which the learner is told first when it holds more.
  async function folderCourse(confirmed = false) {
    if (inFolder.length > LIMITS.materials && !confirmed) return setTooMany(folder)
    setTooMany(null)
    setBusy('folder-course')
    setError(null)
    try {
      const { job } = await api.call('course/start', { goal: t('folderCourseGoal', { name: folder.name }), materialIds: inFolder.slice(0, LIMITS.materials).map(material => material.id) })
      navigate('craft', { jobId: job.id })
    } catch (failure) {
      setError(failure)
      setBusy(null)
    }
  }

  async function move(material, folderId) {
    setError(null)
    try {
      await api.call('material/move', { id: material.id, folderId })
      const into = folders.find(entry => entry.id === folderId)
      toast(into ? t('movedToFolder', { title: material.title, name: into.name }) : t('movedToUnfiled', { title: material.title }))
      materials.reload()
    } catch (failure) {
      setError(failure)
    }
  }

  async function dropFolder() {
    const target = dropping
    setDropping(null)
    try {
      await api.call('folder/remove', { id: target.id })
      toast(t('folderDeleted', { name: target.name }))
      show(ALL)
      reload()
    } catch (failure) {
      setError(failure)
    }
  }

  const emptyText = folder ? t('folderEmpty') : view === UNFILED && all.length ? t('unfiledEmpty') : all.length ? t('libraryNoTitleMatch') : t('noMaterials')

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}>
      <h2 className="aha-title">{t('materialsTitle')}</h2>
      <p className="aha-hint">{t('materialsHint')}</p>
    </div>
    <UploadZone folderId={folder?.id ?? null} folderName={folder?.name ?? ''} onAdded={(added, { folders: into = [] } = {}) => { reload(); if (into[0]) show(into[0].id) }} />
    {all.length || folders.length ? <FolderBar folders={folders} materials={all} view={view} onChange={show} onCreate={() => setNaming({})} /> : null}
    {folder ? <div className="aha-spread aha-folderHead">
      <div className="aha-row" style={{ gap: 6, minWidth: 0 }}><b className="aha-folderName">{folder.name}</b><span className="aha-hint">{t('folderCount', { count: inFolder.length })}</span></div>
      <div className="aha-row" style={{ gap: 6 }}>
        <button type="button" className="aha-btn" data-size="sm" data-kind="primary" disabled={!inFolder.length || Boolean(busy)} onClick={() => folderCourse()}>{busy === 'folder-course' ? <span className="aha-spinner" /> : null}{t('folderCourse')}</button>
        <MoreMenu items={[{ label: t('folderRename'), onSelect: () => setNaming({ folder }) }, { label: t('folderDelete'), danger: true, onSelect: () => setDropping(folder) }]} />
      </div>
    </div> : null}
    {inFolder.length ? <form className="aha-row aha-librarySearch" onSubmit={searchText} role="search">
      <input className="aha-input" type="search" value={query} placeholder={folder ? t('librarySearchFolder', { name: folder.name }) : t('librarySearch')} aria-label={t('librarySearch')}
        onChange={event => { setQuery(event.currentTarget.value); setFound(null) }} />
      <button type="submit" className="aha-btn" disabled={!query.trim() || searching}>{searching ? <span className="aha-spinner" /> : null}{t('librarySearchText')}</button>
    </form> : null}
    {found ? <section className="aha-card aha-libraryHits" aria-live="polite">
      <div className="aha-spread">
        <b>{found.results.length ? t('libraryFound', { count: found.results.length }) : t('libraryNotFound', { query: found.query })}</b>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => { setFound(null); setQuery('') }}>{t('close')}</button>
      </div>
      {found.results.map((hit, index) => <button key={index} type="button" className="aha-libraryHit" onClick={() => setFlash(hit.materialId)}>
        <span className="aha-libraryHitWhere"><b>{hit.title}</b>{hit.page ? <> · <PageRef page={hit.page} label={hit.label ?? undefined} /></> : hit.slide ? ` · ${t('slideN', { slide: hit.slide })}` : ''}</span>
        <span className="aha-libraryHitText"><Marked text={hit.snippet} query={found.query} /></span>
      </button>)}
    </section> : null}
    <ErrorLine error={error ?? materials.error ?? folderList.error} />
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : shown.length ? <div className="aha-col">
      {shown.map(material => <div key={material.id} className="aha-card" data-material={material.id} data-flash={flash === material.id ? 'true' : undefined}>
        <div className="aha-spread" style={{ alignItems: 'flex-start' }}>
          <div className="aha-col" style={{ gap: 2, flex: 1, minWidth: 'min(220px, 100%)' }}>
            <b>{material.title}</b>
            <span className="aha-hint">{describeMaterial(material, t)}</span>
          </div>
          <div className="aha-row" style={{ gap: 6 }}>
            {folders.length ? <select className="aha-select aha-moveFolder" value={material.folderId ?? ''} aria-label={t('moveToFolder')} title={t('moveToFolder')} onChange={event => move(material, event.currentTarget.value || null)}>
              <option value="">{t('foldersUnfiled')}</option>
              {folders.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select> : null}
            <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setRemoving(material)}>{t('delete')}</button>
          </div>
        </div>
        {readingNotes(material, t).map(note => <p key={note} className="aha-hint aha-readingNote">{note}</p>)}
        {material.brief?.summary ? <p className="aha-hint">{material.brief.summary}</p> : null}
        {material.brief?.topics?.length ? <div className="aha-row" style={{ gap: 4 }}>{material.brief.topics.slice(0, 10).map(topic => <span key={topic} className="aha-tag" data-clip title={topic}>{topic}</span>)}</div> : null}
        <OutlineList material={material} />
        {material.kind !== 'image' || material.chars > 0 ? <div className="aha-row" style={{ gap: 6 }}>
          {[['course', 'makeCourse'], ['sheet', 'makeSheet'], ['cards', 'makeCards'], ['notes', 'makeNotes'], ['quiz', 'makeQuiz']].map(([kind, label]) => <button key={kind} type="button" className="aha-btn" data-size="sm" data-kind={kind === 'course' ? 'primary' : undefined} disabled={Boolean(busy)} onClick={() => make(kind, material)}>{busy === `${kind}:${material.id}` ? <span className="aha-spinner" /> : null}{t(label)}</button>)}
          <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('item', { kind: 'digest', materialId: material.id })}>{t('digest')}</button>
        </div> : <p className="aha-hint">{t('imageNeedsVision')}</p>}
        {busy?.endsWith(`:${material.id}`) && !busy.startsWith('course:') ? <StudyJobLine kind={busy.split(':')[0]} job={job} /> : null}
      </div>)}
    </div> : <Empty>{emptyText}</Empty>}
    {removing ? <Confirm danger text={`${t('delete')}「${removing.title}」?`} onCancel={() => setRemoving(null)} onConfirm={async () => { await api.call('material/remove', { id: removing.id }); setRemoving(null); materials.reload() }} /> : null}
    {naming ? <FolderName folder={naming.folder} onCancel={() => setNaming(null)} onDone={made => { setNaming(null); folderList.reload(); if (!naming.folder) show(made.id) }} /> : null}
    {dropping ? <Confirm danger text={t('folderDeleteConfirm', { name: dropping.name, count: inView(all, dropping.id).length })} onCancel={() => setDropping(null)} onConfirm={dropFolder} /> : null}
    {tooMany ? <Confirm text={t('folderCourseTooMany', { count: inFolder.length, max: LIMITS.materials })} onCancel={() => setTooMany(null)} onConfirm={() => folderCourse(true)} /> : null}
  </div>
}
