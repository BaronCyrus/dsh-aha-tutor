// Pictures in a question (即时答疑): pasted or dropped into a composer,
// shown as chips while the question is written, and over the board once it
// is asked. They go to the host's question pictures (host/pictures.js),
// not to the library; 存进资料库 copies one there.

import { useEffect, useRef, useState } from 'react'

import { ApiError, fileToBase64 } from './api.js'
import { errorText, Modal } from './components.jsx'
import { readDrop } from './folders.js'
import { useApp, useLoad } from './hooks.js'
import { QUESTION_PICTURES } from '../core/pictures.js'

// Where the browser shows a stored picture (the host's picture route).
export function pictureUrl(id) {
  return new URL(`api/aha-tutor/picture?id=${encodeURIComponent(id)}`, document.baseURI).href
}

// Raw bytes over the upload route; base64 over RPC on hosts without it.
// Resolves to the picture as the host shows it.
async function sendPicture(api, file, { onJob, onPreview, onProgress }) {
  const name = file.name || 'image.png'
  let started = null
  try {
    const response = await fetch(new URL(`api/aha-tutor/upload?${new URLSearchParams({ name, for: 'question' })}`, document.baseURI), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (response.status !== 404) {
      const body = await response.json()
      if (!body?.ok) throw new ApiError(body?.error?.code ?? 'failed', body?.error?.message ?? 'Upload failed')
      started = body.value
    }
  } catch (error) {
    if (error?.message !== 'Failed to fetch') throw error
  }
  started ??= await api.call('picture/upload', { name, base64: await fileToBase64(file) })
  onJob?.(started.job)
  return (await api.follow(started, { onPreview, onProgress })).picture
}

// The pictures of the question being written: [{ key, status, name,
// picture, error }], status being 'uploading', 'reading' (its text is
// being read), 'ready' or 'failed'. initial: pictures already uploaded (a
// question started on the home page).
export function usePictureUploads(initial = []) {
  const { api } = useApp()
  const [items, setItems] = useState(() => (Array.isArray(initial) ? initial : []).filter(picture => picture?.id).map(picture => ({ key: picture.id, status: 'ready', name: picture.name, picture })))
  const [leftOut, setLeftOut] = useState(0)
  const current = useRef(items)
  current.current = items
  const jobs = useRef(new Map())
  const gone = useRef(new Set())
  const update = (key, patch) => setItems(list => list.map(item => (item.key === key ? { ...item, ...patch } : item)))

  function add(files) {
    const list = [...(files ?? [])]
    const room = Math.max(0, QUESTION_PICTURES - current.current.filter(item => item.status !== 'failed').length)
    setLeftOut(Math.max(0, list.length - room))
    const taken = list.slice(0, room).map(file => ({ file, key: `up:${Math.random().toString(36).slice(2)}` }))
    if (!taken.length) return
    setItems(existing => [...existing, ...taken.map(({ file, key }) => ({ key, status: 'uploading', name: file.name || 'image.png', picture: null }))])
    for (const { file, key } of taken) {
      sendPicture(api, file, {
        onJob: job => jobs.current.set(key, job?.id),
        onPreview: preview => update(key, { picture: preview }),
        onProgress: progress => { if (progress?.label === 'recognizing') update(key, { status: 'reading' }) },
      }).then(picture => {
        jobs.current.delete(key)
        // Taken out while it was on its way.
        if (gone.current.has(key)) api.call('picture/discard', { id: picture.id }).catch(() => undefined)
        else update(key, { status: 'ready', picture })
      }, error => {
        jobs.current.delete(key)
        if (!gone.current.has(key)) update(key, { status: 'failed', error })
      })
    }
  }

  // Taken out before the question is asked: the host forgets it.
  function remove(key) {
    const item = current.current.find(entry => entry.key === key)
    gone.current.add(key)
    setItems(list => list.filter(entry => entry.key !== key))
    setLeftOut(0)
    const job = jobs.current.get(key)
    if (job) api.cancel(job)
    if (item?.picture?.id) api.call('picture/discard', { id: item.picture.id }).catch(() => undefined)
  }

  // Asked: the pictures now belong to the thread.
  function clear() {
    setItems([])
    setLeftOut(0)
  }

  const ready = items.filter(item => item.status === 'ready').map(item => item.picture)
  const busy = items.some(item => item.status === 'uploading' || item.status === 'reading')
  return { items, ready, busy, leftOut, add, remove, clear }
}

// Whether the teacher would take in a picture: 'image', 'text' or 'none'
// ('none' too when its text was read and there was none).
export function pictureUse(picture) {
  if (picture?.sight === 'image') return 'image'
  if (picture?.sight === 'text' && picture.text?.trim()) return 'text'
  return 'none'
}

// Pictures alone that the teacher would take in none of, so the question is
// not sent: words are needed (the chips already say how to let the teacher
// see pictures), or the pictures had no text to read.
export function unusableAlone(pictures) {
  if (!pictures.length || pictures.some(picture => pictureUse(picture) !== 'none')) return null
  return { code: pictures.some(picture => picture.sight === 'none') ? 'pictures-need-words' : 'pictures-unread' }
}

function chipLine(item, t) {
  if (item.status === 'uploading') return { text: t('pictureUploading') }
  if (item.status === 'reading') return { text: t('pictureReading') }
  if (item.status === 'failed') return { text: errorText(t, item.error), warn: true }
  const picture = item.picture
  if (picture.sight === 'image') return { text: t('pictureSeen') }
  if (picture.sight === 'text') {
    if (picture.text?.trim()) return { text: t('pictureTextRead') }
    if (picture.failed) return { text: t('pictureReadFailed', { reason: errorText(t, { code: picture.failed }) }), warn: true }
    return { text: t('pictureNoText'), warn: true }
  }
  return { text: t('pictureUnseenChip'), warn: true }
}

// The composer's row of pictures, with what each means for the teacher and
// a line on how to let the teacher see them when no model can.
export function PictureChips({ uploads }) {
  const { t, navigate } = useApp()
  const { items, leftOut } = uploads
  if (!items.length && !leftOut) return null
  const ready = items.filter(item => item.status === 'ready')
  const blind = ready.some(item => item.picture.sight === 'none')
  const textOnly = !blind && ready.some(item => item.picture.sight === 'text')
  return <div className="aha-col" style={{ gap: 6 }}>
    {items.length ? <div className="aha-attachRow">
      {items.map(item => {
        const line = chipLine(item, t)
        return <div key={item.key} className="aha-attach" data-warn={line.warn ? 'true' : undefined} title={item.picture?.text?.trim() || undefined}>
          {item.picture ? <img className="aha-attachThumb" src={pictureUrl(item.picture.id)} alt="" /> : <span className="aha-attachThumb" data-wait="true"><span className="aha-spinner" /></span>}
          <span className="aha-attachText"><b>{item.picture?.name ?? item.name}</b><small>{line.text}</small></span>
          <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" aria-label={t('removePicture')} title={t('removePicture')} onClick={() => uploads.remove(item.key)}>✕</button>
        </div>
      })}
    </div> : null}
    {leftOut ? <p className="aha-hint" role="status">{t('picturesLeftOut', { count: leftOut, max: QUESTION_PICTURES })}</p> : null}
    {blind ? <p className="aha-hint aha-pictureNote" data-warn="true" role="status">{t('picturesNeedVision')} <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('settings')}>{t('openSettings')}</button></p> : null}
    {textOnly ? <p className="aha-hint" role="status">{t('picturesTextOnly')}</p> : null}
  </div>
}

// A composer that takes files: dropped on it (files and folders), or
// pasted into its text box (a screenshot). A copy that carries text as
// well, such as cells copied from a spreadsheet, pastes its text.
// onFiles({ files, folders }): folders() reads the dropped folders
// (readDrop). box: props for the composer; paste: its text box's onPaste.
export function useFileDrop(onFiles) {
  const [over, setOver] = useState(false)
  const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files')
  const box = {
    'data-over': over ? 'true' : undefined,
    onDragEnter: event => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setOver(true)
    },
    onDragOver: event => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setOver(true)
    },
    onDragLeave: event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOver(false)
    },
    onDrop: event => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setOver(false)
      const dropped = readDrop(event.dataTransfer)
      onFiles({ files: dropped.loose, folders: dropped.folders })
    },
  }
  const paste = event => {
    const data = event.clipboardData
    const files = [...(data?.files ?? [])]
    if (!files.length || data.getData('text/plain').trim()) return
    event.preventDefault()
    onFiles({ files, folders: async () => [] })
  }
  return { box, paste }
}

// The pictures a question showed, over its board. Each opens large and can
// be kept in the library. pictures: the turn's [{ id, seen }].
export function TurnPictures({ pictures }) {
  const { api, t } = useApp()
  const ids = (pictures ?? []).map(picture => picture.id)
  const found = useLoad(() => (ids.length ? api.call('picture/get', { ids }) : Promise.resolve({ pictures: [] })), [ids.join(',')])
  const [open, setOpen] = useState(null)
  const [keeping, setKeeping] = useState({})
  const [kept, setKept] = useState({})
  const [error, setError] = useState(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  if (!ids.length) return null
  const metas = new Map((found.value?.pictures ?? []).filter(Boolean).map(picture => [picture.id, picture]))
  async function keep(id) {
    setError(null)
    setKeeping(current => ({ ...current, [id]: true }))
    try {
      const { material } = await api.run('picture/keep', { id })
      if (live.current) setKept(current => ({ ...current, [id]: material.id }))
    } catch (failure) {
      if (live.current) setError(failure)
    } finally {
      if (live.current) setKeeping(current => ({ ...current, [id]: false }))
    }
  }
  return <div className="aha-col" style={{ gap: 4 }}>
    <div className="aha-turnPictures" aria-label={t('turnPictures')}>
      {pictures.map((entry, index) => {
        const meta = metas.get(entry.id)
        if (found.value && !meta) return <span key={entry.id} className="aha-tag">{t('pictureGone')}</span>
        const inLibrary = kept[entry.id] ?? meta?.materialId
        return <div key={entry.id} className="aha-turnPicture">
          <button type="button" className="aha-turnThumb" title={t('pictureEnlarge')} onClick={() => setOpen(entry.id)}><img src={pictureUrl(entry.id)} alt={t('pictureN', { n: index + 1 })} /></button>
          <span className="aha-col" style={{ gap: 2 }}>
            {entry.seen === 'none' ? <small className="aha-error">{t('pictureUnseen')}</small> : entry.seen === 'text' ? <small className="aha-hint">{t('pictureTextOnly')}</small> : null}
            {inLibrary ? <small className="aha-hint">✓ {t('pictureKept')}</small> : <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={keeping[entry.id] || !meta} onClick={() => keep(entry.id)}>{keeping[entry.id] ? <span className="aha-spinner" /> : null}{keeping[entry.id] ? t('keepingPicture') : t('keepPicture')}</button>}
          </span>
        </div>
      })}
    </div>
    {error ? <div className="aha-error" role="alert">{errorText(t, error)}</div> : null}
    {open ? <Modal title={t('pictureN', { n: ids.indexOf(open) + 1 })} onClose={() => setOpen(null)} width={960}>
      <img className="aha-pictureLarge" src={pictureUrl(open)} alt="" />
    </Modal> : null}
  </div>
}
