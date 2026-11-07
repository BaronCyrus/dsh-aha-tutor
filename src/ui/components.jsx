import { useEffect, useRef, useState } from 'react'

import { ApiError, fileToBase64 } from './api.js'
import { useApp, useLoad } from './hooks.js'
import { ALL, FOLDER_FILE_LIMIT, foldersFromInput, inView, knownView, planFolder, readDrop, shortList, UNFILED, UPLOAD_ACCEPT, viewCounts } from './folders.js'
import { Icon } from './icons.jsx'
import { LIMITS, shortCourseTitle } from '../core/course-model.js'

export function Spinner({ label }) {
  return <span className="aha-row" style={{ gap: 8 }}><span className="aha-spinner" />{label ? <span className="aha-hint">{label}</span> : null}</span>
}

export function Progress({ value }) {
  return <div className="aha-progress"><div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

// Long generations keep running on the host when the learner leaves, so
// they get a cancel button and a note saying so.
// detail, when given, says how far the job got in place of the bar (a count
// written so far, where the total is only an upper bound).
export function JobProgress({ progress, label, detail, onCancel }) {
  const { t } = useApp()
  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  return <div className="aha-col" style={{ gap: 6 }}>
    <Spinner label={label} />
    {detail ? <span className="aha-hint">{detail}</span> : progress?.total ? <Progress value={percent} /> : null}
    {onCancel ? <div className="aha-row">
      <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onCancel}>{t('cancel')}</button>
      <span className="aha-hint">{t('keepsRunning')}</span>
    </div> : null}
  </div>
}

// A study aid being made from materials (job: useJob()), with Cancel. A deck
// or quiz read in parts says how many parts are done and how many cards or
// questions are written.
export function StudyJobLine({ kind, job }) {
  const { t } = useApp()
  const progress = job.progress
  const count = job.preview?.written ?? 0
  const quiz = kind === 'quiz'
  let label = t('generating')
  if (progress?.label === 'reading' && (quiz || kind === 'cards')) {
    if (progress.total > 1) label = t(quiz ? 'studyPartsQuiz' : 'studyPartsCards', { done: progress.done, total: progress.total, count })
    else if (count) label = t(quiz ? 'quizWriting' : 'cardsWriting', { count })
  }
  return <div className="aha-row" style={{ gap: 8 }}>
    <Spinner label={label} />
    {job.running ? <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={job.cancel}>{t('cancel')}</button> : null}
  </div>
}

export function Modal({ title, onClose, children, footer, width }) {
  return <div className="aha-modalBack" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.() }}>
    <div className="aha-modal" role="dialog" aria-label={title} style={width ? { width: `min(${width}px,100%)` } : undefined}>
      {title ? <div className="aha-spread"><h3 className="aha-cardTitle">{title}</h3><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onClose} aria-label="close">✕</button></div> : null}
      {children}
      {footer ? <div className="aha-row" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
    </div>
  </div>
}

export function Confirm({ text, onConfirm, onCancel, danger = false }) {
  const { t } = useApp()
  return <Modal title={t('confirm')} onClose={onCancel} footer={<>
    <button type="button" className="aha-btn" onClick={onCancel}>{t('cancel')}</button>
    <button type="button" className="aha-btn" data-kind={danger ? 'danger' : 'primary'} onClick={onConfirm}>{t('confirm')}</button>
  </>}><p>{text}</p></Modal>
}

// A ⋯ button with a short list of actions: items [{ label, onSelect,
// danger }]. It closes on a pick, on Escape and on a press outside it, and
// keeps its clicks from reaching a clickable card it sits on.
export function MoreMenu({ items, style }) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const outside = event => { if (!anchor.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <span ref={anchor} className="aha-menuAnchor" style={style} onClick={event => event.stopPropagation()}>
    <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" aria-label={t('moreActions')} title={t('moreActions')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>⋯</button>
    {open ? <div className="aha-card aha-menu" role="menu">
      {items.map(item => <button key={item.label} type="button" role="menuitem" className="aha-btn" data-kind="ghost" data-danger={item.danger ? 'true' : undefined} onClick={() => { setOpen(false); item.onSelect() }}>{item.label}</button>)}
    </div> : null}
  </span>
}

// A course's name for a sentence: a draft is named by its goal, which can
// be long.
export function courseName(course) {
  const name = String(course?.title || course?.goal || '').trim()
  return name.length > 40 ? `${name.slice(0, 40)}…` : name
}

// A host error in the learner's language when its code is known; the raw
// message stays available on hover.
export function errorText(t, error) {
  const code = String(error?.code ?? '').replace(/^aha-tutor\//u, '')
  const key = `err_${code}`
  return code && t(key) !== key ? t(key) : t('errorGeneric', { message: error?.message ?? String(error) })
}

// reveal: a line shown under the control that failed is scrolled into view
// when it appears below the edge of the window.
export function ErrorLine({ error, style, reveal = false }) {
  const { t } = useApp()
  const line = useRef(null)
  useEffect(() => {
    if (reveal && error) line.current?.scrollIntoView?.({ block: 'nearest' })
  }, [reveal, error])
  if (!error) return null
  return <div ref={line} className="aha-error" role="alert" style={style} title={error.message ?? undefined}>{errorText(t, error)}</div>
}

export function Empty({ children }) {
  return <div className="aha-empty">{children}</div>
}

// Upload files / add links; resolves to the new material metas. progress is
// the host job's ({ done, total, label }), and cancel() stops it while it runs:
// reading the text in a long scan takes minutes. folderId: the library
// folder new materials go into (none when null).
export function useMaterialUpload() {
  const { api } = useApp()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [jobId, setJobId] = useState(null)
  // A computer's folder on its way: which library folder, which file of how many.
  const [batch, setBatch] = useState(null)
  async function follow(value) {
    setJobId(value?.job?.id ?? null)
    try {
      return await api.follow(value, { onProgress: setProgress })
    } finally {
      setJobId(null)
      setProgress(null)
    }
  }
  // Raw bytes over the plugin's HTTP route; base64 over RPC on hosts without
  // it. name: the file's name, or its path inside an uploaded folder.
  async function sendFile(file, { name = file.name, folderId = null } = {}) {
    const query = new URLSearchParams({ name })
    if (folderId) query.set('folder', folderId)
    try {
      const response = await fetch(new URL(`api/aha-tutor/upload?${query}`, document.baseURI), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (response.status !== 404) {
        const body = await response.json()
        if (!body?.ok) throw new ApiError(body?.error?.code ?? 'failed', body?.error?.message ?? 'Upload failed')
        return (await follow(body.value)).material
      }
    } catch (error) {
      if (error?.message !== 'Failed to fetch') throw error
    }
    const base64 = await fileToBase64(file)
    return (await follow(await api.call('material/upload', { name, base64, folderId }))).material
  }

  async function upload(files, { folderId = null } = {}) {
    const results = []
    setError(null)
    for (const file of files) {
      setBusy(file.name)
      try {
        results.push(await sendFile(file, { folderId }))
      } catch (failure) {
        // Cancelling stops the files still waiting as well.
        if (failure?.code === 'cancelled') break
        setError(failure)
      }
    }
    setBusy(null)
    return results
  }

  // Folders of the computer planned with planFolder, one after the other,
  // each into its library folder (made when it has none of that name yet).
  // Resolves to a report for each: { name, folder, added, failed, known,
  // unsupported, cancelled }. Cancelling stops the files still waiting.
  async function uploadFolders(plans) {
    const reports = []
    setError(null)
    for (const plan of plans) {
      const report = { name: plan.name, folder: plan.folder, added: [], failed: [], known: plan.known, unsupported: plan.unsupported, cancelled: false }
      reports.push(report)
      if (!plan.upload.length) continue
      try {
        report.folder ??= (await api.call('folder/create', { name: plan.name, reuse: true })).folder
      } catch (failure) {
        report.failed.push({ path: plan.name, error: failure })
        continue
      }
      for (const [index, entry] of plan.upload.entries()) {
        setBatch({ folder: report.folder.name, n: index + 1, total: plan.upload.length })
        setBusy(entry.path)
        try {
          report.added.push(await sendFile(entry.file, { name: entry.path, folderId: report.folder.id }))
        } catch (failure) {
          if (failure?.code === 'cancelled') {
            report.cancelled = true
            break
          }
          report.failed.push({ path: entry.path, error: failure })
        }
      }
      if (report.cancelled) break
    }
    setBatch(null)
    setBusy(null)
    return reports
  }

  async function addUrl(url, { folderId = null } = {}) {
    setBusy(url)
    setError(null)
    try {
      const result = await follow(await api.call('material/url', { url, folderId }))
      return [result.material]
    } catch (failure) {
      if (failure?.code !== 'cancelled') setError(failure)
      return []
    } finally {
      setBusy(null)
    }
  }
  return { upload, uploadFolders, addUrl, busy, batch, error, progress, cancel: jobId ? () => api.cancel(jobId) : null }
}

// What an upload is doing: reading the file, reading the text in its
// pictures one by one, or summing the material up; in an uploaded folder,
// which file of how many.
function uploadLabel(t, name, progress, batch) {
  const label = progress?.label === 'recognizing' && progress.total
    ? t('readingPictures', { done: progress.done, total: progress.total, name })
    : progress?.label === 'summarizing' ? t('summarizingMaterial', { name }) : `${t('reading')} ${name}`
  return batch ? t('uploadingFolder', { name: batch.folder, n: batch.n, total: batch.total, label }) : label
}

// Before a computer's folder is uploaded: how many files go into which
// library folder, which are left out, and what it costs.
function FolderPlan({ pending, folderName, onStart, onCancel }) {
  const { t } = useApp()
  const files = pending.plans.reduce((sum, plan) => sum + plan.upload.length, 0)
  const total = files + pending.loose.length
  return <Modal title={t('folderUploadTitle')} onClose={onCancel} width={560} footer={total ? <>
    <button type="button" className="aha-btn" onClick={onCancel}>{t('cancel')}</button>
    <button type="button" className="aha-btn" data-kind="primary" onClick={onStart}>{t('folderUploadStart', { count: total })}</button>
  </> : <button type="button" className="aha-btn" onClick={onCancel}>{t('close')}</button>}>
    {pending.plans.map((plan, index) => <div key={`${plan.name}:${index}`} className="aha-col aha-folderPlan" style={{ gap: 4 }}>
      {plan.tooMany ? <p>{t('folderTooMany', { name: plan.name, max: FOLDER_FILE_LIMIT })}</p> : <>
        <p>{plan.upload.length ? t(plan.folder ? 'folderUploadInto' : 'folderUploadNew', { count: plan.upload.length, name: plan.name }) : t('folderUploadNothing', { name: plan.name })}</p>
        {plan.known.length ? <p className="aha-hint">{t('folderUploadKnown', { count: plan.known.length })}</p> : null}
        {plan.unsupported.length ? <p className="aha-hint">{t('folderUploadUnsupported', { count: plan.unsupported.length, list: shortList(plan.unsupported, t) })}</p> : null}
      </>}
    </div>)}
    {pending.loose.length ? <p className="aha-hint">{folderName ? t('folderUploadLooseInto', { count: pending.loose.length, name: folderName }) : t('folderUploadLoose', { count: pending.loose.length })}</p> : null}
    {files ? <p className="aha-hint">{t('folderUploadCost')}</p> : null}
  </Modal>
}

// What uploading the computer's folders did, until closed.
function FolderReport({ reports, onClose }) {
  const { t } = useApp()
  return <div className="aha-uploadReport" role="status">
    <div className="aha-spread" style={{ alignItems: 'flex-start' }}>
      <div className="aha-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        {reports.map((report, index) => <div key={`${report.name}:${index}`} className="aha-col" style={{ gap: 2 }}>
          <b>{t('folderUploadDone', { count: report.added.length, name: report.folder?.name ?? report.name })}</b>
          {report.known.length ? <span className="aha-hint">{t('folderUploadSkippedKnown', { count: report.known.length })}</span> : null}
          {report.unsupported.length ? <span className="aha-hint">{t('folderUploadSkippedUnsupported', { count: report.unsupported.length, list: shortList(report.unsupported, t) })}</span> : null}
          {report.failed.length ? <span className="aha-error">{t('folderUploadFailed', { count: report.failed.length, list: shortList(report.failed.map(entry => `${entry.path}（${errorText(t, entry.error)}）`), t, 3) })}</span> : null}
          {report.cancelled ? <span className="aha-hint">{t('folderUploadCancelled')}</span> : null}
        </div>)}
      </div>
      <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onClose} aria-label={t('close')}>✕</button>
    </div>
  </div>
}

// Files and folders on their way into the library, from an upload box or a
// composer they were dropped or pasted on: files go in at once; a folder of
// the computer is planned and shown to the learner first (FolderPlan), then
// goes into a library folder of its name. folderId: where single files go
// (folderName: its name). onAdded(materials, { folders }) names the library
// folders that uploaded computer folders went into. status: what to show
// meanwhile (progress with Cancel, the folders' report, an error, the plan).
export function useLibraryIntake({ folderId = null, folderName = '', onAdded }) {
  const { api, t } = useApp()
  const [pending, setPending] = useState(null)
  const [reports, setReports] = useState(null)
  const [planError, setPlanError] = useState(null)
  const uploads = useMaterialUpload()
  const { upload, uploadFolders, busy, batch, error, progress, cancel } = uploads
  const files = async list => {
    const added = await upload([...list], { folderId })
    if (added.length) onAdded?.(added, { folders: [] })
  }
  // The library's folders and materials as they are now, to plan against.
  async function folders(entries, loose = []) {
    setPlanError(null)
    try {
      const [{ folders: existing }, materials] = await Promise.all([api.call('folder/list'), api.call('material/list')])
      setPending({ plans: entries.map(entry => planFolder(entry, { folders: existing, materials, fallbackName: t('folderNewName') })), loose })
    } catch (failure) {
      setPlanError(failure)
    }
  }
  async function start() {
    const { plans, loose } = pending
    setPending(null)
    setReports(null)
    const done = await uploadFolders(plans.filter(entry => !entry.tooMany && entry.upload.length))
    const skipped = plans.filter(entry => !entry.tooMany && !entry.upload.length).map(entry => ({ name: entry.name, folder: entry.folder, added: [], failed: [], known: entry.known, unsupported: entry.unsupported, cancelled: false }))
    const all = [...done, ...skipped]
    if (all.length) setReports(all)
    const added = done.flatMap(report => report.added)
    if (loose.length && !done.some(report => report.cancelled)) added.push(...await upload(loose, { folderId }))
    const into = all.map(report => report.folder).filter(Boolean)
    if (added.length || into.length) onAdded?.(added, { folders: into })
  }
  // What was dropped (readDrop's loose files and folders()): the folders,
  // when there are any, are planned with the loose files; else the files go.
  const take = ({ files: loose = [], folders: read = async () => [] }) => read().then(found => (found.length ? folders(found, loose) : files(loose)), setPlanError)
  const status = <>
    {busy ? <div className="aha-row" style={{ gap: 8 }}>
      <Spinner label={uploadLabel(t, busy, progress, batch)} />
      {cancel ? <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={cancel}>{t('cancel')}</button> : null}
    </div> : null}
    {reports && !busy ? <FolderReport reports={reports} onClose={() => setReports(null)} /> : null}
    <ErrorLine error={error ?? planError} />
    {pending ? <FolderPlan pending={pending} folderName={folderId ? folderName : ''} onStart={start} onCancel={() => setPending(null)} /> : null}
  </>
  return { files, folders, take, status, busy, addUrl: uploads.addUrl }
}

// Files and links into the library. A whole folder of the computer can be
// picked or dropped too: it goes into a library folder of its name, once
// the learner has seen what it holds (FolderPlan). folderId: where single
// files and links go (folderName: its name). onAdded(materials, { folders })
// names the library folders that uploaded computer folders went into.
export function UploadZone({ onAdded, compact = false, folderId = null, folderName = '' }) {
  const { t } = useApp()
  const input = useRef(null)
  const folderInput = useRef(null)
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)
  const intake = useLibraryIntake({ folderId, folderName, onAdded })
  const busy = intake.busy
  const drop = event => {
    event.preventDefault()
    setOver(false)
    const dropped = readDrop(event.dataTransfer)
    intake.take({ files: dropped.loose, folders: dropped.folders })
  }
  return <div className="aha-col">
    <div className="aha-empty" style={{ padding: compact ? 14 : 24, borderColor: over ? 'var(--aha-brand)' : undefined, cursor: 'pointer' }}
      onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}>
      <div className="aha-row" style={{ justifyContent: 'center' }}><Icon name="upload" />{t('dropHere')}</div>
      <div className="aha-row" style={{ justifyContent: 'center' }}>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={Boolean(busy)} onClick={event => { event.stopPropagation(); folderInput.current?.click() }}><Icon name="folder" size={15} />{t('uploadFolder')}</button>
      </div>
      <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={event => { intake.files(event.currentTarget.files); event.currentTarget.value = '' }} />
      <input ref={folderInput} type="file" multiple hidden webkitdirectory="" onChange={event => { const files = [...event.currentTarget.files]; event.currentTarget.value = ''; if (files.length) intake.folders(foldersFromInput(files)) }} />
    </div>
    <form className="aha-row" onSubmit={async event => {
      event.preventDefault()
      if (!url.trim()) return
      const added = await intake.addUrl(url.trim(), { folderId })
      if (added.length) {
        setUrl('')
        onAdded?.(added, { folders: [] })
      }
    }}>
      <input className="aha-input" style={{ flex: 1 }} value={url} placeholder={t('urlPlaceholder')} onChange={event => setUrl(event.currentTarget.value)} />
      <button type="submit" className="aha-btn" disabled={!url.trim() || Boolean(busy)}><Icon name="link" />{t('addUrl')}</button>
    </form>
    {intake.status}
  </div>
}

// The row of folder chips: every material, the unfiled ones and each
// folder, with how many each holds; ＋ 新建文件夹 when onCreate is given.
export function FolderBar({ folders, materials, view, onChange, onCreate }) {
  const { t } = useApp()
  const counts = viewCounts(materials)
  const chip = (key, label, icon) => <button key={key} type="button" className="aha-chip" data-active={view === key} aria-pressed={view === key} onClick={() => onChange(key)}>
    {icon ? <Icon name="folder" size={14} /> : null}<span className="aha-chipName">{label}</span><small>{counts.get(key) ?? 0}</small>
  </button>
  return <div className="aha-row aha-folderBar" role="toolbar" aria-label={t('folders')}>
    {chip(ALL, t('foldersAll'))}
    {chip(UNFILED, t('foldersUnfiled'))}
    {(folders ?? []).map(folder => chip(folder.id, folder.name, true))}
    {onCreate ? <button type="button" className="aha-chip" data-kind="add" onClick={onCreate}><Icon name="plus" size={14} />{t('folderNew')}</button> : null}
  </div>
}

// exclude: materials not to offer (those a course already uses). max: how
// many may be picked (LIMITS.materials, or what a course has room for).
// Once that many are picked the others are greyed out, and files uploaded
// here beyond it stay in the library, with a note saying so. With folders,
// a row of folder chips picks the view, and a folder can be picked whole
// (as much of it as there is room for); files uploaded here go into the
// folder shown.
export function MaterialPicker({ selected, onChange, onClose, exclude = [], max = LIMITS.materials }) {
  const { api, t } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const folderList = useLoad(() => api.call('folder/list'), [])
  const folders = folderList.value?.folders ?? []
  const [chosenView, setView] = useState(ALL)
  const view = knownView(chosenView, folders)
  const folder = folders.find(entry => entry.id === view) ?? null
  const [leftOut, setLeftOut] = useState(0)
  const [folderLeftOut, setFolderLeftOut] = useState(0)
  const offered = (materials.value ?? []).filter(item => !exclude.includes(item.id))
  const shown = inView(offered, view)
  const full = selected.length >= max
  const toggle = id => {
    if (selected.includes(id)) onChange(selected.filter(value => value !== id))
    else if (!full) onChange([...selected, id])
  }
  const uploaded = (added, { folders: into = [] } = {}) => {
    materials.reload()
    folderList.reload()
    if (into[0]) setView(into[0].id)
    const fresh = added.map(item => item.id).filter(id => !selected.includes(id))
    const room = Math.max(0, max - selected.length)
    onChange([...selected, ...fresh.slice(0, room)])
    setLeftOut(Math.max(0, fresh.length - room))
  }
  // The folder shown, picked whole in its order, or unpicked once it all is.
  const inFolder = folder ? shown.map(item => item.id) : []
  const wholeFolder = inFolder.length > 0 && inFolder.every(id => selected.includes(id))
  const pickFolder = () => {
    if (wholeFolder) {
      onChange(selected.filter(id => !inFolder.includes(id)))
      setFolderLeftOut(0)
      return
    }
    const fresh = inFolder.filter(id => !selected.includes(id))
    const room = Math.max(0, max - selected.length)
    onChange([...selected, ...fresh.slice(0, room)])
    setFolderLeftOut(Math.max(0, fresh.length - room))
  }
  return <Modal title={t('pickMaterials')} onClose={onClose} width={640} footer={<>
    <span className="aha-hint aha-pickCount" aria-live="polite">{t('pickedCount', { count: selected.length, max })}</span>
    <button type="button" className="aha-btn" data-kind="primary" onClick={onClose}>{t('confirm')}</button>
  </>}>
    <UploadZone compact folderId={folder?.id ?? null} folderName={folder?.name ?? ''} onAdded={uploaded} />
    {leftOut ? <p className="aha-hint" role="status">{t('pickLeftOut', { count: leftOut, max })}</p> : null}
    {full ? <p className="aha-hint" role="status">{t('pickFull', { max })}</p> : null}
    {folders.length ? <FolderBar folders={folders} materials={offered} view={view} onChange={next => { setView(next); setFolderLeftOut(0) }} /> : null}
    {folder && inFolder.length ? <div className="aha-row" style={{ gap: 8 }}>
      <button type="button" className="aha-btn" data-size="sm" disabled={!wholeFolder && full} onClick={pickFolder}>{wholeFolder ? t('unpickFolder') : t('pickFolder', { count: inFolder.length })}</button>
      {folderLeftOut ? <span className="aha-hint" role="status">{t('pickFolderLeftOut', { count: folderLeftOut, max })}</span> : null}
    </div> : null}
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : null}
    <div className="aha-col" style={{ gap: 6, maxHeight: 320, overflow: 'auto' }}>
      {shown.map(item => {
        const off = full && !selected.includes(item.id)
        return <label key={item.id} className="aha-option" data-off={off ? 'true' : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={off} onChange={() => toggle(item.id)} />
          <span className="aha-col" style={{ gap: 0 }}><b>{item.title}</b><small>{describeMaterial(item, t)}</small></span>
        </label>
      })}
      {folder && !shown.length ? <p className="aha-hint">{t('pickFolderEmpty')}</p> : null}
    </div>
  </Modal>
}

export function describeMaterial(item, t) {
  const parts = [item.kind.toUpperCase()]
  // A file from a subfolder of an uploaded folder: where it was.
  if (String(item.fileName ?? '').includes('/')) parts.push(item.fileName)
  if (item.pages) parts.push(t('pages', { count: item.pages }))
  if (item.slides) parts.push(t('slides', { count: item.slides }))
  const read = item.ocr?.read ?? 0
  if (read && item.kind === 'image') parts.push(item.chars ? t('readPhoto') : t('photoNoText'))
  else if (read) parts.push(item.pages ? t('readScanPages', { count: read }) : t('readPictures', { count: read }))
  else if (item.kind === 'image') parts.push(t('imageNeedsVision'))
  if (readingNotes(item, t).length) parts.push(t('readPartly'))
  return parts.join(' · ')
}

// What could not be read from a material's pictures, and why.
export function readingNotes(item, t) {
  const ocr = item.ocr
  if (!ocr) return []
  const notes = []
  const pages = Boolean(item.pages)
  if (ocr.unread) notes.push(t(pages ? 'unreadPages' : 'unreadPictures', { count: ocr.unread }))
  if (ocr.failed?.length) {
    const list = [...new Set(ocr.failed.map(spot => spot.page ?? spot.slide ?? spot.picture))].join(t('listJoin'))
    const what = t(item.kind === 'image' ? 'failedPhoto' : pages ? 'failedPages' : item.slides ? 'failedSlides' : 'failedPictures', { list })
    notes.push(ocr.reason ? t('failedWhy', { what, reason: errorText(t, { code: ocr.reason }) }) : t('failedRetry', { what }))
  }
  if (ocr.left) notes.push(t(pages ? 'leftPages' : 'leftPictures', { count: ocr.left }))
  return notes
}

// A page, or a run of pages, as the book prints them; their place in the
// PDF shows on hover when the two differ. page/end: places in the file;
// label/endLabel: the numbers printed on them.
export function pageWords(t, { page, end, label, endLabel }) {
  const from = label ?? page
  const to = end && end !== page ? endLabel ?? end : null
  const text = to && String(to) !== String(from) ? t('pagesN', { from, to }) : t('pageN', { page: from })
  const moved = (label && label !== String(page)) || (endLabel && endLabel !== String(end))
  const pdf = !moved ? undefined : to ? t('pdfPagesN', { from: page, to: end }) : t('pdfPageN', { page })
  return { text, pdf }
}

export function PageRef(props) {
  const { t } = useApp()
  const { text, pdf } = pageWords(t, props)
  return <span className="aha-pageRef" title={pdf} data-pdf={pdf ? 'true' : undefined}>{text}</span>
}

// The pages of the course materials a lesson teaches from: "📖 第 12–15 页",
// with the material, the contents entry and the PDF pages on hover.
export function LessonSources({ sources }) {
  const { t } = useApp()
  const shown = (sources ?? []).map(source => ({ source, words: source.page ? pageWords(t, source) : null })).filter(({ source, words }) => words || source.title)
  if (!shown.length) return null
  const text = shown.map(({ source, words }) => words?.text ?? source.title).join(t('listJoin'))
  const detail = shown.map(({ source, words }) => [source.materialTitle, source.title, words?.text, words?.pdf].filter(Boolean).join(' · ')).join('\n')
  return <span className="aha-lessonSource" title={`${t('lessonSourcesTitle')}\n${detail}`}>📖 {text}</span>
}

// A material's contents: its bookmarks or headings, each with its pages.
export function OutlineList({ material }) {
  const { t } = useApp()
  const entries = material.outline?.entries ?? []
  if (!entries.length) return null
  return <details className="aha-outline">
    <summary>{t('outlineTitle', { count: entries.length })}<span className="aha-hint"> · {t(material.outline.source === 'bookmarks' ? 'outlineBookmarks' : 'outlineHeadings')}{material.printed ? ` · ${t('outlinePrinted')}` : ''}</span></summary>
    <ol>{entries.map((entry, index) => <li key={index} data-level={entry.level}>
      <span className="aha-outlineTitle">{entry.title}</span>
      {entry.page ? <PageRef page={entry.page} end={entry.end} label={entry.label} endLabel={entry.endLabel} /> : null}
    </li>)}</ol>
  </details>
}

// Web sources: untrusted links, so http(s) only and opened outside the app.
export function SourceList({ sources }) {
  const safe = (sources ?? []).filter(source => /^https?:\/\//iu.test(String(source?.url ?? '')))
  return <ol className="aha-sourceList">{safe.map(source => <li key={source.url}>
    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
    <span className="aha-hint"> · {new URL(source.url).hostname}</span>
    {source.snippet ? <p className="aha-hint">{source.snippet}</p> : null}
  </li>)}</ol>
}

// A course named compactly in lists (its emoji and main title); the full
// title shows on hover.
export function CourseLabel({ title, emoji }) {
  if (!title) return null
  return <span className="aha-hint" title={title}> · {emoji ? `${emoji} ` : ''}{shortCourseTitle(title)}</span>
}

// Five segments; nothing lights up until there is evidence (stage "none").
export function MasteryMeter({ value, stage, label }) {
  const filled = stage === 'none' ? 0 : Math.round((Number(value) || 0) / 20)
  const title = label ? (stage === 'none' ? label : `${label} · ${Math.round(value ?? 0)}%`) : `${Math.round(value ?? 0)}%`
  return <span className="aha-meter" title={title} aria-label={title} role="img" data-stage={stage}>{[0, 1, 2, 3, 4].map(index => <i key={index} data-on={index < filled} />)}</span>
}

export function copyText(textValue) {
  return navigator.clipboard?.writeText(textValue).catch(() => undefined)
}
