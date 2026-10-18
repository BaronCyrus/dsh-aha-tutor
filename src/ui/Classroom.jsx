import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Board } from './board/Board.jsx'
import { inlinePlain } from './board/inline.js'
import { reidSteps } from './board/layout.js'
import { createPlayer } from './board/player.js'
import { useApp, useDarkMode } from './hooks.js'
import { ItemCard } from './ItemCard.jsx'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const STYLES = [['analogy', 'styleAnalogy'], ['visual', 'styleVisual'], ['example', 'styleExample'], ['simpler', 'styleSimpler'], ['deeper', 'styleDeeper']]

// scope: { kind: 'lesson', courseId, lessonId } | { kind: 'thread', id, turn } | { kind: 'short', id }
// steps: initial steps; stream: a pending job whose partial results are steps.
export function Classroom({ scope, title, crumb, steps: initialSteps = [], stream = null, language, startIndex = 0, autoplay = true, onPosition, onEnded, onStreamDone, header, stageClass, recordChecks = true }) {
  const { api, t, speech, settings } = useApp()
  const dark = useDarkMode()
  const boardTheme = settings.boardTheme === 'dark' || (settings.boardTheme !== 'light' && dark) ? 'dark' : 'light'
  const [main, setMain] = useState(initialSteps)
  const [asides, setAsides] = useState([])
  const [complete, setComplete] = useState(!stream)
  const [snapshot, setSnapshot] = useState(null)
  const [captions, setCaptions] = useState(true)
  const [muted, setMuted] = useState(false)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')
  const [pendingAside, setPendingAside] = useState(null)
  const [styleMenu, setStyleMenu] = useState(false)
  const [error, setError] = useState(null)
  const asideCounter = useRef(0)

  const steps = useMemo(() => {
    const out = []
    for (const step of main) {
      out.push(step)
      for (const aside of asides) if (aside.anchorId === step.id) out.push(...aside.steps)
    }
    return out
  }, [main, asides])

  const player = useMemo(() => createPlayer({ speech, onChange: setSnapshot, startIndex }), [speech])
  useEffect(() => () => player.dispose(), [player])
  useEffect(() => { player.setSteps(steps, { done: complete }) }, [player, steps, complete])
  useEffect(() => {
    speech.configure({ engine: muted ? 'off' : settings.voiceEngine ?? 'browser', voiceId: settings.voiceId || undefined, language })
  }, [speech, muted, settings.voiceEngine, settings.voiceId, language])
  useEffect(() => { player.setRate(settings.voiceRate ?? 1) }, [player, settings.voiceRate])

  // Stream steps from a generating lesson.
  useEffect(() => {
    if (!stream) return undefined
    const controller = new AbortController()
    setComplete(false)
    api.follow({ job: stream }, {
      signal: controller.signal,
      onPartial: partial => setMain(current => {
        const known = new Set(current.map(step => step.id))
        const fresh = partial.filter(step => !known.has(step.id))
        return fresh.length ? [...current, ...fresh] : current
      }),
    }).then(result => {
      const board = result?.board ?? result?.item?.board ?? result
      if (board?.steps?.length) setMain(board.steps)
      setComplete(true)
      onStreamDone?.(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      setError(failure.message)
      setComplete(true)
    })
    return () => controller.abort()
  }, [stream])

  const started = useRef(false)
  useEffect(() => {
    if (!autoplay || started.current || !steps.length) return
    started.current = true
    player.play()
  }, [steps.length, autoplay, player])

  const index = snapshot?.index ?? startIndex
  useEffect(() => {
    if (!snapshot) return
    onPosition?.(Math.min(index, main.length))
  }, [index])

  const ended = snapshot?.status === 'ended' && complete
  const endedNotified = useRef(false)
  useEffect(() => {
    if (ended && !endedNotified.current) {
      endedNotified.current = true
      onEnded?.()
    }
    if (!ended) endedNotified.current = false
  }, [ended])

  // Keyboard: space play/pause, arrows step.
  useEffect(() => {
    const onKey = event => {
      if (event.target instanceof HTMLElement && /input|textarea|select/iu.test(event.target.tagName)) return
      if (event.key === ' ') {
        event.preventDefault()
        player.toggle()
      } else if (event.key === 'ArrowRight') player.next()
      else if (event.key === 'ArrowLeft') player.prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  const anchorOf = useCallback(stepIndex => {
    for (let cursor = Math.min(stepIndex, steps.length - 1); cursor >= 0; cursor -= 1) if (!steps[cursor]?.aside) return steps[cursor]?.id
    return main[0]?.id
  }, [steps, main])

  // The host knows only the stored board; map a merged index to its main step.
  const mainIndexOf = useCallback(stepIndex => {
    const target = Math.max(0, Math.min(stepIndex, steps.length - 1))
    const id = steps[target]?.aside ? anchorOf(target) : steps[target]?.id
    return Math.max(0, main.findIndex(step => step.id === id))
  }, [steps, main, anchorOf])

  const insertAside = useCallback((newSteps, atIndex) => {
    if (!newSteps?.length) return
    asideCounter.current += 1
    const prefix = `a${asideCounter.current}_`
    const anchorId = anchorOf(atIndex)
    const prepared = reidSteps(newSteps, prefix).map(step => ({ ...step, anchorId }))
    setAsides(current => [...current, { anchorId, steps: prepared }])
    // Jump to the first inserted step once React has merged it in.
    setPendingAside(prepared[0].id)
  }, [anchorOf])

  useEffect(() => {
    if (!pendingAside) return
    const position = steps.findIndex(step => step.id === pendingAside)
    if (position >= 0) {
      setPendingAside(null)
      player.seek(position)
    }
  }, [steps, pendingAside, player])

  async function ask(event) {
    event?.preventDefault()
    const text = question.trim()
    if (!text) return
    player.pause()
    setAsking('answering')
    setError(null)
    try {
      const result = await api.run('lesson/ask', { scope, stepIndex: mainIndexOf(index), question: text })
      setQuestion('')
      setAsking(false)
      insertAside(result.steps, index)
    } catch (failure) {
      setAsking(true)
      setError(failure.message)
    }
  }

  async function reexplain(style) {
    setStyleMenu(false)
    player.pause()
    setAsking('reexplaining')
    setError(null)
    const target = Math.max(0, Math.min(index, steps.length - 1))
    try {
      const result = await api.run('lesson/reexplain', { scope, stepIndex: mainIndexOf(target), style })
      setAsking(false)
      insertAside(result.steps, target)
    } catch (failure) {
      setAsking(false)
      setError(failure.message)
    }
  }

  const current = snapshot?.step
  const check = snapshot?.status === 'check' ? current?.check : null

  function onCheckResult(result) {
    if (!recordChecks || scope.kind !== 'lesson') return
    api.call('lesson/record', {
      courseId: scope.courseId,
      lessonId: scope.lessonId,
      conceptIds: check?.conceptIds ?? [],
      evidence: { kind: 'check', score: result.score, confidence: result.confidence, hintsUsed: result.hintsUsed, timeMs: result.timeMs, expectedMs: 40_000, errorTag: result.errorTag },
    }).catch(() => undefined)
  }

  const status = snapshot?.status ?? 'idle'
  const buffering = (status === 'buffering' || (!steps.length && !complete)) && !error
  const total = steps.length + (complete ? 0 : 1)

  return <div className="aha-class">
    <div className="aha-classBar">
      <div className="aha-col" style={{ gap: 0 }}>
        {crumb ? <span className="aha-crumb">{crumb}</span> : null}
        <span className="aha-cardTitle">{title}</span>
      </div>
      <div className="aha-row">{header}</div>
    </div>
    <div className={`aha-stage ${stageClass ?? ''}`}>
      <Board steps={steps} position={snapshot ? { index: snapshot.index, op: snapshot.op, progress: snapshot.progress } : { index: 0, op: 0, progress: 0 }} theme={boardTheme}
        buffering={buffering || Boolean(asking && asking !== true)} bufferingLabel={asking === 'answering' ? t('answering') : asking === 'reexplaining' ? t('generating') : steps.length ? t('bufferingLesson') : t('preparingLesson')} />
      {check ? <div className="aha-checkCard">
        <div className="aha-spread"><b>{t('checkTitle')}</b></div>
        <ItemCard item={check} language={language} onResult={onCheckResult} onContinue={() => player.answer(check.id)} />
      </div> : null}
    </div>
    {captions && current?.say ? <div className="aha-caption">{inlinePlain(current.say)}</div> : <div className="aha-caption" />}
    {error ? <div className="aha-error" style={{ textAlign: 'center' }}>{t('errorGeneric', { message: error })}</div> : null}
    {asking === true ? <form className="aha-askBox" onSubmit={ask}>
      <textarea className="aha-textarea" style={{ minHeight: 44 }} autoFocus value={question} placeholder={t('askPlaceholder')} onChange={event => setQuestion(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) ask(event) }} />
      <button type="submit" className="aha-btn" data-kind="primary" disabled={!question.trim()}>{t('ask')}</button>
      <button type="button" className="aha-btn" data-kind="ghost" onClick={() => { setAsking(false); player.play() }}>{t('cancel')}</button>
    </form> : null}
    <div className="aha-controls">
      <button type="button" className="aha-btn" data-kind="ghost" onClick={() => player.prev()} title={t('prevStep')} aria-label={t('prevStep')}>⏮</button>
      <button type="button" className="aha-btn" data-kind="primary" onClick={() => player.toggle()} disabled={!steps.length} aria-label={status === 'playing' ? t('pause') : t('play')}>{status === 'playing' ? '⏸' : '▶'} {status === 'playing' ? t('pause') : t('play')}</button>
      <button type="button" className="aha-btn" data-kind="ghost" onClick={() => player.next()} title={t('nextStep')} aria-label={t('nextStep')}>⏭</button>
      <span className="aha-tag">{t('stepOf', { current: Math.min(index + 1, Math.max(1, steps.length)), total: Math.max(total, 1) })}</span>
      <select className="aha-select" style={{ width: 'auto' }} value={snapshot?.rate ?? 1} onChange={event => player.setRate(Number(event.currentTarget.value))} aria-label={t('speed')}>
        {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
      <button type="button" className="aha-chip" data-active={!muted} onClick={() => setMuted(value => !value)}>{muted ? `🔇 ${t('voiceOff')}` : `🔊 ${t('voiceOn')}`}</button>
      <button type="button" className="aha-chip" data-active={captions} onClick={() => setCaptions(value => !value)}>CC {t('captions')}</button>
      <button type="button" className="aha-chip" onClick={() => { player.pause(); setAsking(true) }} disabled={!steps.length}>✋ {t('raiseHand')}</button>
      <span style={{ position: 'relative' }}>
        <button type="button" className="aha-chip" onClick={() => setStyleMenu(value => !value)} disabled={!steps.length}>🔄 {t('reexplain')}</button>
        {styleMenu ? <div className="aha-card" style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 10, padding: 6, gap: 2, minWidth: 140 }}>
          {STYLES.map(([value, key]) => <button key={value} type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => reexplain(value)}>{t(key)}</button>)}
        </div> : null}
      </span>
    </div>
  </div>
}
