import { useEffect, useRef, useState } from 'react'

import { gradeObjective } from '../core/grading.js'
import { useApp } from './hooks.js'
import { RichText } from './markdown.jsx'

const CONFIDENCE = [['sure', 'confSure'], ['unsure', 'confUnsure'], ['guess', 'confGuess']]

// One question. onResult({ score, correct, confidence, timeMs, hintsUsed,
// errorTag, misconception }) fires once when the answer is checked.
export function ItemCard({ item, language, onResult, onContinue, continueLabel, askConfidence = true, compact = false }) {
  const { api, t } = useApp()
  const [response, setResponse] = useState(item.kind === 'multi' || item.kind === 'order' ? [] : '')
  const [confidence, setConfidence] = useState(null)
  const [hints, setHints] = useState(0)
  const [result, setResult] = useState(null)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState(null)
  const started = useRef(Date.now())

  useEffect(() => {
    setResponse(item.kind === 'multi' || item.kind === 'order' ? (item.kind === 'order' ? item.options.map(option => option.id) : []) : '')
    setConfidence(null)
    setHints(0)
    setResult(null)
    setError(null)
    started.current = Date.now()
  }, [item])

  const answered = item.kind === 'multi' ? response.length > 0 : item.kind === 'order' ? true : String(response).trim() !== ''
  const ready = answered && (!askConfidence || confidence)

  async function submit() {
    if (!ready || result || grading) return
    const timeMs = Date.now() - started.current
    let outcome
    if (item.kind === 'short') {
      setGrading(true)
      setError(null)
      try {
        const graded = await api.call('lesson/grade', { item: { prompt: item.prompt, answer: item.answer, rubric: item.rubric }, response, language })
        outcome = { score: graded.score, correct: graded.verdict === 'correct', partial: graded.verdict === 'partial', feedback: graded.feedback, errorTag: graded.errorTag, misconception: graded.misconception }
      } catch (failure) {
        setError(failure.message)
        setGrading(false)
        return
      }
      setGrading(false)
    } else {
      const graded = gradeObjective(item, response)
      outcome = { score: graded.score, correct: graded.correct, partial: !graded.correct && graded.score > 0, errorTag: graded.correct ? '' : wrongLabel(item, response) }
    }
    const full = { ...outcome, confidence: confidence ?? undefined, timeMs, hintsUsed: hints }
    setResult(full)
    onResult?.(full)
  }

  const toggle = id => setResponse(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]))
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

  return <div className="aha-col" style={{ gap: compact ? 8 : 12 }}>
    <RichText text={item.prompt} compact />
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

    {item.hints?.length && !result ? <div className="aha-col" style={{ gap: 4 }}>
      {item.hints.slice(0, hints).map((hint, index) => <div key={index} className="aha-hint">💡 {hint}</div>)}
      {hints < item.hints.length ? <div><button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => setHints(count => count + 1)}>{t('hint')} ({hints + 1}/{item.hints.length})</button></div> : null}
    </div> : null}

    {askConfidence && !result ? <div className="aha-row" style={{ gap: 6 }}>
      <span className="aha-hint">{t('confidence')}</span>
      {CONFIDENCE.map(([value, key]) => <button key={value} type="button" className="aha-chip" data-active={confidence === value} onClick={() => setConfidence(value)}>{t(key)}</button>)}
    </div> : null}

    {error ? <div className="aha-error">{t('errorGeneric', { message: error })}</div> : null}
    {result ? <div className="aha-feedback" data-ok={result.correct ? 'true' : result.partial ? undefined : 'false'}>
      <b>{result.correct ? t('correct') : result.partial ? t('partial') : t('incorrect')}</b>
      {result.feedback ? <RichText text={result.feedback} compact /> : null}
      {item.explanation ? <RichText text={item.explanation} compact /> : null}
      {item.kind !== 'short' && !result.correct ? <div className="aha-hint">{answerLabel(item)}</div> : null}
    </div> : null}

    <div className="aha-row aha-itemActions">
      {!result ? <button type="button" className="aha-btn" data-kind="primary" disabled={!ready || grading} onClick={submit}>{grading ? <><span className="aha-spinner" />{t('grading')}</> : t('submit')}</button> : null}
      {result && onContinue ? <button type="button" className="aha-btn" data-kind="primary" onClick={onContinue}>{continueLabel ?? t('continue')}</button> : null}
      {!result && onContinue ? <button type="button" className="aha-btn" data-kind="ghost" onClick={onContinue}>{t('skip')}</button> : null}
    </div>
  </div>
}

function answerLabel(item) {
  if (item.kind === 'choice') return `✔ ${item.answer.toUpperCase()}. ${item.options.find(option => option.id === item.answer)?.text ?? ''}`
  if (item.kind === 'multi') return `✔ ${item.answer.map(id => id.toUpperCase()).join(', ')}`
  if (item.kind === 'order') return `✔ ${item.answer.map(id => item.options.find(option => option.id === id)?.text ?? id).join(' → ')}`
  if (item.kind === 'number') return `✔ ${item.answer}${item.unit ? ` ${item.unit}` : ''}`
  if (item.kind === 'blank') return `✔ ${item.answer.join(' / ')}`
  return ''
}

// A short label of what went wrong, for the mastery model's misconception log.
function wrongLabel(item, response) {
  if (item.kind === 'choice') return `chose ${String(response).toUpperCase()}: ${(item.options.find(option => option.id === response)?.text ?? '').slice(0, 50)}`
  if (item.kind === 'number' || item.kind === 'blank') return `answered ${String(response).slice(0, 40)}`
  return 'wrong'
}
