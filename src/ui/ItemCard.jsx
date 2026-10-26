import { useEffect, useMemo, useRef, useState } from 'react'

import { gradeObjective, wrongLabel } from '../core/grading.js'
import { ErrorLine } from './components.jsx'
import { useApp } from './hooks.js'
import { fixedLines, ITEM_VERDICT_KEYS } from './item-check.js'
import { RichText } from './markdown.jsx'
import { plotSvg } from './plot.js'
import { sanitizeSvg } from './sanitize.js'
import { VoiceButton } from './VoiceButton.jsx'

const CONFIDENCE = [['sure', 'confSure'], ['unsure', 'confUnsure'], ['guess', 'confGuess']]

// One question. onResult({ score, correct, confidence, timeMs, hintsUsed,
// errorTag, misconception, response, given }) fires once when the answer is
// checked (given: the answer as picked, an option id, a list or text); a
// "work" item (a written-out working) adds wrongStep, why and fix.
// keyboard: 1–9 pick an option, Enter submits or continues, H shows a hint
// (for the one card on screen).
// onChallenge(note), when given, offers "Something wrong with this
// question?" once the answer is graded; check is that question's check as
// the screen follows it ({ status: 'checking' | 'done' | 'failed', verdict,
// summary, explanation, item, result, error, note }). A check that fixed the
// question or graded the answer again shows the fixed question and the new
// grade.
export function ItemCard({ item: asked, language, onResult, onContinue, continueLabel, askConfidence = true, compact = false, keyboard = false, onChallenge, check = null }) {
  const { api, t } = useApp()
  const item = check?.item ?? asked
  const [response, setResponse] = useState(item.kind === 'multi' || item.kind === 'order' ? [] : '')
  const [confidence, setConfidence] = useState(null)
  const [hints, setHints] = useState(0)
  const [ownResult, setResult] = useState(null)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState(null)
  const [nudge, setNudge] = useState(false)
  // The note of "Something wrong with this question?" while its box is open.
  const [doubt, setDoubt] = useState(null)
  const started = useRef(Date.now())
  const result = ownResult && check?.result ? check.result : ownResult

  useEffect(() => {
    setResponse(asked.kind === 'multi' || asked.kind === 'order' ? (asked.kind === 'order' ? asked.options.map(option => option.id) : []) : '')
    setConfidence(null)
    setHints(0)
    setResult(null)
    setError(null)
    setNudge(false)
    setDoubt(null)
    started.current = Date.now()
  }, [asked])

  const answered = item.kind === 'multi' ? response.length > 0 : item.kind === 'order' ? true : String(response).trim() !== ''
  const ready = answered && (!askConfidence || confidence)

  async function submit() {
    if (!ready || result || grading) return
    const timeMs = Date.now() - started.current
    let outcome
    if (item.kind === 'short' || item.kind === 'work') {
      setGrading(true)
      setError(null)
      try {
        const graded = await api.call('lesson/grade', { item: { kind: item.kind, prompt: item.prompt, answer: item.answer, rubric: item.rubric }, response, language })
        outcome = { score: graded.score, correct: graded.verdict === 'correct', partial: graded.verdict === 'partial', feedback: graded.feedback, errorTag: graded.errorTag, misconception: graded.misconception }
        if (item.kind === 'work') Object.assign(outcome, { wrongStep: graded.wrongStep ?? '', why: graded.why ?? '', fix: graded.fix ?? '' })
      } catch (failure) {
        setError(failure)
        setGrading(false)
        return
      }
      setGrading(false)
    } else {
      const graded = gradeObjective(item, response)
      outcome = { score: graded.score, correct: graded.correct, partial: !graded.correct && graded.score > 0, errorTag: graded.correct ? '' : wrongLabel(item, response) }
    }
    const full = { ...outcome, response: typeof response === 'string' ? response : undefined, given: response, confidence: confidence ?? undefined, timeMs, hintsUsed: hints }
    setResult(full)
    onResult?.(full)
  }

  function sendDoubt(event) {
    event?.preventDefault()
    if (doubt === null) return
    const note = doubt.trim()
    setDoubt(null)
    onChallenge?.(note)
  }

  const toggle = id => setResponse(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]))

  // The keyboard reads the latest state through a ref, so the listener is
  // registered once per item.
  const keys = useRef(null)
  keys.current = { result, ready, answered, confidence, hints, submit, toggle, onContinue }
  useEffect(() => {
    if (!keyboard) return undefined
    const onKey = event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      const state = keys.current
      const target = event.target
      const typing = target instanceof HTMLElement && (/^(input|textarea|select)$/iu.test(target.tagName) || target.isContentEditable)
      if (event.key === 'Enter') {
        // Inputs submit on their own; a textarea takes the newline.
        if (typing) return
        if (state.result) {
          if (state.onContinue) {
            event.preventDefault()
            state.onContinue()
          }
        } else if (state.ready) {
          event.preventDefault()
          state.submit()
        } else if (state.answered && askConfidence && !state.confidence) {
          setNudge(true)
        }
        return
      }
      if (typing || state.result) return
      if (/^[1-9]$/u.test(event.key) && (item.kind === 'choice' || item.kind === 'multi')) {
        const option = item.options[Number(event.key) - 1]
        if (!option) return
        event.preventDefault()
        if (item.kind === 'multi') state.toggle(option.id)
        else setResponse(option.id)
      } else if ((event.key === 'h' || event.key === 'H') && state.hints < (item.hints?.length ?? 0)) {
        event.preventDefault()
        setHints(count => count + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, item, askConfidence])
  const move = (index, delta) => setResponse(current => {
    const next = [...current]
    const target = index + delta
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })

  const optionState = option => {
    if (!result) return undefined
    const expected = Array.isArray(item.answer) ? item.answer : [item.answer]
    if (expected.includes(option.id)) return 'right'
    const picked = Array.isArray(response) ? response.includes(option.id) : response === option.id
    return picked ? 'wrong' : undefined
  }

  const fixed = item.fixed ? fixedLines(t, item) : []
  const fixedTitle = fixed.length ? `${t('fixedWasItem')}\n${fixed.join('\n')}` : ''

  return <div className="aha-col" style={{ gap: compact ? 8 : 12 }}>
    {item.fixed ? <div><span className="aha-itemFixed" tabIndex={0} title={fixedTitle} aria-label={`${t('fixed')}. ${fixedTitle}`}>✎ {t('fixed')}</span></div> : null}
    <RichText text={item.prompt} compact />
    {item.svg ? <ItemFigure svg={item.svg} /> : item.plot ? <ItemFigure plot={item.plot} /> : null}
    {/* Options look the same either way, so a multi-select question says so. */}
    {item.kind === 'multi' ? <span className="aha-hint">{t('pickSeveral')}</span> : null}
    {(item.kind === 'choice' || item.kind === 'multi') ? <div className="aha-col aha-options" style={{ gap: 6 }} data-grid={item.options.every(option => option.text.length <= 22)}>
      {item.options.map(option => {
        const selected = item.kind === 'multi' ? response.includes(option.id) : response === option.id
        const state = optionState(option)
        return <button key={option.id} type="button" className="aha-option" data-active={selected} disabled={Boolean(result)}
          style={state === 'right' ? { borderColor: 'var(--aha-ok)' } : state === 'wrong' ? { borderColor: 'var(--aha-bad)' } : undefined}
          onClick={() => (item.kind === 'multi' ? toggle(option.id) : setResponse(option.id))}>
          <span className="aha-row" style={{ gap: 8, flexWrap: 'nowrap' }}><b>{option.id.toUpperCase()}.</b><RichText text={option.text} compact /></span>
        </button>
      })}
    </div> : null}
    {item.kind === 'order' ? <div className="aha-col" style={{ gap: 6 }}>
      {response.map((id, index) => {
        const option = item.options.find(entry => entry.id === id)
        return <div key={id} className="aha-option" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}><RichText text={option?.text ?? id} compact /></span>
          {!result ? <><button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => move(index, -1)} aria-label={t('moveUp')}>↑</button><button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => move(index, 1)} aria-label={t('moveDown')}>↓</button></> : null}
        </div>
      })}
    </div> : null}
    {item.kind === 'blank' || item.kind === 'number' ? <div className="aha-row">
      <input className="aha-input" style={{ maxWidth: 360 }} value={response} disabled={Boolean(result)} placeholder={t('yourAnswer')} inputMode={item.kind === 'number' ? 'decimal' : undefined}
        onChange={event => setResponse(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }} />
      {item.unit ? <span className="aha-hint">{item.unit}</span> : null}
    </div> : null}
    {item.kind === 'short' ? <textarea className="aha-textarea" value={response} disabled={Boolean(result)} placeholder={t('yourAnswer')} onChange={event => setResponse(event.currentTarget.value)} /> : null}
    {item.kind === 'work' ? <div className="aha-col" style={{ gap: 6 }}>
      <textarea className="aha-textarea aha-work" rows={6} value={response} disabled={Boolean(result)} placeholder={t('workPlaceholder')} onChange={event => setResponse(event.currentTarget.value)} />
      {!result && /\$[^$\n]+\$/u.test(response) ? <div className="aha-workPreview" aria-label={t('workPreview')}>
        {response.split('\n').filter(line => line.trim()).map((line, index) => <RichText key={index} text={line} compact />)}
      </div> : null}
    </div> : null}

    {item.hints?.length && !result ? <div className="aha-col" style={{ gap: 4 }}>
      {item.hints.slice(0, hints).map((hint, index) => <div key={index} className="aha-hint">💡 {hint}</div>)}
      {hints < item.hints.length ? <div><button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => setHints(count => count + 1)}>{t('hint')} ({hints + 1}/{item.hints.length})</button></div> : null}
    </div> : null}

    {askConfidence && !result ? <div className="aha-row aha-confidence" style={{ gap: 6 }} data-nudge={nudge && !confidence ? 'true' : undefined}>
      <span className="aha-hint">{t('confidence')}</span>
      {CONFIDENCE.map(([value, key]) => <button key={value} type="button" className="aha-chip" data-active={confidence === value} onClick={() => { setConfidence(value); setNudge(false) }}>{t(key)}</button>)}
    </div> : null}

    <ErrorLine error={error} />
    {result ? <div className="aha-feedback" data-ok={result.correct ? 'true' : result.partial ? undefined : 'false'}>
      <b>{result.correct ? t('correct') : result.partial ? t('partial') : t('incorrect')}{result.regraded ? t('regraded') : ''}</b>
      {result.feedback ? <RichText text={result.feedback} compact /> : null}
      {item.explanation ? <RichText text={item.explanation} compact /> : null}
      {result.wrongStep ? <div className="aha-wrongStep">
        <span className="aha-hint">{t('wrongStep')}</span>
        <RichText text={result.wrongStep} compact />
        {result.fix ? <><span className="aha-hint">{t('fixedStep')}</span><RichText text={result.fix} compact /></> : null}
      </div> : null}
      {item.kind !== 'short' && item.kind !== 'work' && !result.correct ? <div className="aha-hint">{answerLabel(item)}</div> : null}
      {onChallenge && doubt === null && check?.status !== 'checking' ? <button type="button" className="aha-itemFlag" onClick={() => setDoubt('')}>🧐 {t('itemChallenge')}</button> : null}
    </div> : null}

    {result && doubt !== null ? <form className="aha-challengeBox aha-itemChallenge" onSubmit={sendDoubt}>
      <b>{t('itemChallengeTitle')}</b>
      <textarea className="aha-textarea" rows={2} autoFocus value={doubt} placeholder={t('itemChallengePlaceholder')}
        onChange={event => { const note = event.currentTarget.value; setDoubt(current => (current === null ? current : note)) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) sendDoubt(event); if (event.key === 'Escape') setDoubt(null) }} />
      <div className="aha-challengeActions">
        <VoiceButton onText={said => setDoubt(current => (current === null ? current : current.trim() ? `${current.trimEnd()} ${said}` : said))} />
        <span className="aha-challengeHint">{t('itemChallengeHint')}</span>
        <button type="button" className="aha-btn" data-kind="ghost" onClick={() => setDoubt(null)}>{t('cancel')}</button>
        <button type="submit" className="aha-btn" data-kind="primary">{t('challengeSend')}</button>
      </div>
    </form> : null}

    {result && check ? <div className="aha-itemCheck" data-verdict={check.status === 'done' ? check.verdict : undefined} role="status">
      <span className="aha-hint">{t('itemCheckTitle')}</span>
      {check.status === 'checking' ? <span className="aha-row" style={{ gap: 6 }}><span className="aha-spinner" />{t('itemChecking')}</span> : null}
      {check.status === 'done' ? <>
        <b>{t(ITEM_VERDICT_KEYS[check.verdict] ?? ITEM_VERDICT_KEYS.right)}</b>
        {check.summary ? <RichText text={check.summary} compact /> : null}
        {check.explanation ? <RichText text={check.explanation} compact /> : null}
        {check.earlier ? <span className="aha-hint">{t('itemCheckEarlier', { count: check.earlier }).trim()}</span> : null}
      </> : null}
      {check.status === 'failed' ? <div className="aha-row" style={{ gap: 6 }}>
        <ErrorLine error={check.error} />
        <button type="button" className="aha-btn" data-size="sm" onClick={() => onChallenge?.(check.note ?? '')}>{t('retry')}</button>
      </div> : null}
    </div> : null}

    <div className="aha-row aha-itemActions">
      {!result ? <button type="button" className="aha-btn" data-kind="primary" disabled={!ready || grading} onClick={submit}>{grading ? <><span className="aha-spinner" />{t('grading')}</> : t('submit')}</button> : null}
      {result && onContinue ? <button type="button" className="aha-btn" data-kind="primary" onClick={onContinue}>{continueLabel ?? t('continue')}</button> : null}
      {!result && onContinue ? <button type="button" className="aha-btn" data-kind="ghost" onClick={onContinue}>{t('skip')}</button> : null}
    </div>
  </div>
}

// A figure drawn by the model, only through the SVG allow-list, or a plot
// computed from its formulas, on paper so its ink stays readable in the dark
// theme.
function ItemFigure({ svg, plot }) {
  const safe = useMemo(() => sanitizeSvg(plot ? plotSvg(plot) : svg), [svg, plot])
  return safe ? <div className="aha-itemFigure" dangerouslySetInnerHTML={{ __html: safe }} /> : null
}

function answerLabel(item) {
  if (item.kind === 'choice') return `✔ ${item.answer.toUpperCase()}. ${item.options.find(option => option.id === item.answer)?.text ?? ''}`
  if (item.kind === 'multi') return `✔ ${item.answer.map(id => id.toUpperCase()).join(', ')}`
  if (item.kind === 'order') return `✔ ${item.answer.map(id => item.options.find(option => option.id === id)?.text ?? id).join(' → ')}`
  if (item.kind === 'number') return `✔ ${item.answer}${item.unit ? ` ${item.unit}` : ''}`
  if (item.kind === 'blank') return `✔ ${item.answer.join(' / ')}`
  return ''
}
