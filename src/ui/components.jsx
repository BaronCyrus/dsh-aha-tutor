import { useEffect, useRef, useState } from 'react'

import { ApiError, fileToBase64 } from './api.js'
import { useApp, useLoad } from './hooks.js'
import { Icon } from './icons.jsx'
import { shortCourseTitle } from '../core/course-model.js'

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

const ACCEPT = '.pdf,.docx,.pptx,.md,.markdown,.txt,.csv,.json,.tex,.py,.js,.ts,.html,.png,.jpg,.jpeg,.webp,.gif'

// Upload files / add links; resolves to the new material metas. progress is
// the host job's ({ done, total, label }), and cancel() stops it while it runs:
// reading the text in a long scan takes minutes.
export function useMaterialUpload() {
  const { api } = useApp()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [jobId, setJobId] = useState(null)
  async function follow(value) {
    setJobId(value?.job?.id ?? null)
    try {
      return await api.follow(value, { onProgress: setProgress })
    } finally {
      setJobId(null)
      setProgress(null)
    }
  }
  // Raw bytes over the plugin's HTTP route; base64 over RPC on hosts without it.
  async function sendFile(file) {
    try {
      const response = await fetch(new URL(`api/aha-tutor/upload?name=${encodeURIComponent(file.name)}`, document.baseURI), {
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
    return (await follow(await api.call('material/upload', { name: file.name, base64 }))).material
  }

  async function upload(files) {
    const results = []
    setError(null)
    for (const file of files) {
      setBusy(file.name)
      try {
        results.push(await sendFile(file))
      } catch (failure) {
        // Cancelling stops the files still waiting as well.
        if (failure?.code === 'cancelled') break
        setError(failure)
      }
    }
    setBusy(null)
    return results
  }
  async function addUrl(url) {
    setBusy(url)
    setError(null)
    try {
      const result = await follow(await api.call('material/url', { url }))
      return [result.material]
    } catch (failure) {
      if (failure?.code !== 'cancelled') setError(failure)
      return []
    } finally {
      setBusy(null)
    }
  }
  return { upload, addUrl, busy, error, progress, cancel: jobId ? () => api.cancel(jobId) : null }
}

// What an upload is doing: reading the file, reading the text in its
// pictures one by one, or summing the material up.
function uploadLabel(t, name, progress) {
  if (progress?.label === 'recognizing' && progress.total) return t('readingPictures', { done: progress.done, total: progress.total, name })
  if (progress?.label === 'summarizing') return t('summarizingMaterial', { name })
  return `${t('reading')} ${name}`
}

export function UploadZone({ onAdded, compact = false }) {
  const { t } = useApp()
  const input = useRef(null)
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)
  const { upload, addUrl, busy, error, progress, cancel } = useMaterialUpload()
  const handle = async files => {
    const added = await upload([...files])
    if (added.length) onAdded?.(added)
  }
  return <div className="aha-col">
    <div className="aha-empty" style={{ padding: compact ? 14 : 24, borderColor: over ? 'var(--aha-brand)' : undefined, cursor: 'pointer' }}
      onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={event => { event.preventDefault(); setOver(false); handle(event.dataTransfer.files) }}>
      <div className="aha-row" style={{ justifyContent: 'center' }}><Icon name="upload" />{t('dropHere')}</div>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={event => { handle(event.currentTarget.files); event.currentTarget.value = '' }} />
    </div>
    <form className="aha-row" onSubmit={async event => {
      event.preventDefault()
      if (!url.trim()) return
      const added = await addUrl(url.trim())
      if (added.length) {
        setUrl('')
        onAdded?.(added)
      }
    }}>
      <input className="aha-input" style={{ flex: 1 }} value={url} placeholder={t('urlPlaceholder')} onChange={event => setUrl(event.currentTarget.value)} />
      <button type="submit" className="aha-btn" disabled={!url.trim() || Boolean(busy)}><Icon name="link" />{t('addUrl')}</button>
    </form>
    {busy ? <div className="aha-row" style={{ gap: 8 }}>
      <Spinner label={uploadLabel(t, busy, progress)} />
      {cancel ? <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={cancel}>{t('cancel')}</button> : null}
    </div> : null}
    <ErrorLine error={error} />
  </div>
}

// exclude: materials not to offer (those a course already uses).
export function MaterialPicker({ selected, onChange, onClose, exclude = [], max = 8 }) {
  const { api, t } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const toggle = id => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, max))
  return <Modal title={t('pickMaterials')} onClose={onClose} width={640} footer={<button type="button" className="aha-btn" data-kind="primary" onClick={onClose}>{t('confirm')}</button>}>
    <UploadZone compact onAdded={added => { materials.reload(); onChange([...selected, ...added.map(item => item.id)].slice(0, max)) }} />
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : null}
    <div className="aha-col" style={{ gap: 6, maxHeight: 320, overflow: 'auto' }}>
      {(materials.value ?? []).filter(item => !exclude.includes(item.id)).map(item => <label key={item.id} className="aha-option" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
        <span className="aha-col" style={{ gap: 0 }}><b>{item.title}</b><small>{describeMaterial(item, t)}</small></span>
      </label>)}
    </div>
  </Modal>
}

export function describeMaterial(item, t) {
  const parts = [item.kind.toUpperCase()]
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
