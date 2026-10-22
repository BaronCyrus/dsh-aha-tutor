import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { applyFixes, prefixFixes } from '../core/board-fix.js'
import { boardScope } from './api.js'
import { Board, Inline } from './board/Board.jsx'
import { captionSentences } from './board/inline.js'
import { reidSteps } from './board/layout.js'
import { createPlayer } from './board/player.js'
import { furthestStep, goalStates, transcriptEntries } from './board/sidepanel.js'
import { ClassroomTour } from './ClassroomTour.jsx'
import { ErrorLine, errorText, Spinner } from './components.jsx'
import { openMainScreen } from './context.js'
import { useApp, useDarkMode, useLasting, usePersistentState } from './hooks.js'
import { ItemCard } from './ItemCard.jsx'
import { PREP_DELAY_MS } from './prep.js'
import { PrepProgress } from './PrepProgress.jsx'
import { revealTop } from './scroll.js'
import { afterNarration } from './speech.js'
import { VoiceButton } from './VoiceButton.jsx'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const STYLES = [['analogy', 'styleAnalogy'], ['visual', 'styleVisual'], ['example', 'styleExample'], ['simpler', 'styleSimpler'], ['deeper', 'styleDeeper']]

// An aside (the answer to a raised hand, a re-explanation, the correction
// of a written-out working, or the answer to "is this step wrong?") is played
// right after the step it was asked at. serverId: the id the host keeps it
// under, once it is kept.
function asideEntry({ id, kind, label, anchorId, steps = [], streaming = false, serverId }) {
  return { id, kind, label, anchorId, streaming, serverId, steps: reidSteps(steps, `${id}_`).map(step => ({ ...step, anchorId })) }
}

// The first words of a step, to say which one is meant.
const opening = say => {
  const words = [...String(say ?? '').replace(/\s+/gu, ' ').trim()]
  return words.length > 28 ? `${words.slice(0, 28).join('')}…` : words.join('')
}

// scope: { kind: 'lesson', courseId, lessonId } | { kind: 'thread', id, turn } | { kind: 'short', id }
// steps: initial steps; stream: a pending job whose partial results are steps;
// asides: the lesson's saved questions and re-explanations (lesson/get);
// objectives: the lesson's goals, shown with progress in the side panel.
// startIndex and onPosition count the board's own steps, not asides.
// reveal: a new value brings the classroom into view again, as opening it does.
// tour: offer the first-run tour (not in the narrow conversation board).
export function Classroom({ scope, title, crumb, steps: initialSteps = [], stream = null, asides: savedAsides = [], objectives = [], language, startIndex = 0, autoplay = true, onPosition, onEnded, onStreamDone, header, stageClass, recordChecks = true, reveal, tour = true }) {
  const { api, t, speech, settings, dsh } = useApp()
  const dark = useDarkMode()
  const boardTheme = settings.boardTheme === 'dark' || (settings.boardTheme !== 'light' && dark) ? 'dark' : 'light'
  const styleLabel = style => t(STYLES.find(([value]) => value === style)?.[1] ?? 'reexplain')
  const correctionLabel = tag => (tag ? t('correctionOf', { tag }) : t('correction'))
  const challengeLabel = (note, verdict) => [note || t('challengeLabel'), verdict ? t(`challenge_${verdict}`) : ''].filter(Boolean).join(' · ')
  const [main, setMain] = useState(initialSteps)
  const [asides, setAsides] = useState(() => savedAsides.map(aside => asideEntry({
    id: aside.id,
    kind: aside.kind,
    label: aside.kind === 'question' ? aside.question : aside.kind === 'correction' ? correctionLabel(aside.errorTag) : aside.kind === 'challenge' ? challengeLabel(aside.note, aside.verdict) : t('reexplainedAs', { style: styleLabel(aside.style) }),
    anchorId: aside.anchorStepId,
    steps: aside.steps ?? [],
    serverId: aside.id,
  })))
  // Fixes made to the board's own steps, kept to apply again when a board
  // still being written arrives whole.
  const boardFixes = useRef([])
  const [panelOpen, setPanelOpen] = usePersistentState('classPanel', true)
  // The first classroom a learner opens starts with a short tour; the lesson
  // waits for it.
  const [tourSeen, setTourSeen] = usePersistentState('classTourSeen', false)
  const [touring, setTouring] = useState(false)
  const tourDue = tour && !tourSeen
  const root = useRef(null)
  const askField = useRef(null)
  const transcriptBox = useRef(null)
  const [complete, setComplete] = useState(!stream)
  const [snapshot, setSnapshot] = useState(null)
  const [captions, setCaptions] = useState(true)
  const [muted, setMuted] = useState(false)
  // A voice that fails is turned off for the rest of the lesson, with a note
  // saying why ({ engine, code, message, dismissed }); see afterNarration.
  const [voiceDown, setVoiceDown] = useState(null)
  const voice = useRef({ failures: 0, down: false })
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')
  const [pendingAside, setPendingAside] = useState(null)
  const [checkResult, setCheckResult] = useState(null)
  const [correcting, setCorrecting] = useState(null)
  const correctionStarted = useRef(new Set())
  const [styleMenu, setStyleMenu] = useState(false)
  // "Is this step wrong?": the step it is about (an index into steps) and
  // what the learner wrote, while the box is open.
  const [challenge, setChallenge] = useState(null)
  const [error, setError] = useState(null)
  const asideCounter = useRef(0)
  // Watching an aside's job stops when the classroom closes; the host still
  // finishes and saves it.
  const followers = useRef(null)
  if (!followers.current) followers.current = new AbortController()
  useEffect(() => () => followers.current.abort(), [])
  // A classroom opened from below (a page that scrolls as a whole) comes into view.
  useEffect(() => { revealTop(root.current) }, [reveal])

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

  // How each narration ended decides whether the voice stays on. The player
  // outlives renders, so it reaches the current settings through a ref.
  const narrated = useRef(null)
  narrated.current = result => {
    if (voice.current.down) return
    const next = afterNarration(voice.current.failures, result)
    voice.current.failures = next.failures
    if (!next.stop) return
    voice.current.down = true
    // Off at once: the next step may start before the effect below runs.
    speech.configure({ engine: 'off' })
    setVoiceDown({ engine: settings.voiceEngine ?? 'browser', ...next.stop, dismissed: false })
  }
  const player = useMemo(() => {
    const target = main[Math.min(startIndex, main.length - 1)]?.id
    const merged = target ? steps.findIndex(step => step.id === target) : -1
    return createPlayer({ speech, onChange: setSnapshot, onNarration: result => narrated.current(result), startIndex: merged >= 0 ? merged : startIndex })
  }, [speech])
  useEffect(() => () => player.dispose(), [player])
  useEffect(() => { player.setSteps(playable, { done: complete && held === null }) }, [player, playable, complete, held])
  const engine = muted || voiceDown ? 'off' : settings.voiceEngine ?? 'browser'
  useEffect(() => {
    speech.configure({ engine, voiceId: settings.voiceId || undefined, language })
  }, [speech, engine, settings.voiceId, language])
  useEffect(() => { player.setRate(settings.voiceRate ?? 1) }, [player, settings.voiceRate])

  // Stream steps from a generating lesson. A lesson board's job also says
  // what the teacher is doing (prep), shown while the lesson waits for it.
  const [prep, setPrep] = useState(null)
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
      onPreview: (preview, job) => setPrep(preview?.phase ? { ...preview, elapsedMs: job?.elapsedMs ?? 0, receivedAt: performance.now() } : null),
    }).then(result => {
      const board = result?.board ?? result?.item?.board ?? result
      if (board?.steps?.length) setMain(boardFixes.current.length ? applyFixes(board.steps, boardFixes.current).steps : board.steps)
      setPrep(null)
      setComplete(true)
      onStreamDone?.(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      setPrep(null)
      setError(failure)
      setComplete(true)
    })
    return () => controller.abort()
  }, [stream])

  const started = useRef(false)
  useEffect(() => {
    if (!autoplay || started.current || !steps.length || tourDue) return
    started.current = true
    player.play()
  }, [steps.length, autoplay, player, tourDue])
  useEffect(() => { if (tourDue && steps.length) setTouring(true) }, [tourDue, steps.length > 0])
  const endTour = () => {
    setTouring(false)
    setTourSeen(true)
  }

  const index = snapshot?.index ?? 0
  // The transcript keeps what was reached, even after stepping back.
  const [reachedId, setReachedId] = useState(null)
  useEffect(() => { setReachedId(current => furthestStep(steps, index, current)) }, [index, steps])
  const reached = Math.max(0, steps.findIndex(step => step.id === reachedId))

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
  async function runAside({ endpoint, payload, kind, label, anchorIndex, onStarted, onAdded, onFailed, onResult }) {
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
    let added = false
    setError(null)
    try {
      const { job } = await api.call(endpoint, { ...payload, scope: boardScope(scope, stream), stepIndex: mainIndexOf(anchorIndex), anchorStepId: anchorId })
      onStarted?.()
      setAsides(current => [...current, asideEntry({ id, kind, label, anchorId, streaming: true })])
      added = true
      onAdded?.(id)
      const written = []
      const result = await api.follow({ job }, { signal, onPartial: partial => { written.push(...partial); show([...written]) } })
      show(result?.steps?.length ? result.steps : written)
      setAsides(current => current.map(aside => (aside.id === id ? { ...aside, streaming: false, serverId: result?.aside?.id } : aside)))
      setAsking(false)
      onResult?.(result, id)
    } catch (failure) {
      if (signal.aborted) return
      setAsides(current => current.flatMap(aside => (aside.id !== id ? [aside] : aside.steps.length ? [{ ...aside, streaming: false }] : [])))
      setAsking(false)
      // Nothing was answered: give the question back for another try.
      if (kind === 'question' && !shown) setQuestion(current => current || label)
      if (!added) onFailed?.()
      setError(failure)
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

  // A written-out working that went wrong is corrected at the board. The
  // check closes only once the correction is registered, so the lesson moves
  // straight into it; if it cannot start, the lesson simply goes on.
  async function startCorrection(item, result) {
    setAsking('correcting')
    await runAside({
      endpoint: 'lesson/correct',
      payload: { item: { prompt: item.prompt, answer: item.answer }, response: result.response, grade: { feedback: result.feedback, errorTag: result.errorTag, wrongStep: result.wrongStep, why: result.why, fix: result.fix } },
      kind: 'correction',
      label: correctionLabel(result.errorTag),
      anchorIndex: index,
      onAdded: asideId => setCorrecting({ checkId: item.id, asideId }),
      onFailed: () => player.answer(item.id),
    })
  }
  useEffect(() => {
    if (!correcting || !asides.some(aside => aside.id === correcting.asideId)) return
    setCorrecting(null)
    player.answer(correcting.checkId)
  }, [asides, correcting, player])

  // "Is this step wrong?" opens a box for the step on screen, or for an
  // earlier one from the transcript; the lesson waits meanwhile.
  function openChallenge(stepIndex) {
    player.pause()
    setStyleMenu(false)
    setChallenge({ index: Math.max(0, Math.min(stepIndex, steps.length - 1)), note: '' })
  }

  // What the host needs to find the step: its id on the board, or in an
  // answer it keeps; an answer it does not keep is sent whole.
  function challengeTarget(stepIndex) {
    const step = steps[stepIndex]
    if (!step?.aside) return step ? { stepId: step.id } : null
    const owner = asides.find(aside => step.id.startsWith(`${aside.id}_`))
    if (!owner || owner.streaming) return null
    if (owner.serverId && scope.kind === 'lesson') return { stepId: step.id.slice(owner.id.length + 1), asideId: owner.serverId }
    return { step: { id: step.id, say: step.say, ops: step.ops.map(({ fixed, ...op }) => op) } }
  }

  // The teacher checks the step (thinking first), then answers at the board,
  // right after the step on screen: a step challenged from the transcript
  // is answered where the learner is, and the lesson goes on from there.
  // What was fixed changes on the board at once and stays fixed.
  async function sendChallenge(event) {
    event?.preventDefault()
    if (!challenge) return
    const target = challengeTarget(challenge.index)
    const note = challenge.note.trim()
    setChallenge(null)
    if (!target) return
    player.pause()
    setAsking('checking')
    await runAside({
      endpoint: 'lesson/challenge',
      payload: { target, note },
      kind: 'challenge',
      label: challengeLabel(note),
      anchorIndex: index,
      onResult: (result, asideId) => {
        setAsides(current => current.map(aside => (aside.id === asideId ? { ...aside, label: challengeLabel(note, result?.verdict) } : aside)))
        const fixes = Array.isArray(result?.fixes) ? result.fixes : []
        if (!fixes.length) return
        if (result.target?.main) {
          boardFixes.current.push(...fixes)
          setMain(current => applyFixes(current, fixes).steps)
        } else if (result.target?.asideId) {
          setAsides(current => current.map(aside => (aside.serverId === result.target.asideId ? { ...aside, steps: applyFixes(aside.steps, prefixFixes(fixes, `${aside.id}_`)).steps } : aside)))
        } else {
          setAsides(current => current.map(aside => ({ ...aside, steps: applyFixes(aside.steps, fixes).steps })))
        }
      },
    })
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
    setCheckResult({ checkId: check?.id, result })
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
    : asking === 'correcting' || writing?.kind === 'correction' ? t('correcting')
      : asking === 'checking' || (writing?.kind === 'challenge' && !writing.steps.length) ? t('checkingStep')
        : asking === 'reexplaining' || writing ? t('generating')
          : steps.length ? t('bufferingLesson') : t('preparingLesson')

  // The lesson itself is still being written (not an answer or a correction).
  // The card replaces the small pill only when that wait goes on.
  const waitingForLesson = buffering && !asking && !writing && !complete
  const preparing = useLasting(waitingForLesson, PREP_DELAY_MS) && Boolean(prep)
  const doneGoals = goals ? goals.filter(state => state === 'done').length : 0
  const writingAside = Boolean(writing) || Boolean(asking)

  const needsCorrection = check?.kind === 'work' && checkResult?.checkId === check.id && !checkResult.result.correct && Boolean(checkResult.result.response?.trim())
  function continueCheck() {
    if (!check) return
    if (needsCorrection) {
      if (correctionStarted.current.has(check.id)) return
      correctionStarted.current.add(check.id)
      startCorrection(check, checkResult.result)
      return
    }
    player.answer(check.id)
  }

  // The voice back on, with a fresh count of failures: Retry tells the step
  // on screen again; the sound button lets the next step speak.
  function voiceBack({ replay }) {
    voice.current = { failures: 0, down: false }
    setVoiceDown(null)
    setMuted(false)
    speech.configure({ engine: settings.voiceEngine ?? 'browser' })
    if (replay && (status === 'playing' || status === 'paused')) player.seek(index)
  }
  const silent = muted || Boolean(voiceDown)
  const voiceNote = !voiceDown || voiceDown.dismissed ? null
    : voiceDown.engine === 'cloud' ? t('voiceDownCloud', { reason: errorText(t, voiceDown) }) : t('voiceDownSystem', { reason: errorText(t, voiceDown) })

  return <div ref={root} className="aha-class" data-panel={panelOpen ? 'open' : 'closed'}>
    <div className="aha-classBar">
      <div className="aha-col" style={{ gap: 0 }}>
        {crumb ? <span className="aha-crumb">{crumb}</span> : null}
        <span className="aha-cardTitle">{title}</span>
      </div>
      <div className="aha-row">
        {tour ? <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" title={t('tourReplay')} aria-label={t('tourReplay')} onClick={() => { player.pause(); setTouring(true) }}>?</button> : null}
        {typeof header === 'function' ? header({ steps }) : header}
      </div>
    </div>
    <div className="aha-classBody">
      <div className="aha-classMain">
        <div className={`aha-stage ${stageClass ?? ''}`}>
          <Board steps={steps} position={snapshot ? { index: snapshot.index, op: snapshot.op, progress: snapshot.progress, now: snapshot.now } : { index: 0, op: 0, progress: 0 }} theme={boardTheme} font={settings.boardFont === 'standard' ? 'standard' : 'hand'} view={settings.boardView === 'pages' ? 'pages' : 'canvas'}
            buffering={(buffering || Boolean(asking)) && !preparing} bufferingLabel={bufferingLabel} onInteract={() => player.pause()} />
          {preparing ? <PrepProgress prep={prep} label={bufferingLabel} first={!steps.length} hand={settings.boardFont !== 'standard'} /> : null}
          {check ? <div className="aha-checkCard">
            <div className="aha-spread"><b>{t('checkTitle')}</b></div>
            <ItemCard item={check} language={language} onResult={onCheckResult} onContinue={continueCheck} continueLabel={needsCorrection ? t('seeCorrection') : undefined} keyboard />
          </div> : null}
        </div>
        {captions && caption ? <div className="aha-caption"><Inline text={caption} /></div> : <div className="aha-caption" />}
        <ErrorLine error={error} style={{ textAlign: 'center' }} />
        {challenge ? <form className="aha-challengeBox" onSubmit={sendChallenge}>
          <b>{challenge.index === index ? t('challengeTitle') : t('challengeTitleStep', { n: challenge.index + 1, text: opening(steps[challenge.index]?.say) })}</b>
          <textarea className="aha-textarea" rows={2} autoFocus value={challenge.note} placeholder={t('challengePlaceholder')}
            onChange={event => { const note = event.currentTarget.value; setChallenge(current => current && { ...current, note }) }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) sendChallenge(event); if (event.key === 'Escape') setChallenge(null) }} />
          <div className="aha-challengeActions">
            <VoiceButton onStart={() => player.pause()} onText={text => setChallenge(current => current && { ...current, note: current.note.trim() ? `${current.note.trimEnd()} ${text}` : text })} />
            <span className="aha-challengeHint">{t('challengeHint')}</span>
            <button type="button" className="aha-btn" data-kind="ghost" onClick={() => setChallenge(null)}>{t('cancel')}</button>
            <button type="submit" className="aha-btn" data-kind="primary" disabled={!challengeTarget(challenge.index)}>{t('challengeSend')}</button>
          </div>
        </form> : null}
        {voiceNote ? <div className="aha-voiceNote" role="status">
          <span className="aha-voiceNoteText">🔇 {voiceNote}</span>
          <span className="aha-voiceNoteActions">
            <button type="button" className="aha-btn" data-size="sm" onClick={() => voiceBack({ replay: true })}>{t('retry')}</button>
            <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => openMainScreen(dsh, 'settings')}>{t('openSettings')}</button>
            <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => setVoiceDown(current => current && { ...current, dismissed: true })} title={t('close')} aria-label={t('close')}>×</button>
          </span>
        </div> : null}
        <div className="aha-controls">
          <button type="button" className="aha-btn" data-kind="ghost" onClick={() => player.prev()} title={t('prevStep')} aria-label={t('prevStep')}>⏮</button>
          <button type="button" className="aha-btn" data-kind="primary" onClick={() => player.toggle()} disabled={!steps.length} aria-label={status === 'playing' ? t('pause') : t('play')}>{status === 'playing' ? '⏸' : '▶'} {status === 'playing' ? t('pause') : t('play')}</button>
          <button type="button" className="aha-btn" data-kind="ghost" onClick={() => player.next()} title={t('nextStep')} aria-label={t('nextStep')}>⏭</button>
          <span className="aha-tag">{t('stepOf', { current: Math.min(index + 1, Math.max(1, steps.length)), total: Math.max(total, 1) })}</span>
          <select className="aha-select" style={{ width: 'auto' }} value={snapshot?.rate ?? 1} onChange={event => player.setRate(Number(event.currentTarget.value))} aria-label={t('speed')}>
            {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
          <button type="button" className="aha-chip" data-active={!silent} onClick={() => (voiceDown ? voiceBack({ replay: false }) : setMuted(value => !value))}>{silent ? `🔇 ${t('voiceOff')}` : `🔊 ${t('voiceOn')}`}</button>
          <button type="button" className="aha-chip" data-active={captions} onClick={() => setCaptions(value => !value)}>CC {t('captions')}</button>
          <button type="button" className="aha-chip" data-tour="raise" onClick={raiseHand} disabled={!steps.length}>✋ {t('raiseHand')}</button>
          <span style={{ position: 'relative' }}>
            <button type="button" className="aha-chip" data-tour="reexplain" onClick={() => setStyleMenu(value => !value)} disabled={!steps.length}>🔄 {t('reexplain')}</button>
            {styleMenu ? <div className="aha-card" style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 10, padding: 6, gap: 2, minWidth: 140 }}>
              {STYLES.map(([value, key]) => <button key={value} type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => reexplain(value)}>{t(key)}</button>)}
            </div> : null}
          </span>
          <button type="button" className="aha-chip" data-tour="challenge" aria-expanded={Boolean(challenge)} onClick={() => (challenge ? setChallenge(null) : openChallenge(index))} disabled={!steps.length || writingAside}>🧐 {t('challenge')}</button>
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
          {entries.map(entry => <div key={entry.key} role="listitem" className="aha-lineRow" data-aside={entry.aside ? 'true' : undefined}>
            <button type="button" className="aha-line" data-kind={entry.kind} data-current={entry.stepIndex === index ? 'true' : undefined}
              disabled={entry.stepIndex < 0} onClick={() => player.seek(entry.stepIndex)}>
              {entry.kind === 'question' ? <span className="aha-lineTag">✋</span> : entry.kind === 'reexplain' ? <span className="aha-lineTag">🔄</span> : entry.kind === 'correction' ? <span className="aha-lineTag">✏️</span> : entry.kind === 'challenge' ? <span className="aha-lineTag">🧐</span> : null}
              <span className="aha-lineText"><Inline text={entry.text} /></span>
              {entry.pending ? <Spinner /> : null}
            </button>
            {entry.kind === 'say' && entry.stepIndex >= 0 && !writingAside ? <button type="button" className="aha-lineFlag" title={t('challenge')} aria-label={t('challengeStep', { n: entry.stepIndex + 1 })} onClick={() => openChallenge(entry.stepIndex)}>{t('challengeLine')}</button> : null}
          </div>)}
        </div>
        <form className="aha-askBox" onSubmit={ask}>
          <textarea ref={askField} className="aha-textarea" rows={2} value={question} placeholder={t('askPlaceholder')} disabled={!steps.length}
            onChange={event => setQuestion(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) ask(event) }} />
          <div className="aha-askActions">
            {/* A spoken question pauses the lesson and fills the box. */}
            <VoiceButton disabled={!steps.length} onStart={() => player.pause()}
              onText={text => { setQuestion(current => (current.trim() ? `${current.trimEnd()} ${text}` : text)); askField.current?.focus() }} />
            <button type="submit" className="aha-btn" data-kind="primary" disabled={!question.trim() || writingAside}>{t('ask')}</button>
          </div>
        </form>
      </aside> : null}
    </div>
    {touring ? <ClassroomTour root={root} onDone={endTour} /> : null}
  </div>
}
