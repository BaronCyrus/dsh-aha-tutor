import { useEffect, useMemo, useState } from 'react'

import { Empty, ErrorLine, JobProgress, Spinner } from '../components.jsx'
import { useApp, useJob, useLoad } from '../hooks.js'
import { ItemCard } from '../ItemCard.jsx'
import { RichText } from '../markdown.jsx'
import { TeX } from '../math.jsx'
import { dueCards } from '../../core/srs.js'

// ── practice, quizzes and reviews ──────────────────────────────────────────

export function PracticeScreen({ courseId, lessonId, unitId, review, deckId }) {
  const { api, t, navigate } = useApp()
  const job = useJob()
  const [set, setSet] = useState(null)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState([])

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        if (review) {
          const session = await api.call('review/session')
          if (live) setSet({ title: t('review'), items: session.items.map(entry => ({ ...entry.item, context: entry })), language: undefined })
          return
        }
        if (deckId) {
          const { item } = await api.call('items/get', { kind: 'decks', id: deckId })
          if (live) setSet({ title: item.title, items: item.items ?? [], language: item.language })
          return
        }
        const endpoint = unitId ? 'unit/quiz' : 'lesson/practice'
        const payload = unitId ? { courseId, unitId } : { courseId, lessonId }
        const first = await api.call(endpoint, payload)
        const value = first.job ? await job.run(null, null, { existing: first.job }) : first
        const items = (value.quiz ?? value.practice)?.items ?? []
        const lesson = lessonId ? await api.call('lesson/get', { courseId, lessonId }) : null
        if (live) setSet({ title: lesson?.lesson.title ?? t('unitQuiz'), items, language: lesson?.language })
      } catch (failure) {
        if (live) setError(failure)
      }
    }
    load()
    return () => { live = false }
  }, [courseId, lessonId, unitId, review, deckId])

  const item = set?.items[index]
  const record = result => {
    setResults(current => [...current, result])
    const targetCourse = item?.context?.courseId ?? courseId
    if (!targetCourse || deckId) return
    api.call('lesson/record', {
      courseId: targetCourse,
      lessonId: item?.context?.lessonId ?? lessonId,
      conceptIds: item?.conceptIds ?? [],
      evidence: { kind: unitId ? 'quiz' : 'practice', score: result.score, confidence: result.confidence, hintsUsed: result.hintsUsed, timeMs: result.timeMs, expectedMs: 60_000, errorTag: result.errorTag },
    }).catch(() => undefined)
  }

  if (error) return <div className="aha-page"><ErrorLine error={error} /></div>
  if (!set) return <div className="aha-page"><JobProgress progress={job.progress} label={t('makingPractice')} /></div>
  if (!set.items.length) return <div className="aha-page"><Empty>{review ? t('nothingToReview') : t('empty')}</Empty></div>

  const done = index >= set.items.length
  const correct = results.filter(result => result.correct).length
  return <div className="aha-page" style={{ maxWidth: 760 }}>
    <div className="aha-spread">
      <h2 className="aha-title">{set.title}</h2>
      <span className="aha-tag">{Math.min(index + 1, set.items.length)}/{set.items.length}</span>
    </div>
    {item?.context ? <p className="aha-hint">{item.context.courseTitle} · {item.context.conceptName}</p> : null}
    {!done ? <div className="aha-card"><ItemCard key={`${index}`} item={item} language={set.language} onResult={record} onContinue={() => setIndex(value => value + 1)} continueLabel={index + 1 < set.items.length ? t('continue') : t('confirm')} /></div> : <div className="aha-card">
      <b>{t('practiceDone', { correct, total: set.items.length })}</b>
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={() => { setIndex(0); setResults([]) }}>{t('retry')}</button>
        {courseId ? <button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('course', { courseId })}>{t('backToCourse')}</button> : null}
      </div>
    </div>}
  </div>
}

// ── flashcards ─────────────────────────────────────────────────────────────

export function CardsScreen({ courseId, deckId }) {
  const { api, t } = useApp()
  const job = useJob()
  const [deck, setDeck] = useState(null)
  const [error, setError] = useState(null)
  const [flipped, setFlipped] = useState(false)
  const [queue, setQueue] = useState(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        let value
        if (deckId) value = (await api.call('items/get', { kind: 'decks', id: deckId })).item
        else {
          const first = await api.call('course/cards', { courseId })
          value = first.job ? (await job.run(null, null, { existing: first.job })).deck : first.deck
        }
        if (!live) return
        setDeck(value)
        const now = Date.now()
        const due = dueCards(Object.values(value.srs ?? {}), now).map(card => card.id)
        const fresh = value.cards.filter(card => !value.srs?.[card.id]).map(card => card.id)
        setQueue([...due, ...fresh].slice(0, 40))
      } catch (failure) {
        if (live) setError(failure)
      }
    }
    load()
    return () => { live = false }
  }, [courseId, deckId])

  const current = useMemo(() => deck?.cards.find(card => card.id === queue?.[0]), [deck, queue])
  async function grade(value) {
    if (!current) return
    setFlipped(false)
    setQueue(list => {
      const rest = list.slice(1)
      return value === 'again' ? [...rest, current.id] : rest
    })
    try {
      if (deckId) await api.call('items/card-review', { id: deckId, cardId: current.id, grade: value })
      else await api.call('course/card-review', { courseId, cardId: current.id, grade: value })
    } catch {
      // the next review fixes it
    }
  }

  if (error) return <div className="aha-page"><ErrorLine error={error} /></div>
  if (!deck || !queue) return <div className="aha-page"><JobProgress progress={job.progress} label={t('makingCards')} /></div>
  return <div className="aha-page" style={{ maxWidth: 720 }}>
    <div className="aha-spread"><h2 className="aha-title">{t('cardsTitle')}</h2><span className="aha-tag">{t('cardsDue', { count: queue.length })}</span></div>
    {current ? <>
      <div className="aha-flash" data-flipped={flipped} onClick={() => setFlipped(value => !value)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') setFlipped(value => !value) }}>
        <div className="aha-flashInner">
          <div className="aha-flashFace"><RichText text={current.front} /></div>
          <div className="aha-flashFace aha-flashBack"><RichText text={current.back} /></div>
        </div>
      </div>
      <p className="aha-hint" style={{ textAlign: 'center' }}>{current.tag ? `${current.tag} · ` : ''}{t('flip')}</p>
      {flipped ? <div className="aha-row" style={{ justifyContent: 'center' }}>
        {[['again', 'again'], ['hard', 'hard'], ['good', 'good'], ['easy', 'easy']].map(([value, label]) => <button key={value} type="button" className="aha-btn" data-kind={value === 'good' ? 'primary' : undefined} onClick={() => grade(value)}>{t(label)}</button>)}
      </div> : null}
    </> : <Empty>{t('cardsDone')}</Empty>}
  </div>
}

// ── cheat sheets ───────────────────────────────────────────────────────────

export function SheetScreen({ courseId, unitId, sheetId }) {
  const { api, t, toast } = useApp()
  const job = useJob()
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState(null)
  const [layout, setLayout] = useState(null)

  const load = async force => {
    setError(null)
    try {
      let value
      if (sheetId) value = (await api.call('items/get', { kind: 'sheets', id: sheetId })).item.sheet
      else {
        const first = await api.call('unit/sheet', { courseId, unitId, force })
        value = first.job ? (await job.run(null, null, { existing: first.job })).sheet : first.sheet
      }
      setSheet(value)
      setLayout(value.layout)
    } catch (failure) {
      setError(failure)
    }
  }
  useEffect(() => { load(false) }, [courseId, unitId, sheetId])

  const update = patch => {
    const next = { ...layout, ...patch }
    setLayout(next)
    const request = sheetId ? api.call('items/sheet-layout', { id: sheetId, layout: next }) : api.call('unit/sheet-layout', { courseId, unitId, layout: next })
    request.catch(failure => toast(t('errorGeneric', { message: failure.message })))
  }

  if (error) return <div className="aha-page"><ErrorLine error={error} /></div>
  if (!sheet || !layout) return <div className="aha-page"><JobProgress progress={job.progress} label={t('makingSheet')} /></div>
  const order = layout.order.map(id => sheet.sections.find(section => section.id === id)).filter(Boolean)
  const hidden = new Set(layout.hidden ?? [])
  return <div className="aha-page" style={{ maxWidth: 1200 }}>
    <div className="aha-spread aha-noprint">
      <h2 className="aha-title">{sheet.title || t('sheetTitle')}</h2>
      <div className="aha-row">
        <label className="aha-row" style={{ gap: 6 }}>{t('columns')}<select className="aha-select" style={{ width: 'auto' }} value={layout.columns} onChange={event => update({ columns: Number(event.currentTarget.value) })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="aha-row" style={{ gap: 6 }}>{t('fontSize')}<select className="aha-select" style={{ width: 'auto' }} value={layout.fontSize} onChange={event => update({ fontSize: Number(event.currentTarget.value) })}>{[9, 10, 11, 12, 13, 14, 16].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="aha-row" style={{ gap: 6 }}><input type="checkbox" checked={layout.highlight} onChange={event => update({ highlight: event.currentTarget.checked })} />{t('highlight')}</label>
        <button type="button" className="aha-btn" onClick={() => window.print()}>{t('print')}</button>
        {!sheetId ? <button type="button" className="aha-btn" data-kind="ghost" onClick={() => { setSheet(null); load(true) }}>{t('regenerate')}</button> : null}
      </div>
    </div>
    <div className="aha-row aha-noprint" style={{ gap: 6 }}>
      {order.map((section, position) => <span key={section.id} className="aha-chip" data-active={!hidden.has(section.id)}>
        <span onClick={() => update({ hidden: hidden.has(section.id) ? [...hidden].filter(id => id !== section.id) : [...hidden, section.id] })}>{section.title}</span>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => {
          const ids = [...layout.order]
          const at = ids.indexOf(section.id)
          if (at > 0) [ids[at - 1], ids[at]] = [ids[at], ids[at - 1]]
          update({ order: ids })
        }} disabled={position === 0}>↑</button>
      </span>)}
    </div>
    <div className="aha-printable">
      <div className="aha-sheet" data-highlight={layout.highlight} style={{ columnCount: layout.columns, '--sheet-size': `${layout.fontSize}px` }}>
        {order.filter(section => !hidden.has(section.id)).map(section => <div key={section.id} className="aha-sheetSection">
          <h4>{section.title}</h4>
          {section.items.map((item, index) => <div key={index} className="aha-sheetItem" data-kind={item.kind}>
            {item.title ? <b>{item.title}：</b> : null}
            {item.text ? <RichText text={item.text} compact /> : null}
            {item.tex ? <TeX tex={item.tex} /> : null}
            {item.cite ? <span className="aha-cite">(p.{item.cite.page}{item.cite.source ? ` · ${item.cite.source}` : ''})</span> : null}
          </div>)}
          {section.related?.length ? <div className="aha-cite">↔ {section.related.join(' · ')}</div> : null}
        </div>)}
      </div>
    </div>
  </div>
}

// ── notes, quizzes from the library, digests ───────────────────────────────

export function ItemScreen({ kind, id, materialId }) {
  const { api, t } = useApp()
  const job = useJob()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        if (kind === 'digest') {
          const { material } = await api.call('material/get', { id: materialId })
          let digest = material.digest
          if (!digest) {
            const first = await api.call('material/digest', { id: materialId })
            digest = (await job.run(null, null, { existing: first.job })).material.digest
          }
          if (live) setState({ title: material.title, digest })
          return
        }
        const { item } = await api.call('items/get', { kind: 'sheets', id })
        if (live) setState({ title: item.title, markdown: item.markdown })
      } catch (failure) {
        if (live) setError(failure)
      }
    }
    load()
    return () => { live = false }
  }, [kind, id, materialId])

  if (kind === 'quiz') return <PracticeScreen deckId={id} />
  if (error) return <div className="aha-page"><ErrorLine error={error} /></div>
  if (!state) return <div className="aha-page"><JobProgress progress={job.progress} label={t('generating')} /></div>
  if (state.markdown !== undefined) return <div className="aha-page" style={{ maxWidth: 860 }}>
    <h2 className="aha-title">{state.title}</h2>
    <div className="aha-card"><RichText text={state.markdown} /></div>
  </div>
  const digest = state.digest
  return <div className="aha-page" style={{ maxWidth: 900 }}>
    <h2 className="aha-title">{t('digestTitle')} · {state.title}</h2>
    <section className="aha-card"><b>{t('overview')}</b><RichText text={digest.overview} /></section>
    {digest.structure?.length ? <section className="aha-card"><b>{t('structure')}</b>{digest.structure.map((part, index) => <div key={index} className="aha-col" style={{ gap: 2 }}>
      <div><b>{part.heading}</b>{part.pages ? <span className="aha-cite">(p.{part.pages})</span> : null}</div>
      <ul style={{ margin: 0 }}>{part.points.map((point, pointIndex) => <li key={pointIndex}><RichText text={point} compact /></li>)}</ul>
    </div>)}</section> : null}
    {digest.keyIdeas?.length ? <section className="aha-card"><b>{t('keyIdeas')}</b><ul style={{ margin: 0 }}>{digest.keyIdeas.map((idea, index) => <li key={index}><RichText text={idea} compact /></li>)}</ul></section> : null}
    {digest.arguments?.length ? <section className="aha-card"><b>{t('arguments')}</b>{digest.arguments.map((argument, index) => <div key={index}><b>{argument.claim}</b>{argument.page ? <span className="aha-cite">(p.{argument.page})</span> : null}<p className="aha-hint">{argument.support}</p></div>)}</section> : null}
    {digest.glossary?.length ? <section className="aha-card"><b>{t('glossary')}</b>{digest.glossary.map((entry, index) => <div key={index}><b>{entry.term}</b>：{entry.meaning}</div>)}</section> : null}
    {digest.questions?.length ? <section className="aha-card"><b>{t('discussion')}</b><ol style={{ margin: 0 }}>{digest.questions.map((question, index) => <li key={index}>{question}</li>)}</ol></section> : null}
  </div>
}

export function Loading() {
  const { t } = useApp()
  return <Spinner label={t('loading')} />
}
