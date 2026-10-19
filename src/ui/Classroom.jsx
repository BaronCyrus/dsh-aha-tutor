import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Board, Inline } from './board/Board.jsx'
import { captionSentences } from './board/inline.js'
import { reidSteps } from './board/layout.js'
import { createPlayer } from './board/player.js'
import { goalStates, transcriptEntries } from './board/sidepanel.js'
import { Spinner } from './components.jsx'
import { useApp, useDarkMode, usePersistentState } from './hooks.js'
import { ItemCard } from './ItemCard.jsx'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const STYLES = [['analogy', 'styleAnalogy'], ['visual', 'styleVisual'], ['example', 'styleExample'], ['simpler', 'styleSimpler'], ['deeper', 'styleDeeper']]

// An aside (the answer to a raised hand, or a re-explanation) is played right
// after the step it was asked at.
function asideEntry({ id, kind, label, anchorId, steps = [], streaming = false }) {
  return { id, kind, label, anchorId, streaming, steps: reidSteps(steps, `${id}_`).map(step => ({ ...step, anchorId })) }
}

// scope: { kind: 'lesson', courseId, lessonId } | { kind: 'thread', id, turn } | { kind: 'short', id }
// steps: initial steps; stream: a pending job whose partial results are steps;
// asides: the lesson's saved questions and re-explanations (lesson/get);
// objectives: the lesson's goals, shown with progress in the side panel.
// startIndex and onPosition count the board's own steps, not asides.
export function Classroom({ scope, title, crumb, steps: initialSteps = [], stream = null, asides: savedAsides = [], objectives = [], language, startIndex = 0, autoplay = true, onPosition, onEnded, onStreamDone, header, stageClass, recordChecks = true }) {
  const { api, t, speech, settings } = useApp()
  const dark = useDarkMode()
  const boardTheme = settings.boardTheme === 'dark' || (settings.boardTheme !== 'light' && dark) ? 'dark' : 'light'
  const styleLabel = style => t(STYLES.find(([value]) => value === style)?.[1] ?? 'reexplain')
  const [main, setMain] = useState(initialSteps)
  const [asides, setAsides] = useState(() => savedAsides.map(aside => asideEntry({
    id: aside.id,
    kind: aside.kind,
    label: aside.kind === 'question' ? aside.question : t('reexplainedAs', { style: styleLabel(aside.style) }),
    anchorId: aside.anchorStepId,
    steps: aside.steps ?? [],
  })))
  const [panelOpen, setPanelOpen] = usePersistentState('classPanel', true)
  const askField = useRef(null)
  const transcriptBox = useRef(null)
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
  // Watching an aside's job stops when the classroom closes; the host still
  // finishes and saves it.
  const followers = useRef(null)
  if (!followers.current) followers.current = new AbortController()
  useEffect(() => () => followers.current.abort(), [])

  const steps = useMemo(() => {
    const out = []
    for (const step of main) {
      out.push(step)
      for (const aside of asides) if (aside.anchorId === step.id) out.push(...aside.steps)
    }
    return out
  }, [main, asides])

  // While an answer is still being written the lesson waits at its end
  // instead of moving on to the next step.
  const held = useMemo(() => {
    const open = asides.find(aside => aside.streaming)
    const anchor = open ? steps.findIndex(step => step.id === open.anchorId) : -1
    if (anchor < 0) return null
    let end = anchor + 1
    while (end < steps.length && steps[end].aside) end += 1
    return end
  }, [steps, asides])
  const playable = useMemo(() => (held === null ? steps : steps.slice(0, held)), [steps, held])

  const player = useMemo(() => {
    const target = main[Math.min(startIndex, main.length - 1)]?.id
    const merged = target ? steps.findIndex(step => step.id === target) : -1
    return createPlayer({ speech, onChange: setSnapshot, startIndex: merged >= 0 ? merged : startIndex })
  }, [speech])
  useEffect(() => () => player.dispose(), [player])
  useEffect(() => { player.setSteps(playable, { done: complete && held === null }) }, [player, playable, complete, held])
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

  const index = snapshot?.index ?? 0
  // The transcript keeps what was reached, even after stepping back.
  const [reached, setReached] = useState(0)
  useEffect(() => { setReached(value => Math.max(value, index)) }, [index])

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

  useEffect(() => {
    if (!snapshot) return
    onPosition?.(mainIndexOf(index))
  }, [index])

  // Jump to an aside's first step once the player has it.
  useEffect(() => {
    if (!pendingAside) return
    const position = playable.findIndex(step => step.id === pendingAside)
    if (position >= 0) {
      setPendingAside(null)
      player.seek(position)
    }
  }, [playable, pendingAside, player])

  // Ask the host for an aside and put its steps on the board as they are
  // written; the lesson continues once the whole answer is there.
  async function runAside({ endpoint, payload, kind, label, anchorIndex, onStarted }) {
    const anchorId = anchorOf(anchorIndex)
    asideCounter.current += 1
    const id = `a${asideCounter.current}`
    const signal = followers.current.signal
    let shown = false
    const show = raw => {
      const entry = asideEntry({ id, kind, label, anchorId, steps: raw, streaming: true })
      setAsides(current => current.map(aside => (aside.id === id ? { ...aside, steps: entry.steps } : aside)))
      if (!shown && entry.steps.length) {
        shown = true
        setAsking(false)
        setPendingAside(entry.steps[0].id)
      }
    }
    setError(null)
    try {
      const { job } = await api.call(endpoint, { ...payload, scope, stepIndex: mainIndexOf(anchorIndex), anchorStepId: anchorId })
      onStarted?.()
      setAsides(current => [...current, asideEntry({ id, kind, label, anchorId, streaming: true })])
      const written = []
      const result = await api.follow({ job }, { signal, onPartial: partial => { written.push(...partial); show([...written]) } })
      show(result?.steps?.length ? result.steps : written)
      setAsides(current => current.map(aside => (aside.id === id ? { ...aside, streaming: false } : aside)))
      setAsking(false)
    } catch (failure) {
      if (signal.aborted) return
      setAsides(current => current.flatMap(aside => (aside.id !== id ? [aside] : aside.steps.length ? [{ ...aside, streaming: false }] : [])))
      setAsking(false)
      // Nothing was answered: give the question back for another try.
      if (kind === 'question' && !shown) setQuestion(current => current || label)
      setError(failure.message)
    }
  }

  async function ask(event) {
    event?.preventDefault()
    const text = question.trim()
    if (!text) return
    player.pause()
    setAsking('answering')
    await runAside({ endpoint: 'lesson/ask', payload: { question: text }, kind: 'question', label: text, anchorIndex: index, onStarted: () => setQuestion('') })
  }

  async function reexplain(style) {
    setStyleMenu(false)
    player.pause()
    setAsking('reexplaining')
    await runAside({ endpoint: 'lesson/reexplain', payload: { style }, kind: 'reexplain', label: t('reexplainedAs', { style: styleLabel(style) }), anchorIndex: Math.max(0, Math.min(index, steps.length - 1)) })
  }

  // Raising a hand pauses the lesson and puts the cursor in the ask box.
  function raiseHand() {
    player.pause()
    setPanelOpen(true)
    setTimeout(() => askField.current?.focus(), 0)
  }

  const mainIndex = mainIndexOf(index)
  const goals = useMemo(() => goalStates(main, mainIndex, objectives.length, snapshot?.status === 'ended' && complete), [main, mainIndex, objectives.length, snapshot?.status, complete])
  const entries = useMemo(() => transcriptEntries(steps, Math.max(reached, index), asides), [steps, reached, index, asides])
  // Scroll the transcript itself, never the page: on narrow screens the panel
  // sits below the board, and following the lesson must not pull the view down.
  useEffect(() => {
    const box = transcriptBox.current
    if (box) box.scrollTop = box.scrollHeight
  }, [entries.length, panelOpen])

  const current = snapshot?.step
  const check = snapshot?.status === 'check' ? current?.check : null
  // Captions follow the narration sentence by sentence, formulas rendered.
  const captionLines = useMemo(() => captionSentences(current?.say), [current?.say])
  const caption = captionLines[Math.min(snapshot?.sentence ?? 0, captionLines.length - 1)] ?? ''

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
  const writing = asides.find(aside => aside.streaming)
  const bufferingLabel = asking === 'answering' || writing?.kind === 'question' ? t('answering')
    : asking === 'reexplaining' || writing ? t('generating')
      : steps.length ? t('bufferingLesson') : t('preparingLesson')

  const doneGoals = goals ? goals.filter(state => state === 'done').length : 0
  const writingAside = Boolean(writing) || asking === 'answering' || asking === 'reexplaining'

  return <div className="aha-class" data-panel={panelOpen ? 'open' : 'closed'}>
    <div className="aha-classBar">
      <div className="aha-col" style={{ gap: 0 }}>
        {crumb ? <span className="aha-crumb">{crumb}</span> : null}
        <span className="aha-cardTitle">{title}</span>
      </div>
      <div className="aha-row">{header}</div>
    </div>
    <div className="aha-classBody">
      <div className="aha-classMain">
        <div className={`aha-stage ${stageClass ?? ''}`}>
          <Board steps={steps} position={snapshot ? { index: snapshot.index, op: snapshot.op, progress: snapshot.progress, now: snapshot.now } : { index: 0, op: 0, progress: 0 }} theme={boardTheme} font={settings.boardFont === 'standard' ? 'standard' : 'hand'}
            buffering={buffering || Boolean(asking)} bufferingLabel={bufferingLabel} />
          {check ? <div className="aha-checkCard">
            <div className="aha-spread"><b>{t('checkTitle')}</b></div>
            <ItemCard item={check} language={language} onResult={onCheckResult} onContinue={() => player.answer(check.id)} />
          </div> : null}
        </div>
        {captions && caption ? <div className="aha-caption"><Inline text={caption} /></div> : <div className="aha-caption" />}
        {error ? <div className="aha-error" style={{ textAlign: 'center' }}>{t('errorGeneric', { message: error })}</div> : null}
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
          <button type="button" className="aha-chip" onClick={raiseHand} disabled={!steps.length}>✋ {t('raiseHand')}</button>
          <span style={{ position: 'relative' }}>
            <button type="button" className="aha-chip" onClick={() => setStyleMenu(value => !value)} disabled={!steps.length}>🔄 {t('reexplain')}</button>
            {styleMenu ? <div className="aha-card" style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 10, padding: 6, gap: 2, minWidth: 140 }}>
              {STYLES.map(([value, key]) => <button key={value} type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => reexplain(value)}>{t(key)}</button>)}
            </div> : null}
          </span>
          {!panelOpen ? <button type="button" className="aha-chip" aria-expanded={false} onClick={() => setPanelOpen(true)}>📋 {t('showPanel')}</button> : null}
        </div>
      </div>
      {panelOpen ? <aside className="aha-panel" aria-label={t('panelTitle')}>
        <div className="aha-spread">
          <b>{objectives.length ? t('lessonGoals') : t('transcript')}</b>
          <span className="aha-row" style={{ gap: 6 }}>
            {objectives.length && goals ? <span className="aha-tag">{doneGoals}/{objectives.length}</span> : null}
            <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setPanelOpen(false)} title={t('hidePanel')} aria-label={t('hidePanel')}>›</button>
          </span>
        </div>
        {objectives.length ? <ol className="aha-goals">
          {objectives.map((goal, goalIndex) => <li key={goalIndex} data-state={goals?.[goalIndex] ?? 'plain'}>
            <span className="aha-goalMark" aria-hidden="true">{goals?.[goalIndex] === 'done' ? '✓' : goalIndex + 1}</span>
            <span>{goal}</span>
          </li>)}
        </ol> : null}
        {objectives.length ? <b className="aha-panelHead">{t('transcript')}</b> : null}
        <div ref={transcriptBox} className="aha-transcript" role="list">
          {entries.map(entry => <button key={entry.key} type="button" role="listitem" className="aha-line" data-kind={entry.kind} data-aside={entry.aside ? 'true' : undefined} data-current={entry.stepIndex === index ? 'true' : undefined}
            disabled={entry.stepIndex < 0} onClick={() => player.seek(entry.stepIndex)}>
            {entry.kind === 'question' ? <span className="aha-lineTag">✋</span> : entry.kind === 'reexplain' ? <span className="aha-lineTag">🔄</span> : null}
            <span className="aha-lineText"><Inline text={entry.text} /></span>
            {entry.pending ? <Spinner /> : null}
          </button>)}
        </div>
        <form className="aha-askBox" onSubmit={ask}>
          <textarea ref={askField} className="aha-textarea" rows={2} value={question} placeholder={t('askPlaceholder')} disabled={!steps.length}
            onChange={event => setQuestion(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) ask(event) }} />
          <button type="submit" className="aha-btn" data-kind="primary" disabled={!question.trim() || writingAside}>{t('ask')}</button>
        </form>
      </aside> : null}
    </div>
  </div>
}
