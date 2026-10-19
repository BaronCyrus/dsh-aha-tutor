import { useState } from 'react'

import { CourseLabel, Empty, ErrorLine, MaterialPicker, Progress, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { Icon } from '../icons.jsx'
import { toDay } from '../../core/planner.js'

const MODES = [
  ['course', 'modeCourse', '🎓'],
  ['explain', 'modeExplain', '💡'],
  ['solve', 'modeSolve', '🧮'],
  ['visualize', 'modeVisualize', '📈'],
  ['digest', 'modeDigest', '📚'],
  ['short', 'modeShort', '🎬'],
]

export function HomeScreen() {
  const { api, t, navigate, toast } = useApp()
  const [mode, setMode] = useState('course')
  const [text, setText] = useState('')
  const [materialIds, setMaterialIds] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const courses = useLoad(() => api.call('course/list'), [])
  const plan = useLoad(() => api.call('plan/get', { today: toDay(new Date()) }), [])
  const samples = useLoad(() => api.call('samples/list'), [])

  async function start(quick = false) {
    const goal = text.trim()
    setError(null)
    if (mode === 'course') {
      if (!goal && !materialIds.length) return
      setBusy(true)
      try {
        const { job } = await api.call('course/start', { goal, materialIds, quick })
        navigate('craft', { jobId: job.id })
      } catch (failure) {
        setError(failure)
      } finally {
        setBusy(false)
      }
      return
    }
    if (mode === 'digest') {
      if (!materialIds.length) {
        setPicking(true)
        return
      }
      navigate('item', { kind: 'digest', materialId: materialIds[0] })
      return
    }
    if (mode === 'short') {
      const isUrl = /^https?:\/\//iu.test(goal)
      navigate('shorts', { draftTopic: isUrl ? '' : goal, draftUrl: isUrl ? goal : '', token: Date.now().toString(36) })
      return
    }
    if (!goal) return
    navigate('assist', { draftMode: mode, draftRequest: goal, draftMaterials: materialIds, token: Date.now().toString(36) })
  }

  const active = (courses.value ?? []).filter(course => course.status === 'ready' && !course.archived && course.progress.percent < 100).slice(0, 3)
  const pending = (courses.value ?? []).filter(course => course.status !== 'ready' && !course.archived).slice(0, 2)
  const today = plan.value?.today ?? []

  return <div className="aha-page">
    <section className="aha-hero">
      <div className="aha-heroTitle">{t('heroTitle')}</div>
      <p className="aha-subtitle">{t('heroHint')}</p>
      <div className="aha-composer">
        <textarea value={text} placeholder={t('heroPlaceholder')} onChange={event => setText(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start() }} />
        <div className="aha-spread">
          <div className="aha-row" style={{ gap: 6 }}>
            <button type="button" className="aha-btn" data-size="sm" onClick={() => setPicking(true)}><Icon name="plus" size={15} />{materialIds.length ? t('attached', { count: materialIds.length }) : t('attach')}</button>
          </div>
          <div className="aha-row" style={{ gap: 6 }}>
            {mode === 'course' ? <button type="button" className="aha-btn" data-kind="ghost" disabled={busy} onClick={() => start(true)}>{t('quickStart')}</button> : null}
            <button type="button" className="aha-btn" data-kind="primary" disabled={busy || (!text.trim() && !materialIds.length)} onClick={() => start(false)}>{busy ? <span className="aha-spinner" /> : null}{t('start')}</button>
          </div>
        </div>
      </div>
      <div className="aha-row" style={{ gap: 8 }}>
        {MODES.map(([value, label, emoji]) => <button key={value} type="button" className="aha-chip" data-active={mode === value} onClick={() => setMode(value)}>{emoji} {t(label)}</button>)}
      </div>
      <ErrorLine error={error} />
    </section>

    {active.length || pending.length ? <section className="aha-col">
      <h3 className="aha-cardTitle">{t('continueLearning')}</h3>
      <div className="aha-grid">
        {[...pending, ...active].map(course => <div key={course.id} className="aha-card" data-click="true" onClick={() => navigate(course.status === 'ready' ? 'course' : 'craft', { courseId: course.id })}>
          <div className="aha-row"><span style={{ fontSize: 24 }}>{course.emoji}</span><span className="aha-cardTitle">{course.title}</span></div>
          {course.status === 'ready' ? <>
            <Progress value={course.progress.percent} />
            <div className="aha-spread"><span className="aha-hint">{t('lessonsCount', course.progress)}</span>{course.next ? <span className="aha-hint">{t('nextUp', { title: course.next.title })}</span> : null}</div>
            {course.next ? <button type="button" className="aha-btn" data-kind="primary" onClick={event => { event.stopPropagation(); navigate('lesson', { courseId: course.id, lessonId: course.next.lessonId }) }}><Icon name="play" size={14} />{t('continueLearning')}</button> : null}
          </> : <span className="aha-tag">{course.status === 'intake' ? t('statusIntake') : t('statusBlueprint')}</span>}
        </div>)}
      </div>
    </section> : null}

    <section className="aha-col">
      <div className="aha-spread"><h3 className="aha-cardTitle">{t('todayPlan')}</h3><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => navigate('plan')}>{t('navPlan')} →</button></div>
      {plan.loading && !plan.value ? <Spinner /> : today.length ? <div className="aha-col" style={{ gap: 6 }}>
        {today.map((item, index) => <div key={`${item.refId}-${index}`} className="aha-card" style={{ flexDirection: 'row', alignItems: 'center', padding: '10px 14px' }}>
          <span className="aha-tag">{item.kind === 'lesson' ? t('lessonItem') : item.kind === 'review' ? t('reviewItem') : t('examItem')}</span>
          <span style={{ flex: 1 }}>{item.title}<CourseLabel title={item.courseTitle} emoji={item.courseEmoji} /></span>
          {item.minutes ? <span className="aha-hint">{t('minutesUnit', { minutes: item.minutes })}</span> : null}
          {item.kind === 'lesson' ? <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('lesson', { courseId: item.courseId, lessonId: item.refId })}>{t('learn')}</button> : null}
          {item.kind === 'review' ? <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('practice', { review: true })}>{t('review')}</button> : null}
        </div>)}
      </div> : <Empty>{t('noPlanToday')}</Empty>}
    </section>

    {samples.value?.length ? <section className="aha-col">
      <h3 className="aha-cardTitle">{t('sampleCourses')}</h3>
      <p className="aha-hint">{t('sampleHint')}</p>
      <div className="aha-grid">
        {samples.value.map(sample => <div key={sample.id} className="aha-card">
          <div className="aha-row"><span style={{ fontSize: 24 }}>{sample.emoji}</span><span className="aha-cardTitle">{sample.title}</span></div>
          <p className="aha-hint">{sample.subtitle}</p>
          <button type="button" className="aha-btn" onClick={async () => {
            try {
              const course = await api.call('samples/import', { id: sample.id })
              toast(t('courseReady'))
              navigate('course', { courseId: course.id })
            } catch (failure) {
              toast(t('errorGeneric', { message: failure.message }))
            }
          }}>{t('importSample')}</button>
        </div>)}
      </div>
    </section> : null}

    {picking ? <MaterialPicker selected={materialIds} onChange={setMaterialIds} onClose={() => setPicking(false)} /> : null}
  </div>
}
