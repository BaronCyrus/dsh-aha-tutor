// The board's export menu: a PDF with one board page per PDF page, PNG
// pictures (one per page, in a ZIP when there are several) and Markdown text.
// Pictures show the board as the learner sees it: the board look and font
// from Settings, formulas, highlights, marks and asked questions included.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { downloadBlob, downloadName, downloadText } from './api.js'
import { BoardSheets } from './board/Board.jsx'
import { captureSheet, fitSheets, loadCaptureImages, paintCapture, settleFonts } from './capture.js'
import { Spinner } from './components.jsx'
import { useApp, useDarkMode } from './hooks.js'
import { buildPdf, canvasToPdfImage } from './pdf.js'
import { buildZip } from './zip.js'
import { boardToMarkdown } from '../core/board-script.js'

// Canvas pixels per CSS pixel: a 1200 px wide page becomes 2400 pixels.
const SCALE = 2

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('image encoding failed'))), 'image/png')
  })
}

export function BoardExport({ steps, title, kind = 'ghost' }) {
  const { t, settings, toast } = useApp()
  const dark = useDarkMode()
  const [menu, setMenu] = useState(false)
  const [job, setJob] = useState(null)
  const pagesRef = useRef(null)
  const control = useRef(null)
  const theme = settings.boardTheme === 'dark' || (settings.boardTheme !== 'light' && dark) ? 'dark' : 'light'
  const font = settings.boardFont === 'standard' ? 'standard' : 'hand'
  const name = downloadName(title)

  function start(format) {
    setMenu(false)
    if (!steps?.length || job) return
    if (format === 'md') {
      downloadText(`${name}.md`, boardToMarkdown({ title, steps }), 'text/markdown')
      return
    }
    setJob({ id: Date.now(), format, done: 0, total: 0 })
  }

  function cancel() {
    if (control.current) control.current.cancelled = true
    control.current = null
    setJob(null)
  }

  async function render(format, local) {
    const root = pagesRef.current
    if (!root) throw new Error('pages missing')
    await settleFonts(root)
    fitSheets(root)
    const pages = [...root.querySelectorAll('[data-sheet]')]
    setJob(current => current && { ...current, total: pages.length })
    const outputs = []
    for (const [index, page] of pages.entries()) {
      if (local.cancelled) return
      const capture = await loadCaptureImages(captureSheet(page, { scale: SCALE }))
      const canvas = paintCapture(capture, SCALE)
      outputs.push(format === 'pdf' ? { width: capture.width, height: capture.height, image: await canvasToPdfImage(canvas) } : await canvasPng(canvas))
      setJob(current => current && { ...current, done: index + 1 })
    }
    if (local.cancelled || !outputs.length) return
    if (format === 'pdf') {
      downloadBlob(`${name}.pdf`, new Blob([buildPdf(outputs, { title, creator: `${t('appName')} · ${t('appTagline')}` })], { type: 'application/pdf' }))
    } else if (outputs.length === 1) {
      downloadBlob(`${name}.png`, outputs[0])
    } else {
      const entries = await Promise.all(outputs.map(async (blob, index) => ({ name: `${name}-${String(index + 1).padStart(2, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) })))
      downloadBlob(`${name}.zip`, new Blob([buildZip(entries)], { type: 'application/zip' }))
    }
  }

  // The pages exist once the portal below has rendered them.
  useEffect(() => {
    if (!job) return undefined
    const local = { cancelled: false }
    control.current = local
    render(job.format, local)
      .catch(() => { if (!local.cancelled) toast(t('exportFailed')) })
      .finally(() => {
        if (control.current !== local) return
        control.current = null
        setJob(null)
      })
    return () => { local.cancelled = true }
  }, [job?.id])

  return <span className="aha-menuAnchor">
    {job
      ? <><Spinner label={t('exportingBoard', { done: job.done, total: job.total || '…' })} /><button type="button" className="aha-btn" data-kind={kind ?? undefined} data-size="sm" onClick={cancel}>{t('cancel')}</button></>
      : <button type="button" className="aha-btn" data-kind={kind ?? undefined} data-size="sm" disabled={!steps?.length} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}>{t('exportBoard')} ▾</button>}
    {menu ? <div className="aha-card aha-menu" role="menu" onMouseLeave={() => setMenu(false)}>
      <button type="button" role="menuitem" className="aha-btn" data-kind="ghost" onClick={() => start('pdf')}>{t('exportPdf')}</button>
      <button type="button" role="menuitem" className="aha-btn" data-kind="ghost" onClick={() => start('png')}>{t('exportPng')}</button>
      <button type="button" role="menuitem" className="aha-btn" data-kind="ghost" onClick={() => start('md')}>{t('exportMarkdown')}</button>
    </div> : null}
    {job ? createPortal(<div ref={pagesRef} className="aha-exportPages" aria-hidden="true">
      <BoardSheets steps={steps} title={title} theme={theme} font={font} footer={{ left: title, right: `${t('appName')} · ${t('appTagline')}` }} animationLabel={t('animationStill')} />
    </div>, document.body) : null}
  </span>
}
