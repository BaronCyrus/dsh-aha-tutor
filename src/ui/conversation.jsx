import { useEffect, useMemo, useState } from 'react'

import { CrashNotice, ErrorBoundary } from './boundary.js'
import { Classroom } from './Classroom.jsx'
import { openMainScreen, useAppValue } from './context.js'
import { AppContext, useApp } from './hooks.js'
import { ItemCard } from './ItemCard.jsx'
import { Spinner } from './components.jsx'

// ── side-panel whiteboard (conversation sessions) ───────────────────────────

export function BoardTab({ useTabInfo, rpc, t, language, dsh }) {
  const { tab } = useTabInfo()
  const params = tab?.navigation?.params ?? null
  const { value } = useAppValue({ rpc, t, language, dsh })
  return <AppContext.Provider value={value}>
    <div className="aha aha-tab" style={{ height: '100%', overflow: 'auto', padding: '10px 12px' }}>
      {params?.threadId ? <ErrorBoundary key={`${params.threadId}:${tab.navigation.revision ?? 0}`} fallback={({ error, retry }) => <CrashNotice t={t} error={error} place="tab" onRetry={retry} />}>
        <ThreadBoard threadId={params.threadId} jobId={params.jobId} />
      </ErrorBoundary> : <p className="aha-hint">{t('openBoard')}</p>}
    </div>
  </AppContext.Provider>
}

function ThreadBoard({ threadId, jobId }) {
  const { api, t } = useApp()
  const [state, setState] = useState(null)
  useEffect(() => {
    let live = true
    const load = async () => {
      const job = jobId ? await api.call('job/get', { id: jobId }).catch(() => null) : null
      if (job && job.status === 'running') {
        if (live) setState({ stream: job, steps: [], title: '' })
        return
      }
      try {
        const { item } = await api.call('items/get', { kind: 'assist', id: threadId })
        const turn = item.turns.at(-1)
        if (live) setState({ stream: null, steps: turn?.board?.steps ?? [], title: item.title, language: item.language, turn: item.turns.length - 1 })
      } catch (error) {
        if (live) setState({ error })
      }
    }
    load()
    return () => { live = false }
  }, [threadId, jobId])
  if (!state) return <Spinner label={t('loading')} />
  if (state.error) return <p className="aha-error">{t('errorGeneric', { message: state.error.message })}</p>
  return <Classroom scope={{ kind: 'thread', id: threadId, turn: state.turn ?? 0 }} title={state.title || t('boardSession')} steps={state.steps} stream={state.stream} language={state.language} recordChecks={false} />
}

// ── tool cards in the conversation ──────────────────────────────────────────

function useCardValue({ rpc, t, language, dsh }) {
  return useAppValue({ rpc, t, language, dsh }).value
}

function metaOf(block) {
  return block?.meta && typeof block.meta === 'object' ? block.meta : null
}

// A card that crashes shows a notice in its place; the other cards of the
// tool keep working.
export function ToolCard(props) {
  const value = useCardValue(props)
  return <AppContext.Provider value={value}>
    <div className="aha aha-card" style={{ height: 'auto', display: 'flex', flexDirection: 'column', gap: 8, margin: '6px 0', padding: '10px 12px' }}>
      <ErrorBoundary fallback={({ error, retry }) => <CrashNotice t={props.t} error={error} place="card" onRetry={retry} />}>
        <ToolBody {...props} />
      </ErrorBoundary>
    </div>
  </AppContext.Provider>
}

function ToolBody({ toolName, phase, block, dsh, inputActions, t, callId }) {
  const meta = metaOf(block)
  const topic = block?.args?.text?.('topic') ?? block?.args?.text?.('goal') ?? ''
  const running = phase !== 'result'
  const failed = phase === 'result' && block?.isError

  // Open the board automatically the first time a fresh result arrives.
  useEffect(() => {
    if (toolName !== 'aha_whiteboard' || phase !== 'result' || !meta?.threadId) return
    const fresh = typeof block?.time === 'number' ? Date.now() - block.time < 120_000 : true
    const key = `aha-tutor:opened:${callId}`
    try {
      if (!fresh || window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      if (!fresh) return
    }
    dsh.openBoardTab({ threadId: meta.threadId, jobId: meta.jobId })
  }, [toolName, phase, meta?.threadId])

  if (failed) return <span className="aha-error">{t('errorGeneric', { message: (block.content ?? []).map(part => part.text ?? '').join(' ').slice(0, 200) })}</span>

  if (toolName === 'aha_whiteboard') {
    return <div className="aha-spread">
      <span className="aha-row" style={{ gap: 8 }}>{running ? <span className="aha-spinner" /> : '🧑‍🏫'}<b>{t('toolBoardTitle')}</b><span className="aha-hint">{meta?.title ?? topic}</span></span>
      {meta?.threadId ? <button type="button" className="aha-btn" data-size="sm" onClick={() => dsh.openBoardTab({ threadId: meta.threadId, jobId: meta.jobId })}>{t('openBoard')}</button> : null}
    </div>
  }
  if (toolName === 'aha_quiz') {
    if (running || !meta?.items) return <span className="aha-row">{<span className="aha-spinner" />}{t('makingPractice')}</span>
    return <QuizCard items={meta.items} topic={meta.topic} inputActions={inputActions} />
  }
  if (toolName === 'aha_course') {
    return <div className="aha-spread">
      <span className="aha-row" style={{ gap: 8 }}>{running ? <span className="aha-spinner" /> : '🎓'}<b>{t('modeCourse')}</b><span className="aha-hint">{meta?.goal ?? topic}</span></span>
      {meta?.courseId ? <button type="button" className="aha-btn" data-size="sm" onClick={() => openMainScreen(dsh, 'craft', { courseId: meta.courseId })}>{t('open')}</button> : null}
    </div>
  }
  if (toolName === 'aha_cheatsheet') {
    return <div className="aha-spread">
      <span className="aha-row" style={{ gap: 8 }}>{running ? <span className="aha-spinner" /> : '📄'}<b>{t('sheetTitle')}</b><span className="aha-hint">{meta?.title ?? topic}</span></span>
      {meta?.sheetId ? <button type="button" className="aha-btn" data-size="sm" onClick={() => openMainScreen(dsh, 'sheet', { sheetId: meta.sheetId })}>{t('open')}</button> : null}
    </div>
  }
  return <span className="aha-hint">{running ? <span className="aha-spinner" /> : '🧠'} {t('navProfile')}</span>
}

function QuizCard({ items, topic, inputActions }) {
  const { t, language } = useApp()
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState([])
  const item = items[index]
  const summary = useMemo(() => results.map((result, position) => `${position + 1}. ${result.correct ? '✔' : result.partial ? '◐' : '✘'} ${result.answer}`).join('\n'), [results])
  if (!item) {
    const correct = results.filter(result => result.correct).length
    return <div className="aha-col">
      <b>{t('practiceDone', { correct, total: items.length })}</b>
      {inputActions?.setDraft ? <div><button type="button" className="aha-btn" data-kind="primary" data-size="sm" onClick={() => inputActions.setDraft(`${topic ?? ''} ${t('practiceDone', { correct, total: items.length })}\n${summary}`)}>{t('submit')}</button></div> : null}
    </div>
  }
  return <div className="aha-col">
    <span className="aha-hint">{t('checkTitle')} · {index + 1}/{items.length}</span>
    <ItemCard key={index} item={item} language={language === 'zh' ? 'zh-CN' : 'en'} compact
      onResult={result => setResults(current => [...current, { ...result, answer: item.prompt.slice(0, 60) }])}
      onContinue={() => setIndex(value => value + 1)} />
  </div>
}
