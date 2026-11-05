import { useEffect, useRef, useState } from 'react'

import { Inline } from './board/Board.jsx'
import { Classroom } from './Classroom.jsx'
import { ErrorLine, Spinner } from './components.jsx'
import { useApp } from './hooks.js'
import { newId } from '../core/ids.js'

// 「讲这题」: the teacher explains one question at the board, in a layer over
// the page, so the practice round or the mistake book under it stays as it
// was. request: what item/explain needs (the question's source and sig,
// and the answer with the grade the learner saw, or book: true for a
// mistake from the book). record: the course, lesson and concepts the
// board's closing question counts toward (none outside a course).
// explained: an explanation of this question started earlier on the page
// ({ threadId, job }), shown again rather than written anew; onStarted
// hands a new one to the page. The board is kept as an instant-help
// thread, so the learner can also find it there. title: the question, its
// formulas written as $…$.
export function ExplainLayer({ request, record = null, title, language, explained = null, onStarted, onClose }) {
  const { api, t } = useApp()
  const [session, setSession] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const panel = useRef(null)
  const closing = useRef(onClose)
  closing.current = onClose

  useEffect(() => {
    let live = true
    setError(null)
    setSession(null)
    const start = async () => {
      // Shown again: a finished one from its thread, one still being written
      // by following it. One that failed or is gone is written anew.
      if (explained && attempt === 0) {
        const saved = await api.call('items/get', { kind: 'assist', id: explained.threadId }).catch(failure => (failure?.code === 'not-found' ? null : Promise.reject(failure)))
        const board = saved?.item?.turns?.[0]?.board
        if (board?.steps?.length) return { threadId: explained.threadId, steps: board.steps, stream: null, language: saved.item.language }
        const job = explained.job?.id ? await api.call('job/get', { id: explained.job.id }).catch(() => null) : null
        if (job?.status === 'running') return { threadId: explained.threadId, steps: [], stream: explained.job }
      }
      const threadId = newId('thd')
      const { job } = await api.call('item/explain', { ...request, newThreadId: threadId })
      onStarted?.({ threadId, job })
      return { threadId, steps: [], stream: job }
    }
    start().then(value => { if (live) setSession(value) }).catch(failure => { if (live) setError(failure) })
    return () => { live = false }
  }, [attempt])

  // Escape closes the layer, unless it is closing a box being typed in.
  useEffect(() => {
    panel.current?.focus()
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (/^(input|textarea|select)$/iu.test(target.tagName) || target.isContentEditable)) return
      closing.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className="aha-explainBack">
    <div ref={panel} className="aha-explain" role="dialog" aria-modal="true" aria-label={t('explainTitle')} tabIndex={-1}>
      <div className="aha-explainBar">
        <b className="aha-explainName">{t('explainTitle')}</b>
        <span className="aha-hint aha-explainSaved">{t('explainSaved')}</span>
        <button type="button" className="aha-btn" data-size="sm" onClick={onClose}>{t('explainClose')}</button>
      </div>
      <div className="aha-explainBody">
        {error ? <div className="aha-col" style={{ padding: 16 }}>
          <ErrorLine error={error} />
          <div><button type="button" className="aha-btn" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button></div>
        </div> : session ? <Classroom key={session.threadId} scope={{ kind: 'thread', id: session.threadId, turn: 0 }} title={title ? <Inline text={title} /> : null} steps={session.steps} stream={session.stream}
          language={session.language ?? language} recordChecks={Boolean(record?.courseId)} checkRecord={record} tour={false} talkKey={false} /> : <Spinner />}
      </div>
    </div>
  </div>
}
