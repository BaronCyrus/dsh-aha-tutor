import { useMemo, useState } from 'react'

import { downloadText } from '../api.js'
import { Confirm, Empty, ErrorLine, MasteryMeter, Modal, Progress, SourceList, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { Icon } from '../icons.jsx'
import { courseProgress, flattenLessons, nextLesson } from '../../core/course-model.js'
import { masteryPercent, masteryStage } from '../../core/mastery.js'
import { courseNextStep, lessonStage, STAGE_LABELS } from '../practice.js'

const TABS = [['outline', 'tabOutline'], ['practice', 'tabPractice'], ['sheets', 'tabSheets'], ['cards', 'tabCards'], ['projects', 'tabProjects'], ['progress', 'tabProgress']]

export function CourseScreen({ courseId, tab: initialTab = 'outline' }) {
  const { api, t, navigate, toast } = useApp()
  const detail = useLoad(() => api.call('course/get', { courseId }), [courseId])
  const [tab, setTab] = useState(initialTab)
  const [menu, setMenu] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const course = detail.value?.course
  const progress = detail.value?.progress

  const stats = useMemo(() => (course?.units ? courseProgress(course, progress) : null), [course, progress])
  const next = useMemo(() => (course?.units ? nextLesson(course, progress) : null), [course, progress])
  const step = useMemo(() => (course?.units ? courseNextStep(course, progress) : null), [course, progress])

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (!course) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  if (course.status !== 'ready') {
    navigate('craft', { courseId }, { replace: true })
    return null
  }

  const conceptMastery = id => masteryPercent(progress?.concepts?.[id] ?? { pKnown: 0.2 })
  const status = lessonId => progress?.lessons?.[lessonId]?.status ?? 'new'

  async function exportPack(includeProgress) {
    setExporting(false)
    try {
      const pack = await api.call('course/export', { courseId, includeProgress })
      downloadText(pack.fileName, pack.json)
    } catch (failure) {
      toast(t('errorGeneric', { message: failure.message }))
    }
  }

  return <div className="aha-page">
    <div className="aha-spread">
      <div className="aha-col" style={{ gap: 4, flex: 1, minWidth: 260 }}>
        <div className="aha-row" style={{ flexWrap: 'nowrap' }}><span style={{ fontSize: 30 }}>{course.emoji}</span><h2 className="aha-title">{course.title}</h2></div>
        {course.subtitle ? <p className="aha-subtitle">{course.subtitle}</p> : null}
        {stats ? <div className="aha-col" style={{ gap: 4, maxWidth: 480 }}><Progress value={stats.percent} /><span className="aha-hint">{t('lessonsCount', stats)} · {t('minutesLeft', { minutes: stats.minutesLeft })}</span></div> : null}
      </div>
      <div className="aha-row" style={{ position: 'relative' }}>
        {next ? <button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('lesson', { courseId, lessonId: next.lesson.id })}><Icon name="play" size={14} />{t('continueLearning')}</button> : null}
        <button type="button" className="aha-btn" onClick={() => setMenu(value => !value)}>⋯</button>
        {menu ? <div className="aha-card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, padding: 6, gap: 2, minWidth: 180 }} onMouseLeave={() => setMenu(false)}>
          <button type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); navigate('craft', { courseId, edit: true }) }}>{t('editOutline')}</button>
          <button type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); setExporting(true) }}>{t('exportPack')}</button>
          <button type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start' }} onClick={async () => { setMenu(false); await api.call('course/update', { courseId, archived: !course.archived }); detail.reload() }}>{course.archived ? t('unarchive') : t('archive')}</button>
          <button type="button" className="aha-btn" data-kind="ghost" style={{ justifyContent: 'flex-start', color: 'var(--aha-bad)' }} onClick={() => { setMenu(false); setDeleting(true) }}>{t('deleteCourse')}</button>
        </div> : null}
      </div>
    </div>

    {step ? <NextStep step={step} courseId={courseId} /> : null}

    <div className="aha-tabs">{TABS.map(([value, label]) => <button key={value} type="button" className="aha-tab" data-active={tab === value} onClick={() => setTab(value)}>{t(label)}</button>)}</div>

    {tab === 'outline' ? <div className="aha-tree">
      {course.units.map((unit, unitIndex) => <div key={unit.id} className="aha-unit">
        <div className="aha-spread"><b>{t('unitN', { n: unitIndex + 1 })} · {unit.title}</b><span className="aha-row" style={{ gap: 4 }}>
          <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => navigate('sheet', { courseId, unitId: unit.id })}>{t('unitSheet')}</button>
          <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => navigate('practice', { courseId, unitId: unit.id })}>{t('unitQuiz')}</button>
        </span></div>
        {unit.summary ? <p className="aha-hint">{unit.summary}</p> : null}
        {unit.lectures.map((lecture, lectureIndex) => <div key={lecture.id} className="aha-lecture">
          <div className="aha-hint" style={{ fontWeight: 600 }}>{t('lectureN', { n: lectureIndex + 1 })} · {lecture.title}</div>
          {lecture.lessons.map(lesson => <div key={lesson.id} className="aha-lesson">
            <span className="aha-dot" data-state={status(lesson.id)} />
            <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => navigate('lesson', { courseId, lessonId: lesson.id })} title={lesson.summary}>{lesson.title}</span>
            {lesson.kind === 'remedial' ? <span className="aha-tag">{t('remedial')}</span> : null}
            <span className="aha-hint">{t('estMinutes', { minutes: lesson.estMinutes })}</span>
            <LessonMeter lesson={lesson} progress={progress} />
            <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('lesson', { courseId, lessonId: lesson.id })}>{t('learn')}</button>
            <button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => navigate('practice', { courseId, lessonId: lesson.id })}>{t('practice')}</button>
          </div>)}
        </div>)}
      </div>)}
    </div> : null}

    {tab === 'outline' && course.sources?.length ? <section className="aha-card">
      <b>{t('courseSources')}</b>
      <SourceList sources={course.sources} />
    </section> : null}

    {tab === 'practice' ? <div className="aha-col">
      <div className="aha-row"><button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('practice', { courseId, review: true })}>{t('startReview')}</button></div>
      {course.units.map((unit, unitIndex) => <div key={unit.id} className="aha-card">
        <div className="aha-spread"><b>{t('unitN', { n: unitIndex + 1 })} · {unit.title}</b><button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('practice', { courseId, unitId: unit.id })}>{t('unitQuiz')}</button></div>
        <div className="aha-row" style={{ gap: 6 }}>{unit.lectures.flatMap(lecture => lecture.lessons).map(lesson => <button key={lesson.id} type="button" className="aha-chip" onClick={() => navigate('practice', { courseId, lessonId: lesson.id })}>{lesson.title}</button>)}</div>
      </div>)}
    </div> : null}

    {tab === 'sheets' ? <div className="aha-grid">
      {course.units.map((unit, unitIndex) => <div key={unit.id} className="aha-card" data-click="true" onClick={() => navigate('sheet', { courseId, unitId: unit.id })}>
        <span className="aha-hint">{t('unitN', { n: unitIndex + 1 })}</span><b>{unit.title}</b>
        <span className="aha-tag">{detail.value.ready.sheets.includes(unit.id) ? t('open') : t('generate')}</span>
      </div>)}
    </div> : null}

    {tab === 'cards' ? <div className="aha-card">
      <p>{t('cardsTitle')}</p>
      <div className="aha-row"><button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('cards', { courseId })}>{t('open')}</button></div>
    </div> : null}

    {tab === 'projects' ? (course.projects?.length ? <div className="aha-grid">
      {course.projects.map(project => <div key={project.id} className="aha-card" data-click="true" onClick={() => navigate('project', { courseId, projectId: project.id })}>
        <b>{project.title}</b><p className="aha-hint">{project.brief.slice(0, 160)}</p>
        <span className="aha-tag">{progress?.projects?.[project.id]?.status === 'passed' ? '✔' : project.kind}</span>
      </div>)}
    </div> : <Empty>{t('empty')}</Empty>) : null}

    {tab === 'progress' ? <div className="aha-card">
      <b>{t('conceptMastery')}</b>
      <div className="aha-col" style={{ gap: 4 }}>
        {flattenLessons(course).flatMap(({ lesson }) => lesson.concepts.map(concept => ({ concept, lesson }))).map(({ concept, lesson }) => {
          const state = progress?.concepts?.[concept.id]
          const stage = masteryStage(state)
          return <div key={concept.id} className="aha-spread" style={{ padding: '3px 0', borderBottom: '1px solid var(--aha-border)' }}>
            <span>{concept.name} <span className="aha-hint">· {lesson.title}</span></span>
            <span className="aha-row" style={{ gap: 8 }}>
              {state?.misconceptions?.length ? <span className="aha-tag" title={state.misconceptions.join('\n')}>⚠ {state.misconceptions.length}</span> : null}
              <span className="aha-level" data-level={stage}>{t(STAGE_LABELS[stage])}</span>
              <MasteryMeter value={conceptMastery(concept.id)} stage={stage} label={t(STAGE_LABELS[stage])} />
              <span className="aha-hint" style={{ width: 36, textAlign: 'right' }}>{stage === 'none' ? '—' : `${conceptMastery(concept.id)}%`}</span>
            </span>
          </div>
        })}
      </div>
    </div> : null}

    {exporting ? <Modal title={t('exportPack')} onClose={() => setExporting(false)} footer={<>
      <button type="button" className="aha-btn" onClick={() => exportPack(false)}>{t('exportPack')}</button>
      <button type="button" className="aha-btn" data-kind="primary" onClick={() => exportPack(true)}>{t('exportWithProgress')}</button>
    </>}><p className="aha-hint">{course.title}</p></Modal> : null}
    {deleting ? <Confirm danger text={t('deleteConfirm', { title: course.title })} onCancel={() => setDeleting(false)} onConfirm={async () => {
      await api.call('course/remove', { courseId })
      navigate('courses', {}, { replace: true })
    }} /> : null}
  </div>
}

// One suggested action at the top of the course: reviews that are due, then
// the weakest concept, then the next lesson.
function NextStep({ step, courseId }) {
  const { t, navigate } = useApp()
  const view = {
    review: [t('nextStepReview', { count: step.count }), t('startReview'), () => navigate('practice', { courseId, review: true })],
    practice: [t('nextStepWeak', { concept: step.concept }), t('practiceThis'), () => navigate('practice', { courseId, lessonId: step.lessonId })],
    lesson: [t('nextStepLesson', { title: step.title }), t('continueLearning'), () => navigate('lesson', { courseId, lessonId: step.lessonId })],
    done: [t('nextStepDone'), t('unitQuiz'), step.unitId ? () => navigate('practice', { courseId, unitId: step.unitId }) : null],
  }[step.kind]
  if (!view) return null
  const [text, label, go] = view
  return <div className="aha-card aha-nextStep" data-kind={step.kind}>
    <div className="aha-col" style={{ gap: 2, flex: 1, minWidth: 200 }}>
      <span className="aha-hint">{t('nextStepTitle')}</span>
      <b>{text}</b>
    </div>
    {go ? <button type="button" className="aha-btn" data-kind="primary" onClick={go}>{label}</button> : null}
  </div>
}

function LessonMeter({ lesson, progress }) {
  const { t } = useApp()
  const { stage, percent } = lessonStage(lesson, progress)
  return <MasteryMeter value={percent} stage={stage} label={t(STAGE_LABELS[stage])} />
}
