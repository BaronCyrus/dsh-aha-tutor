import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultValues, formatPlotNumber } from '../../core/plot.js'
import { chartSvg } from '../charts.js'
import { useApp } from '../hooks.js'
import { TeX } from '../math.jsx'
import { plotSvg, preparePlot } from '../plot.js'
import { animationDocument, sanitizeSvg } from '../sanitize.js'
import { followShift, fitRect, keepInView, wheelPixels, wheelZoomFactor, zoomAt, ZOOM_STEP } from './camera.js'
import { fitFormula, formulaLines, writtenPart } from './fit.js'
import { inlineLength, parseInline, sliceInline } from './inline.js'
import { boardText, layoutBoard } from './layout.js'

// position: { index, op, progress } from the player; null shows everything.
export function visibilityOf(entryStep, opIndex, position) {
  if (!position) return 1
  if (entryStep < position.index) return 1
  if (entryStep > position.index) return 0
  if (opIndex < position.op) return 1
  if (opIndex > position.op) return 0
  return position.progress
}

export function Inline({ text, reveal = 1 }) {
  const segments = useMemo(() => parseInline(text), [text])
  const total = useMemo(() => inlineLength(segments), [segments])
  const shown = reveal >= 1 ? segments : sliceInline(segments, total * reveal)
  return shown.map((segment, index) => {
    if (segment.kind === 'math') {
      const formula = <TeX key={index} tex={segment.tex} />
      if (segment.style === 'mark') return <mark key={index}>{formula}</mark>
      if (segment.style === 'bold') return <strong key={index}>{formula}</strong>
      return formula
    }
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
      // Once a stroke is drawn it gets its own dash pattern back, so dashed
      // guide lines stay dashed.
      if (length > 0 && local < 1) {
        shape.style.strokeDasharray = `${length}`
        shape.style.strokeDashoffset = `${length * (1 - local)}`
      } else {
        shape.style.strokeDasharray = ''
        shape.style.strokeDashoffset = ''
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

// A function plot, computed from its formulas. Its sliders, when it has any
// and is not an export, move the curves; touching one pauses the lesson.
function PlotFigure({ op, reveal, still, onInteract }) {
  const prepared = useMemo(() => preparePlot(op), [op])
  const [values, setValues] = useState(() => defaultValues(op))
  // A plot that changes (a corrected one) starts again from its defaults.
  const shape = JSON.stringify([op.fns, op.params])
  useEffect(() => { setValues(defaultValues(op)) }, [shape])
  const markup = useMemo(() => (prepared ? plotSvg(op, values, { prepared }) : ''), [op, prepared, values])
  if (!prepared) return null
  const slide = (index, value) => {
    onInteract?.()
    setValues(current => current.map((item, position) => (position === index ? value : item)))
  }
  const written = reveal >= 1
  return <div className="aha-plot">
    <DrawnSvg markup={markup} reveal={reveal} caption="" />
    {!still && op.params.length ? <div className="aha-plotSliders" data-written={written} aria-hidden={!written}>
      {op.params.map((param, index) => <label key={param.name} className="aha-plotSlider">
        <span className="aha-plotName">{param.label || param.name}</span>
        <input type="range" min={param.min} max={param.max} step={param.step} value={values[index] ?? param.value} disabled={!written}
          onPointerDown={() => onInteract?.()} onChange={event => slide(index, Number(event.currentTarget.value))} />
        <span className="aha-plotValue">{formatPlotNumber(values[index] ?? param.value)}</span>
      </label>)}
    </div> : null}
    {op.caption ? <div className="aha-figCaption" style={{ opacity: written ? 1 : 0.4 }}>{op.caption}</div> : null}
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

// A display formula fitted to its column (fit.js): again when the column
// changes width and when fonts arrive, since both move KaTeX's layout. It is
// written line by line; data-pen tells the pencil where.
function Formula({ tex, reveal }) {
  const box = useRef(null)
  const [lines, setLines] = useState([])
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    let width = -1
    const layout = () => {
      width = element.clientWidth
      fitFormula(element)
      setLines(formulaLines(element))
    }
    layout()
    // A new font size changes only the height, so width alone says the column
    // moved. Fitting resizes the formula, which the observer must not see
    // while it is still delivering (the browser reports a loop), so it waits
    // for the next frame.
    let frame = 0
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (element.clientWidth === width) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }) : null
    observer?.observe(element)
    const fonts = typeof document !== 'undefined' ? document.fonts : null
    fonts?.addEventListener?.('loadingdone', layout)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      fonts?.removeEventListener?.('loadingdone', layout)
    }
  }, [tex])
  const { clip, pen } = writtenPart(lines, reveal)
  return <div ref={box} className="aha-op-math" style={clip ? { clipPath: clip } : undefined} data-pen={pen ? `${Math.round(pen.x)} ${Math.round(pen.y)}` : undefined}>
    <TeX tex={tex} display />
  </div>
}

// Exports cannot run an animation: they show its poster, or a labelled frame.
function AnimationStill({ op, label }) {
  if (op.poster) return <DrawnSvg markup={op.poster} reveal={1} caption={op.caption} />
  return <div className="aha-op-note" data-tone="tip">▶ {op.caption || label}</div>
}

// fixedNote(op): the badge of an op corrected after the learner challenged
// it ({ label, title }), when the view shows one.
function OpView({ op, reveal, marks, aside, now, opRef, theme, still = false, animationLabel = '', onInteract, fixedNote }) {
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
      body = <Formula tex={op.tex} reveal={reveal} />
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
    case 'plot':
      body = <PlotFigure op={op} reveal={reveal} still={still} onInteract={onInteract} />
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
      body = still ? <AnimationStill op={op} label={animationLabel} /> : <Animation op={op} reveal={reveal} theme={theme} />
      break
    default:
      body = null
  }
  const fixed = op.fixed && fixedNote && reveal >= 1 ? fixedNote(op) : null
  return <div ref={opRef} className="aha-op" data-t={op.t} data-aside={aside ? 'true' : undefined} data-now={now ? 'true' : undefined} data-op={op.id}>
    {body}
    {markDecor}
    {fixed ? <span className="aha-fixed" title={fixed.title}>✎ {fixed.label}</span> : null}
  </div>
}

// The pencil sits where the writing is. stage: the element it is placed in;
// scale: how much that element is zoomed (the canvas), so screen distances
// turn back into its own; scrolls: add the stage's scroll offset (pages).
function Pencil({ target, active, stage, scale = 1, scrolls = false }) {
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
    // Text is cut where the pencil is; a formula is drawn whole and clipped,
    // so it names the spot itself.
    const formula = element.querySelector('.aha-op-math')
    const spans = formula ? [] : element.querySelectorAll('span,strong,mark,li,td,pre')
    const last = spans[spans.length - 1]
    const lastBox = last?.getBoundingClientRect()
    let x = lastBox && lastBox.width ? lastBox.right : box.left + box.width * active.progress
    let y = lastBox && lastBox.height ? lastBox.bottom - 4 * scale : box.top + box.height / 2
    if (formula?.dataset.pen) {
      const [penX, penY] = formula.dataset.pen.split(' ').map(Number)
      const at = formula.getBoundingClientRect()
      x = at.left + penX * scale
      y = at.top + (penY - 4) * scale
    }
    // The pencil glides from letter to letter; along a formula it moves every
    // frame, and a glide restarted every frame would never get anywhere.
    const next = {
      left: Math.round((x - base.left) / scale + (scrolls ? container.scrollLeft : 0)),
      top: Math.round((y - base.top) / scale + (scrolls ? container.scrollTop : 0)),
      glide: !formula,
    }
    // Same spot: keep the old object so React skips the re-render.
    setPoint(previous => (previous && previous.left === next.left && previous.top === next.top && previous.glide === next.glide ? previous : next))
  })
  if (!point) return null
  return <svg className="aha-pencil" style={{ left: point.left, top: point.top }} data-glide={point.glide} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" fill="var(--pencil)" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M14.5 6.5l2.5 2.5 2-2a1.77 1.77 0 0 0-2.5-2.5l-2 2z" fill="var(--accent)" stroke="var(--ink)" strokeWidth="1.2" />
  </svg>
}

const PENCIL_OPS = new Set(['p', 'h', 'list', 'note', 'math', 'title'])

// One page as written so far: its title and two columns of ops.
function PageContent({ page, title, board, activeRef }) {
  const { reveal, marks, nowIds, opMeta, activeOp, theme, onInteract, fixedNote } = board
  const titleReveal = title ? reveal(title.id) : 1
  return <>
    {page.title && titleReveal > 0 ? <h2 className="aha-boardTitle"><span><Inline text={page.title} reveal={titleReveal} /></span></h2> : null}
    <div className="aha-cols">
      {page.columns.map((column, columnIndex) => <div className="aha-colBody" key={columnIndex}>
        {column.map(({ op }) => {
          const amount = reveal(op.id)
          if (amount <= 0) return null
          const isActive = activeOp?.id === op.id && amount < 1
          return <OpView key={op.id} op={op} reveal={amount} marks={marks.get(op.id) ?? []} aside={opMeta.get(op.id)?.aside} now={nowIds.has(op.id)} opRef={isActive ? activeRef : undefined} theme={theme} onInteract={onInteract} fixedNote={fixedNote} />
        })}
      </div>)}
    </div>
  </>
}

// Everything that shows on a page as one string: a canvas frame whose
// signature has not changed skips re-rendering while another page is written.
function pageSignature(page, title, board) {
  const { reveal, marks, nowIds } = board
  const parts = [title ? `t${Math.round(reveal(title.id) * 1000)}` : '']
  for (const column of page.columns) {
    for (const { op } of column) {
      const amount = Math.round(reveal(op.id) * 1000)
      if (amount <= 0) continue
      parts.push(`${op.id}:${amount}${nowIds.has(op.id) ? '*' : ''}${(marks.get(op.id) ?? []).map(mark => `/${mark.id}:${Math.round(mark.reveal * 1000)}`).join('')}`)
    }
  }
  return parts.join(' ')
}

const PageFrame = memo(function PageFrame({ index, page, title, board, activeRef, label }) {
  return <section className="aha-frame" data-frame={index} aria-label={label}>
    <PageContent page={page} title={title} board={board} activeRef={activeRef} />
  </section>
}, (before, after) => before.signature === after.signature && before.page === after.page && before.activeRef === after.activeRef && before.board.theme === after.board.theme && before.label === after.label)

// One page at a time, with a pager; the page scrolls when it is taller than
// the board.
function PagedView({ board, layout, position, activePage, pencil }) {
  const { activeOp } = board
  const [viewPage, setViewPage] = useState(null)
  useEffect(() => { setViewPage(null) }, [activePage])
  const pageIndex = Math.min(layout.pages.length - 1, viewPage ?? activePage)
  const page = layout.pages[pageIndex]
  const stage = useRef(null)
  const activeRef = useRef(null)

  // Keep what is being written in view: a long page, or a narrow board that
  // stacks its columns, can run past the bottom of the stage.
  const followKey = activeOp ? `${activeOp.id}:${Math.round((position?.progress ?? 0) * 4)}` : ''
  useEffect(() => {
    const container = stage.current
    const element = activeOp ? container?.querySelector(`[data-op="${activeOp.id}"]`) : null
    if (!container || !element) return
    const box = element.getBoundingClientRect()
    const view = container.getBoundingClientRect()
    if (box.bottom > view.bottom - 24) container.scrollTo({ top: container.scrollTop + box.bottom - view.bottom + 56, behavior: 'smooth' })
    else if (box.top < view.top + 8) container.scrollTo({ top: Math.max(0, container.scrollTop - (view.top - box.top) - 24), behavior: 'smooth' })
  }, [followKey, pageIndex])
  const pagesWithContent = layout.pages.map((item, index) => index).filter(index => index <= Math.max(activePage, viewPage ?? 0) || !position)

  return <>
    {pagesWithContent.length > 1 ? <div className="aha-pager">
      {pagesWithContent.map(index => <button key={index} type="button" data-active={index === pageIndex} onClick={() => setViewPage(index)}>{index + 1}</button>)}
    </div> : null}
    <div className="aha-boardScroll" ref={stage}>
      {page ? <PageContent page={page} title={board.titles.get(pageIndex)} board={board} activeRef={activeRef} /> : null}
      <Pencil target={activeRef} stage={stage} scrolls active={pencil} />
    </div>
  </>
}

const MARGIN = 16

// Every page written so far as a frame, top to bottom, on a canvas that pans
// and zooms. The camera follows the writing until the learner moves it, and
// "back to the teacher" hands it back.
function CanvasView({ board, layout, position, activePage, pencil }) {
  const { t } = useApp()
  const { activeOp } = board
  const viewport = useRef(null)
  const world = useRef(null)
  const activeRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: MARGIN, y: MARGIN, k: 1, animate: false })
  const [following, setFollowing] = useState(true)
  const [panning, setPanning] = useState(false)
  const state = useRef({ camera, size, pointers: new Map(), drag: null })
  const shownPage = useRef(-1)
  state.current.camera = camera
  state.current.size = size

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return undefined
    const update = () => setSize(previous => (previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight }))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const frameWidth = Math.max(240, size.width - MARGIN * 2)
  const worldBox = () => ({ width: world.current?.offsetWidth ?? frameWidth, height: world.current?.offsetHeight ?? 0 })
  const move = (next, { animate = false, manual = false } = {}) => {
    if (manual) setFollowing(false)
    setCamera(current => ({ ...keepInView(typeof next === 'function' ? next(current) : next, state.current.size, worldBox()), animate }))
  }

  // Wheel and trackpad: scroll to pan, ctrl/⌘ (or a pinch) to zoom. Listened
  // to directly, since React's wheel listener cannot prevent the page from
  // scrolling.
  useEffect(() => {
    const element = viewport.current
    if (!element) return undefined
    const onWheel = event => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const delta = wheelPixels(event, box.height)
      if (event.ctrlKey || event.metaKey) move(current => zoomAt(current, event.clientX - box.left, event.clientY - box.top, wheelZoomFactor(delta.y)), { manual: true })
      else move(current => ({ ...current, x: current.x - (event.shiftKey ? delta.y : delta.x), y: current.y - (event.shiftKey ? 0 : delta.y) }), { manual: true })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // Drag with a mouse or one finger to pan; two fingers pinch to zoom.
  const onPointerDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target.closest?.('button,a,input,textarea,select,iframe,.aha-canvasBar')) return
    state.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!state.current.drag) state.current.drag = { x: event.clientX, y: event.clientY, moved: false }
    viewport.current?.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = event => {
    const { pointers, drag } = state.current
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const current = { x: event.clientX, y: event.clientY }
    if (pointers.size === 1) {
      if (!drag.moved && Math.hypot(current.x - drag.x, current.y - drag.y) < 4) return
      drag.moved = true
      setPanning(true)
      pointers.set(event.pointerId, current)
      move(camera0 => ({ ...camera0, x: camera0.x + current.x - previous.x, y: camera0.y + current.y - previous.y }), { manual: true })
      return
    }
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
    pointers.set(event.pointerId, current)
    if (!other) return
    const box = viewport.current.getBoundingClientRect()
    const before = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2, d: Math.hypot(previous.x - other.x, previous.y - other.y) }
    const after = { x: (current.x + other.x) / 2, y: (current.y + other.y) / 2, d: Math.hypot(current.x - other.x, current.y - other.y) }
    drag.moved = true
    move(camera0 => {
      const zoomed = zoomAt(camera0, before.x - box.left, before.y - box.top, after.d / Math.max(1, before.d))
      return { ...zoomed, x: zoomed.x + after.x - before.x, y: zoomed.y + after.y - before.y }
    }, { manual: true })
  }
  const onPointerUp = event => {
    state.current.pointers.delete(event.pointerId)
    if (!state.current.pointers.size) {
      state.current.drag = null
      setPanning(false)
    }
  }

  const fit = (rect, maxZoom) => move(fitRect(state.current.size, rect, { margin: MARGIN, maxZoom }), { animate: true, manual: true })
  const onDoubleClick = event => {
    const frame = event.target.closest?.('.aha-frame')
    if (frame) fit({ x: frame.offsetLeft, y: frame.offsetTop, width: frame.offsetWidth, height: frame.offsetHeight })
  }
  const zoomBy = factor => move(current => zoomAt(current, state.current.size.width / 2, state.current.size.height / 2, factor), { animate: true, manual: true })
  const showAll = () => fit({ x: 0, y: 0, ...worldBox() }, 1)
  const resetZoom = () => move(current => ({ ...zoomAt(current, state.current.size.width / 2, state.current.size.height / 2, 1 / current.k), x: MARGIN }), { animate: true, manual: true })

  // Follow the writing: 100 %, the board's width, and the line being written
  // in view. A mark follows the op it marks; a page or a column that has just
  // begun shows from the top of its page. Between ops (the teacher is still
  // talking, or waits for a check) the last thing written on the page is the
  // place to come back to.
  const followKey = activeOp ? `${activeOp.id}:${Math.round((position?.progress ?? 0) * 4)}` : `page:${activePage}`
  useLayoutEffect(() => {
    if (!following || !position || !size.height) return
    const frame = world.current?.querySelector(`[data-frame="${activePage}"]`)
    if (!frame) return
    const targetId = activeOp?.t === 'mark' ? activeOp.ref : activeOp?.id
    const written = frame.querySelectorAll('[data-op]')
    const element = targetId ? world.current.querySelector(`[data-op="${targetId}"]`) : activeOp ? null : written[written.length - 1] ?? null
    let top = frame.offsetTop
    for (let node = element; node && node !== frame; node = node.offsetParent) top += node.offsetTop
    const height = element?.offsetHeight ?? 0
    const newPage = shownPage.current !== activePage
    shownPage.current = activePage
    setCamera(current => {
      const base = current.k === 1 && current.x === MARGIN ? current : { x: MARGIN, y: current.y, k: 1 }
      let y = base.y
      if (newPage || !element) y += MARGIN - (y + frame.offsetTop)
      if (element) y += followShift(state.current.size, { top: y + top, height })
      if (y === current.y && base === current) return current
      return { ...base, y, animate: true }
    })
  }, [followKey, activePage, following, size.width, size.height])

  const shown = layout.pages.map((page, index) => index).filter(index => !position || index <= activePage)
  return <>
    <div ref={viewport} className="aha-canvas" data-panning={panning ? 'true' : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
      <div ref={world} className="aha-canvasWorld" style={{ width: frameWidth, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`, transition: camera.animate ? 'transform .45s ease' : 'none' }}>
        {shown.map(index => <PageFrame key={index} index={index} page={layout.pages[index]} title={board.titles.get(index)} board={board}
          signature={pageSignature(layout.pages[index], board.titles.get(index), board)} activeRef={index === activePage ? activeRef : null} label={t('canvasPage', { n: index + 1 })} />)}
        <Pencil target={activeRef} stage={world} scale={camera.k} active={pencil} />
      </div>
    </div>
    <div className="aha-canvasBar" role="toolbar" aria-label={t('canvasTools')} title={t('canvasHelp')}>
      {!following && position ? <button type="button" className="aha-canvasFollow" onClick={() => setFollowing(true)}>{t('canvasFollow')}</button> : null}
      <button type="button" aria-label={t('canvasZoomOut')} title={t('canvasZoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
      <button type="button" className="aha-canvasZoom" title={t('canvasZoomReset')} onClick={resetZoom}>{Math.round(camera.k * 100)}%</button>
      <button type="button" aria-label={t('canvasZoomIn')} title={t('canvasZoomIn')} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
      <button type="button" title={t('canvasFit')} onClick={showAll}>{t('canvasFitShort')}</button>
    </div>
  </>
}

// steps: normalized board steps (may still be growing).
// position: player position, or null to show the whole board.
// font: 'hand' (the bundled handwriting fonts) or 'standard' (the app's font).
// view: 'canvas' (all pages on a canvas that pans and zooms) or 'pages' (one
// page at a time with a pager).
// onInteract: the learner touched something on the board (a plot's slider).
export function Board({ steps, position, theme = 'light', font = 'hand', buffering = false, bufferingLabel = '', view = 'canvas', onInteract }) {
  const { t } = useApp()
  const layout = useMemo(() => layoutBoard(steps), [steps])
  const text = useMemo(() => (font === 'hand' ? boardText(steps) : ''), [steps, font])
  useEffect(() => {
    if (!text || typeof document === 'undefined' || !document.fonts?.load) return
    for (const family of ['Aha Hand Latin', 'Aha Hand']) document.fonts.load(`20px '${family}'`, text).catch(() => undefined)
  }, [text])
  const opMeta = useMemo(() => {
    const meta = new Map()
    steps.forEach((step, stepIndex) => step.ops.forEach((op, opIndex) => meta.set(op.id, { stepIndex, opIndex, aside: step.aside === true })))
    return meta
  }, [steps])
  // Each page's title op, which reveals its heading.
  const titles = useMemo(() => {
    const byPage = new Map()
    for (const step of steps) for (const op of step.ops) if (op.t === 'title') { const where = layout.where.get(op.id); if (where && !byPage.has(where.page)) byPage.set(where.page, op) }
    return byPage
  }, [steps, layout])

  const activeOp = position && steps[position.index]?.ops[position.op]
  const activePage = activeOp ? layout.where.get(activeOp.id)?.page ?? 0 : position ? lastVisiblePage(layout, steps, position) : 0

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

  // What the narration is talking about right now (synced steps only).
  const nowIds = new Set(position?.now ?? [])
  const fixedNote = op => ({ label: t('fixed'), title: t('fixedWas', { was: op.fixed.was }) })
  const board = { reveal, marks, nowIds, opMeta, activeOp, theme, titles, onInteract, fixedNote }
  const pencil = activeOp && position && position.progress < 1 && PENCIL_OPS.has(activeOp.t) ? position : null
  const View = view === 'pages' ? PagedView : CanvasView

  return <div className="aha-board" data-theme={theme} data-font={font} data-view={view === 'pages' ? 'pages' : 'canvas'}>
    <View board={board} layout={layout} position={position} activePage={activePage} pencil={pencil} />
    {buffering ? <div className="aha-buffering"><span className="aha-spinner" />{bufferingLabel}</div> : null}
  </div>
}

// Every page of a board fully written, for PDF and PNG exports: the same
// pages, columns and styles as the board, without the pager, the pencil or
// scrolling. Pages with nothing on them are left out; the first page shows
// `title` when the board names none. footer: { left, right } beside the
// page number.
export function BoardSheets({ steps, title = '', theme = 'light', font = 'hand', footer = {}, animationLabel = '', fixedLabel = '' }) {
  const layout = useMemo(() => layoutBoard(steps), [steps])
  const asides = useMemo(() => new Set(steps.flatMap(step => (step.aside ? step.ops.map(op => op.id) : []))), [steps])
  const marks = useMemo(() => {
    const byOp = new Map()
    for (const step of steps) for (const op of step.ops) if (op.t === 'mark') byOp.set(op.ref, [...(byOp.get(op.ref) ?? []), { id: op.id, style: op.style, reveal: 1 }])
    return byOp
  }, [steps])
  const pages = layout.pages.filter(page => page.columns.some(column => column.length))
  return pages.map((page, index) => {
    const heading = page.title || (index === 0 ? title : '')
    return <div key={index} className="aha-board aha-exportPage" data-theme={theme} data-font={font} data-sheet={index}>
      {heading ? <h2 className="aha-boardTitle"><span><Inline text={heading} /></span></h2> : null}
      <div className="aha-cols">
        {page.columns.map((column, columnIndex) => <div className="aha-colBody" key={columnIndex}>
          {column.map(({ op }) => <OpView key={op.id} op={op} reveal={1} marks={marks.get(op.id) ?? []} aside={asides.has(op.id)} now={false} theme={theme} still animationLabel={animationLabel} fixedNote={fixedLabel ? () => ({ label: fixedLabel }) : undefined} />)}
        </div>)}
      </div>
      <div className="aha-exportFoot"><span>{footer.left ?? ''}</span><span>{[footer.right, `${index + 1} / ${pages.length}`].filter(Boolean).join(' · ')}</span></div>
    </div>
  })
}

function lastVisiblePage(layout, steps, position) {
  let page = 0
  steps.forEach((step, stepIndex) => step.ops.forEach((op, opIndex) => {
    if (visibilityOf(stepIndex, opIndex, position) > 0) page = Math.max(page, layout.where.get(op.id)?.page ?? 0)
  }))
  return page
}
