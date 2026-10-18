import { useEffect, useRef, useState } from 'react'

import { downloadText } from '../api.js'
import { Classroom } from '../Classroom.jsx'
import { ErrorLine, Modal, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { useVideoExport } from '../useVideoExport.js'
import { boardToMarkdown } from '../../core/board-script.js'

export function LessonScreen({ courseId, lessonId }) {
  const { api, t, navigate } = useApp()
  const detail = useLoad(() => api.call('lesson/get', { courseId, lessonId }), [courseId, lessonId])
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  const [finished, setFinished] = useState(false)
  const [version, setVersion] = useState(0)
  const saveTimer = useRef(null)
  const video = useVideoExport()

  // Use the saved board, or start/attach to its generation.
  useEffect(() => {
    if (!detail.value) return
    if (detail.value.board && version === 0) {
      setSource({ steps: detail.value.board.steps, stream: null })
      return
    }
    let live = true
    api.call('lesson/prepare', { courseId, lessonId, force: version > 0 })
      .then(result => { if (live) setSource(result.board ? { steps: result.board.steps, stream: null } : { steps: [], stream: result.job }) })
      .catch(failure => { if (live) setError(failure) })
    return () => { live = false }
  }, [detail.value, version])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (!detail.value) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  const { lesson, unit, lecture, language, state } = detail.value
  const startIndex = state?.status === 'learning' ? Math.max(0, (state.stepIndex ?? 0)) : 0

  const savePosition = index => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.call('lesson/position', { courseId, lessonId, stepIndex: index }).catch(() => undefined)
    }, 800)
  }

  return <div className="aha-page" data-wide="true">
    {error ? <ErrorLine error={error} /> : null}
    {source ? <Classroom
      key={`${version}`}
      scope={{ kind: 'lesson', courseId, lessonId }}
      title={lesson.title}
      crumb={`${unit.title} · ${lecture.title}`}
      steps={source.steps}
      stream={source.stream}
      language={language}
      startIndex={source.stream ? 0 : startIndex}
      onPosition={savePosition}
      onEnded={() => setFinished(true)}
      onStreamDone={result => { if (result?.board?.steps?.length) setSource(current => ({ ...current, steps: result.board.steps })) }}
      header={<>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('course', { courseId })}>← {t('backToCourse')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('practice', { courseId, lessonId })}>{t('practice')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={!source.steps.length} onClick={() => downloadText(`${lesson.title}.md`, boardToMarkdown({ title: lesson.title, steps: source.steps }), 'text/markdown')}>{t('exportBoard')}</button>
        {video.exporting
          ? <><Spinner label={t('exporting', { percent: video.exporting.percent })} /><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={video.cancel}>{t('cancel')}</button></>
          : <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" disabled={!source.steps.length} title={video.cloud ? '' : t('exportNeedsCloud')} onClick={() => video.start({ steps: source.steps, title: lesson.title })}>{t('exportVideo')}</button>}
        <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => { setSource(null); setFinished(false); setVersion(value => value + 1) }}>{t('regenerateLesson')}</button>
      </>}
    /> : <Spinner label={t('preparingLesson')} />}
    {finished ? <Completion courseId={courseId} lessonId={lessonId} onClose={() => setFinished(false)} /> : null}
  </div>
}

function Completion({ courseId, lessonId, onClose }) {
  const { api, t, navigate } = useApp()
  const [rating, setRating] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function finish(value) {
    setRating(value)
    setBusy(true)
    try {
      setResult(await api.call('lesson/complete', { courseId, lessonId, selfRating: value }))
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={t('lessonDone')} onClose={onClose}>
    {!result ? <>
      <p>{t('selfRate')}</p>
      <div className="aha-row">
        {[[1, 'rate1'], [2, ''], [3, 'rate3'], [4, ''], [5, 'rate5']].map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={rating === value} disabled={busy} onClick={() => finish(value)}>{value}{label ? ` · ${t(label)}` : ''}</button>)}
      </div>
      {busy ? <Spinner /> : null}
    </> : <div className="aha-col">
      {result.inserted ? <div className="aha-feedback">{t('remedialAdded', { title: result.inserted.title })}</div> : null}
      {result.recommendation?.action === 'challenge' ? <div className="aha-feedback" data-ok="true">{t('challengeNote')}</div> : null}
      <div className="aha-row">
        {result.next ? <button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('lesson', { courseId, lessonId: result.next.id }, { replace: true })}>{t('nextLesson')}: {result.next.title}</button> : null}
        <button type="button" className="aha-btn" onClick={() => navigate('practice', { courseId, lessonId })}>{t('doPractice')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" onClick={() => navigate('course', { courseId }, { replace: true })}>{t('backToCourse')}</button>
      </div>
    </div>}
    <ErrorLine error={error} />
  </Modal>
}
