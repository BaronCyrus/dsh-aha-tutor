// A short guided tour of the classroom: one part at a time is lit up, with a
// card saying what it is for. root: the classroom element; onDone: the tour
// was finished or skipped. Arrow keys and Enter move through it, Escape skips.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useApp } from './hooks.js'
import { CLASSROOM_TOUR, tourHole, tourPlacement } from './tour.js'

export function ClassroomTour({ root, onDone }) {
  const { t } = useApp()
  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState(null)
  const card = useRef(null)
  // Only the steps whose part is on screen.
  const [steps] = useState(() => CLASSROOM_TOUR.filter(step => root.current?.querySelector(step.target)))
  const step = steps[index]

  useLayoutEffect(() => {
    const element = root.current
    if (!element || !step) return undefined
    const measure = () => {
      const target = element.querySelector(step.target)
      if (!target) return
      const base = element.getBoundingClientRect()
      const box = target.getBoundingClientRect()
      const size = { width: base.width, height: base.height }
      const hole = tourHole({ x: box.left - base.left, y: box.top - base.top, width: box.width, height: box.height }, size)
      const own = card.current?.getBoundingClientRect()
      const place = tourPlacement(hole, { width: own?.width ?? 320, height: own?.height ?? 150 }, size)
      setFrame({ hole, place })
    }
    element.querySelector(step.target)?.scrollIntoView?.({ block: 'nearest' })
    measure()
    // Again once the card has its real size, and whenever the room changes.
    const raf = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [index, step])

  const next = () => (index + 1 < steps.length ? setIndex(index + 1) : onDone())
  const back = () => setIndex(Math.max(0, index - 1))

  // The tour has the keyboard while it is open (the classroom's own keys wait).
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') onDone()
      else if (event.key === 'ArrowRight' || event.key === 'Enter') next()
      else if (event.key === 'ArrowLeft') back()
      else if (event.key !== ' ') return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => { if (!step) onDone() }, [step])
  if (!step) return null
  return <div className="aha-tour" role="dialog" aria-modal="true" aria-label={t('tourLabel')}>
    {frame ? <div className="aha-tourHole" style={{ left: frame.hole.x, top: frame.hole.y, width: frame.hole.width, height: frame.hole.height }} /> : null}
    <div ref={card} className="aha-tourCard" data-side={frame?.place.side} style={frame ? { left: frame.place.x, top: frame.place.y } : { visibility: 'hidden' }}>
      <b>{t(step.title)}</b>
      <p>{t(step.text)}</p>
      <div className="aha-tourActions">
        <span className="aha-hint">{index + 1} / {steps.length}</span>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onDone}>{t('tourSkip')}</button>
        {index > 0 ? <button type="button" className="aha-btn" data-size="sm" onClick={back}>{t('tourBack')}</button> : null}
        <button type="button" className="aha-btn" data-kind="primary" data-size="sm" autoFocus onClick={next}>{index + 1 < steps.length ? t('tourNext') : t('tourStart')}</button>
      </div>
    </div>
  </div>
}
