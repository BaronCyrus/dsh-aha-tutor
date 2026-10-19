import { useRef, useState } from 'react'

import { fileToBase64 } from './api.js'
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
export function JobProgress({ progress, label, onCancel }) {
  const { t } = useApp()
  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  return <div className="aha-col" style={{ gap: 6 }}>
    <Spinner label={label} />
    {progress?.total ? <Progress value={percent} /> : null}
    {onCancel ? <div className="aha-row">
      <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onCancel}>{t('cancel')}</button>
      <span className="aha-hint">{t('keepsRunning')}</span>
    </div> : null}
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

export function ErrorLine({ error, style }) {
  const { t } = useApp()
  if (!error) return null
  return <div className="aha-error" role="alert" style={style} title={error.message ?? undefined}>{errorText(t, error)}</div>
}

export function Empty({ children }) {
  return <div className="aha-empty">{children}</div>
}

const ACCEPT = '.pdf,.docx,.pptx,.md,.markdown,.txt,.csv,.json,.tex,.py,.js,.ts,.html,.png,.jpg,.jpeg,.webp,.gif'

// Upload files / add links; resolves to the new material metas.
export function useMaterialUpload() {
  const { api } = useApp()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
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
        if (!body?.ok) throw new Error(body?.error?.message ?? 'Upload failed')
        return (await api.follow(body.value)).material
      }
    } catch (error) {
      if (error?.message !== 'Failed to fetch') throw error
    }
    const base64 = await fileToBase64(file)
    return (await api.run('material/upload', { name: file.name, base64 })).material
  }

  async function upload(files) {
    const results = []
    setError(null)
    for (const file of files) {
      setBusy(file.name)
      try {
        results.push(await sendFile(file))
      } catch (failure) {
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
      const result = await api.run('material/url', { url })
      return [result.material]
    } catch (failure) {
      setError(failure)
      return []
    } finally {
      setBusy(null)
    }
  }
  return { upload, addUrl, busy, error }
}

export function UploadZone({ onAdded, compact = false }) {
  const { t } = useApp()
  const input = useRef(null)
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)
  const { upload, addUrl, busy, error } = useMaterialUpload()
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
    {busy ? <Spinner label={`${t('reading')} ${busy}`} /> : null}
    <ErrorLine error={error} />
  </div>
}

export function MaterialPicker({ selected, onChange, onClose }) {
  const { api, t } = useApp()
  const materials = useLoad(() => api.call('material/list'), [])
  const toggle = id => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, 8))
  return <Modal title={t('pickMaterials')} onClose={onClose} width={640} footer={<button type="button" className="aha-btn" data-kind="primary" onClick={onClose}>{t('confirm')}</button>}>
    <UploadZone compact onAdded={added => { materials.reload(); onChange([...selected, ...added.map(item => item.id)].slice(0, 8)) }} />
    {materials.loading && !materials.value ? <Spinner label={t('loading')} /> : null}
    <div className="aha-col" style={{ gap: 6, maxHeight: 320, overflow: 'auto' }}>
      {(materials.value ?? []).map(item => <label key={item.id} className="aha-option" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
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
  if (item.kind === 'image') parts.push(t('imageNeedsVision'))
  return parts.join(' · ')
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
