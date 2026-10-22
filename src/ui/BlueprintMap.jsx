// A course outline drawn as a mind map (mindmap.js) that pans and zooms like
// the board's canvas. While a blueprint is being written (`live`), new nodes
// grow in and the view follows the newest one until the learner moves it;
// once written, the whole map is shown. onPick(key): a lesson was chosen.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { fitRect, keepInView, wheelPixels, wheelZoomFactor, zoomAt, ZOOM_STEP } from './board/camera.js'
import { useApp } from './hooks.js'
import { layoutMindMap } from './mindmap.js'

const MARGIN = 20
const TOOLBAR = 30

// The curve from a parent's right edge to a child's left edge.
function linkPath(from, to) {
  const x1 = from.x + from.w
  const y1 = from.y + from.h / 2
  const x2 = to.x
  const y2 = to.y + to.h / 2
  const mid = (x1 + x2) / 2
  return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
}

export function BlueprintMap({ tree, live = false, onPick, renderMeta }) {
  const { t } = useApp()
  const map = useMemo(() => layoutMindMap(tree), [tree])
  const byKey = useMemo(() => new Map(map.nodes.map(node => [node.key, node])), [map])
  const viewport = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: MARGIN, y: MARGIN, k: 1, animate: false })
  const [following, setFollowing] = useState(true)
  const state = useRef({ size, map, pointers: new Map(), drag: null })
  state.current.size = size
  state.current.map = map

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return undefined
    const update = () => setSize(previous => (previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight }))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const world = () => ({ width: state.current.map.width, height: state.current.map.height })
  const move = (next, { animate = false, manual = false } = {}) => {
    if (manual) setFollowing(false)
    setCamera(current => ({ ...keepInView(typeof next === 'function' ? next(current) : next, state.current.size, world(), 60), animate }))
  }
  // The whole map, with room above it for the toolbar.
  const showAll = (animate = true) => move(fitRect(state.current.size, { x: 0, y: -TOOLBAR, width: world().width, height: world().height + TOOLBAR }, { margin: MARGIN, maxZoom: 1 }), { animate })

  // The newest node in view, at a scale that keeps the map's width readable.
  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    if (!live) {
      showAll(false)
      return
    }
    if (!following) return
    const node = byKey.get(map.last)
    if (!node) return
    setCamera(current => {
      const k = Math.min(1, Math.max(0.55, (size.width - MARGIN * 2) / Math.max(1, map.width)))
      const x = Math.min(MARGIN, size.width - MARGIN - (node.x + node.w) * k)
      const bottom = (node.y + node.h) * k
      const y = Math.min(MARGIN + TOOLBAR, size.height - MARGIN * 2 - bottom)
      return current.k === k && current.x === x && current.y === y ? current : { x, y, k, animate: true }
    })
  }, [map, live, following, size.width, size.height])

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

  // Drag to pan (a lesson still takes a click); two fingers pinch to zoom.
  const onPointerDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target.closest?.('.aha-mapBar')) return
    state.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!state.current.drag) state.current.drag = { x: event.clientX, y: event.clientY, moved: false }
  }
  const onPointerMove = event => {
    const { pointers, drag } = state.current
    const previous = pointers.get(event.pointerId)
    if (!previous || !drag) return
    const current = { x: event.clientX, y: event.clientY }
    if (pointers.size === 1) {
      if (!drag.moved && Math.hypot(current.x - drag.x, current.y - drag.y) < 5) return
      if (!drag.moved) viewport.current?.setPointerCapture?.(event.pointerId)
      drag.moved = true
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
    const dragged = state.current.drag?.moved
    state.current.pointers.delete(event.pointerId)
    if (!state.current.pointers.size) state.current.drag = null
    // A press that did not move is a click on what it landed on.
    if (!dragged && onPick) {
      const key = event.target.closest?.('[data-pick]')?.dataset.pick
      if (key) onPick(key)
    }
  }
  const zoomBy = factor => move(current => zoomAt(current, state.current.size.width / 2, state.current.size.height / 2, factor), { animate: true, manual: true })

  return <div className="aha-map">
    <div ref={viewport} className="aha-mapView" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={() => showAll()}>
      <div className="aha-mapWorld" style={{ width: map.width, height: map.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`, transition: camera.animate ? 'transform .45s ease' : 'none' }}>
        <svg className="aha-mapLinks" width={map.width} height={map.height} aria-hidden="true">
          {map.links.map(link => {
            const from = byKey.get(link.from)
            const to = byKey.get(link.to)
            return from && to ? <path key={`${link.from}>${link.to}`} d={linkPath(from, to)} /> : null
          })}
        </svg>
        {map.nodes.map(node => <div key={node.key} className="aha-mapNode" data-level={node.level} data-pick={onPick && node.level === 3 ? node.key : undefined}
          style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h }} title={onPick && node.level === 3 ? t('mapPick') : undefined}>
          <span className="aha-mapTitle">{node.title}</span>
          {node.meta && renderMeta ? <span className="aha-mapMeta">{renderMeta(node.meta)}</span> : null}
        </div>)}
      </div>
    </div>
    <div className="aha-mapBar" role="toolbar" aria-label={t('mapTools')}>
      {live && !following ? <button type="button" className="aha-mapFollow" onClick={() => setFollowing(true)}>{t('mapFollow')}</button> : null}
      <button type="button" aria-label={t('canvasZoomOut')} title={t('canvasZoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
      <button type="button" className="aha-mapZoom" title={t('canvasZoomReset')} onClick={() => move(current => ({ ...zoomAt(current, state.current.size.width / 2, state.current.size.height / 2, 1 / current.k) }), { animate: true, manual: true })}>{Math.round(camera.k * 100)}%</button>
      <button type="button" aria-label={t('canvasZoomIn')} title={t('canvasZoomIn')} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
      <button type="button" title={t('canvasFit')} onClick={() => { setFollowing(false); showAll() }}>{t('canvasFitShort')}</button>
    </div>
  </div>
}
