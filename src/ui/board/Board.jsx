import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { chartSvg } from '../charts.js'
import { TeX } from '../math.jsx'
import { animationDocument, sanitizeSvg } from '../sanitize.js'
import { inlineLength, parseInline, sliceInline } from './inline.js'
import { layoutBoard } from './layout.js'

// position: { index, op, progress } from the player; null shows everything.
export function visibilityOf(entryStep, opIndex, position) {
  if (!position) return 1
  if (entryStep < position.index) return 1
  if (entryStep > position.index) return 0
  if (opIndex < position.op) return 1
  if (opIndex > position.op) return 0
  return position.progress
}

function Inline({ text, reveal = 1 }) {
  const segments = useMemo(() => parseInline(text), [text])
  const total = useMemo(() => inlineLength(segments), [segments])
  const shown = reveal >= 1 ? segments : sliceInline(segments, total * reveal)
  return shown.map((segment, index) => {
    if (segment.kind === 'math') return <TeX key={index} tex={segment.tex} />
    if (segment.kind === 'bold') return <strong key={index}>{segment.text}</strong>
    if (segment.kind === 'mark') return <mark key={index}>{segment.text}</mark>
    return <span key={index}>{segment.text}</span>
  })
}

// Draw an SVG stroke by stroke, then fade fills and labels in.
function DrawnSvg({ markup, reveal, caption }) {
  const host = useRef(null)
  const safe = useMemo(() => sanitizeSvg(markup), [markup])
  useLayoutEffect(() => {
    const root = host.current?.querySelector('svg')
    if (!root) return
    const shapes = [...root.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')]
    const labels = [...root.querySelectorAll('text')]
    const strokeShare = labels.length ? 0.8 : 1
    shapes.forEach((shape, index) => {
      let length = 0
      try {
        length = shape.getTotalLength?.() ?? 0
      } catch {
        length = 0
      }
      const start = (index / Math.max(1, shapes.length)) * strokeShare
      const end = ((index + 1) / Math.max(1, shapes.length)) * strokeShare
      const local = Math.min(1, Math.max(0, (reveal - start) / Math.max(0.0001, end - start)))
      if (length > 0) {
        shape.style.strokeDasharray = `${length}`
        shape.style.strokeDashoffset = `${length * (1 - local)}`
      }
      shape.style.fillOpacity = local >= 1 ? '' : String(local * 0.6)
      if (!length) shape.style.opacity = String(local)
    })
    const labelProgress = labels.length ? Math.min(1, Math.max(0, (reveal - strokeShare) / (1 - strokeShare))) : 1
    labels.forEach(label => { label.style.opacity = String(reveal >= 1 ? 1 : labelProgress) })
  }, [reveal, safe])
  if (!safe) return null
  return <div className="aha-op-figure">
    <div ref={host} dangerouslySetInnerHTML={{ __html: safe }} />
    {caption ? <div className="aha-figCaption" style={{ opacity: reveal >= 1 ? 1 : 0.4 }}>{caption}</div> : null}
  </div>
}

// op.height is the height the animation wants at a 560 px wide board column;
// narrower columns scale it down so the frame keeps the content's proportions.
function Animation({ op, reveal, theme }) {
  const srcDoc = useMemo(() => animationDocument(op.html, theme), [op.html, theme])
  const frame = useRef(null)
  const [height, setHeight] = useState(op.height)
  useLayoutEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver !== 'function') return undefined
    const update = () => setHeight(Math.round(Math.max(120, Math.min(op.height, (op.height * element.clientWidth) / 560))))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [op.height, reveal > 0])
  if (reveal <= 0) return null
  return <div className="aha-op-figure" style={{ opacity: Math.min(1, reveal * 3) }}>
    <iframe ref={frame} className="aha-op-anim" title={op.caption || 'animation'} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ height, colorScheme: theme === 'dark' ? 'dark' : 'light' }} />
    {op.caption ? <div className="aha-figCaption">{op.caption}</div> : null}
  </div>
}

function OpView({ op, reveal, marks, aside, opRef, theme }) {
  const style = { '--reveal': `${Math.round(reveal * 1000) / 10}%` }
  const markDecor = marks.map(mark => <span key={mark.id} className={mark.style === 'circle' ? 'aha-markRing' : mark.style === 'box' ? 'aha-markBox' : 'aha-markLine'} style={{ opacity: mark.reveal, clipPath: `inset(0 ${100 - mark.reveal * 100}% 0 0)` }} />)
  let body
  switch (op.t) {
    case 'h':
      body = <div className="aha-op-h"><span><Inline text={op.text} reveal={reveal} /></span></div>
      break
    case 'p':
      body = <div className="aha-op-p"><Inline text={op.text} reveal={reveal} /></div>
      break
    case 'math':
      body = <div className="aha-op-math aha-reveal" style={style}><TeX tex={op.tex} display /></div>
      break
    case 'list': {
      const total = op.items.reduce((sum, item) => sum + inlineLength(parseInline(item)), 0)
      let budget = total * reveal
      const Tag = op.ordered ? 'ol' : 'ul'
      body = <Tag className="aha-op-list">{op.items.map((item, index) => {
        const length = inlineLength(parseInline(item))
        const local = reveal >= 1 ? 1 : Math.max(0, Math.min(1, budget / Math.max(1, length)))
        budget -= length
        return local > 0 ? <li key={index}><Inline text={item} reveal={local} /></li> : null
      })}</Tag>
      break
    }
    case 'note':
      body = <div className="aha-op-note" data-tone={op.tone}><Inline text={op.text} reveal={reveal} /></div>
      break
    case 'svg':
      body = <DrawnSvg markup={op.svg} reveal={reveal} caption={op.caption} />
      break
    case 'chart':
      body = <DrawnSvg markup={chartSvg(op)} reveal={reveal} caption="" />
      break
    case 'table': {
      const rows = reveal >= 1 ? op.rows.length : Math.floor(op.rows.length * reveal)
      body = <table className="aha-op-table">
        {op.head.length ? <thead><tr>{op.head.map((cell, index) => <th key={index}><Inline text={cell} /></th>)}</tr></thead> : null}
        <tbody>{op.rows.slice(0, rows).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}><Inline text={cell} /></td>)}</tr>)}</tbody>
      </table>
      break
    }
    case 'code': {
      const lines = op.code.split('\n')
      const shown = reveal >= 1 ? lines : lines.slice(0, Math.ceil(lines.length * reveal))
      body = <div><pre className="aha-op-code">{shown.join('\n')}</pre>{op.caption ? <div className="aha-figCaption">{op.caption}</div> : null}</div>
      break
    }
    case 'anim':
      body = <Animation op={op} reveal={reveal} theme={theme} />
      break
    default:
      body = null
  }
  return <div ref={opRef} className="aha-op" data-t={op.t} data-aside={aside ? 'true' : undefined} data-op={op.id}>
    {body}
    {markDecor}
  </div>
}

function Pencil({ target, active, stage }) {
  const [point, setPoint] = useState(null)
  useLayoutEffect(() => {
    const element = target?.current
    const container = stage?.current
    if (!active || !element || !container) {
      setPoint(previous => (previous === null ? previous : null))
      return
    }
    const box = element.getBoundingClientRect()
    const base = container.getBoundingClientRect()
    const spans = element.querySelectorAll('span,strong,mark,li,td,pre,.katex')
    const last = spans[spans.length - 1]
    const lastBox = last?.getBoundingClientRect()
    const x = lastBox && lastBox.width ? lastBox.right : box.left + box.width * active.progress
    const y = lastBox && lastBox.height ? lastBox.bottom - 4 : box.top + box.height / 2
    const next = { left: Math.round(x - base.left + container.scrollLeft), top: Math.round(y - base.top + container.scrollTop) }
    // Same spot: keep the old object so React skips the re-render.
    setPoint(previous => (previous && previous.left === next.left && previous.top === next.top ? previous : next))
  })
  if (!point) return null
  return <svg className="aha-pencil" style={point} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" fill="var(--pencil)" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M14.5 6.5l2.5 2.5 2-2a1.77 1.77 0 0 0-2.5-2.5l-2 2z" fill="var(--accent)" stroke="var(--ink)" strokeWidth="1.2" />
  </svg>
}

// steps: normalized board steps (may still be growing).
// position: player position, or null to show the whole board.
export function Board({ steps, position, theme = 'light', buffering = false, bufferingLabel = '' }) {
  const layout = useMemo(() => layoutBoard(steps), [steps])
  const opMeta = useMemo(() => {
    const meta = new Map()
    steps.forEach((step, stepIndex) => step.ops.forEach((op, opIndex) => meta.set(op.id, { stepIndex, opIndex, aside: step.aside === true })))
    return meta
  }, [steps])

  const activeOp = position && steps[position.index]?.ops[position.op]
  const activePage = activeOp ? layout.where.get(activeOp.id)?.page ?? 0 : position ? lastVisiblePage(layout, steps, position) : 0
  const [viewPage, setViewPage] = useState(null)
  useEffect(() => { setViewPage(null) }, [activePage])
  const pageIndex = Math.min(layout.pages.length - 1, viewPage ?? activePage)
  const page = layout.pages[pageIndex]

  const reveal = opId => {
    const meta = opMeta.get(opId)
    return meta ? visibilityOf(meta.stepIndex, meta.opIndex, position) : 0
  }

  // Marks drawn so far, grouped by the op they decorate.
  const marks = new Map()
  steps.forEach(step => step.ops.forEach(op => {
    if (op.t !== 'mark') return
    const amount = reveal(op.id)
    if (amount <= 0) return
    const list = marks.get(op.ref) ?? []
    list.push({ id: op.id, style: op.style, reveal: amount })
    marks.set(op.ref, list)
  }))

  const titleOp = steps.flatMap(step => step.ops).find(op => op.t === 'title' && layout.where.get(op.id)?.page === pageIndex)
  const titleReveal = titleOp ? reveal(titleOp.id) : 1
  const stage = useRef(null)
  const activeRef = useRef(null)
  const pagesWithContent = layout.pages.map((item, index) => index).filter(index => index <= Math.max(activePage, viewPage ?? 0) || !position)

  return <div className="aha-board" data-theme={theme}>
    {pagesWithContent.length > 1 ? <div className="aha-pager">
      {pagesWithContent.map(index => <button key={index} type="button" data-active={index === pageIndex} onClick={() => setViewPage(index)}>{index + 1}</button>)}
    </div> : null}
    <div className="aha-boardScroll" ref={stage}>
      {page?.title && titleReveal > 0 ? <h2 className="aha-boardTitle"><span><Inline text={page.title} reveal={titleReveal} /></span></h2> : null}
      <div className="aha-cols">
        {page?.columns.map((column, columnIndex) => <div className="aha-colBody" key={columnIndex}>
          {column.map(({ op }) => {
            const amount = reveal(op.id)
            if (amount <= 0) return null
            const isActive = activeOp?.id === op.id && amount < 1
            return <OpView key={op.id} op={op} reveal={amount} marks={marks.get(op.id) ?? []} aside={opMeta.get(op.id)?.aside} opRef={isActive ? activeRef : undefined} theme={theme} />
          })}
        </div>)}
      </div>
      <Pencil target={activeRef} stage={stage} active={activeOp && position && position.progress < 1 && ['p', 'h', 'list', 'note', 'math', 'title'].includes(activeOp.t) ? position : null} />
    </div>
    {buffering ? <div className="aha-buffering"><span className="aha-spinner" />{bufferingLabel}</div> : null}
  </div>
}

function lastVisiblePage(layout, steps, position) {
  let page = 0
  steps.forEach((step, stepIndex) => step.ops.forEach((op, opIndex) => {
    if (visibilityOf(stepIndex, opIndex, position) > 0) page = Math.max(page, layout.where.get(op.id)?.page ?? 0)
  }))
  return page
}
