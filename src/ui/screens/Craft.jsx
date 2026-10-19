import { useEffect, useMemo, useState } from 'react'

import { ErrorLine, JobProgress, Spinner } from '../components.jsx'
import { useApp, useJob, useLoad } from '../hooks.js'

const PACES = [['intensive', 'paceIntensive', 'paceIntensiveHint'], ['balanced', 'paceBalanced', 'paceBalancedHint'], ['relaxed', 'paceRelaxed', 'paceRelaxedHint']]
const WEEKLY = [60, 120, 180, 300, 420, 600]

// Course crafting: intake questions → blueprint (edit / revise) → confirm.
export function CraftScreen({ jobId, courseId }) {
  const { api, t, navigate } = useApp()
  const [error, setError] = useState(null)

  // Arriving from Home with a start job: wait for it, then switch to the course.
  useEffect(() => {
    if (!jobId || courseId) return undefined
    const controller = new AbortController()
    api.follow({ job: { id: jobId, status: 'running' } }, { signal: controller.signal })
      .then(result => navigate('craft', { courseId: result.courseId }, { replace: true }))
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [jobId, courseId])

  if (!courseId) {
    return <div className="aha-page">
      <h2 className="aha-title">{t('craftQuestionsTitle')}</h2>
      {error ? <><ErrorLine error={error} /><button type="button" className="aha-btn" onClick={() => navigate('home')}>{t('back')}</button></> : <Spinner label={t('thinkingQuestions')} />}
    </div>
  }
  return <CraftCourse courseId={courseId} />
}

function CraftCourse({ courseId }) {
  const { api, t, navigate } = useApp()
  const detail = useLoad(() => api.call('course/get', { courseId }), [courseId])
  const job = useJob()
  const course = detail.value?.course

  // Resume a generation that was running when the screen was left.
  useEffect(() => {
    const running = detail.value?.jobs?.questions ?? detail.value?.jobs?.blueprint ?? detail.value?.jobs?.confirm
    if (!running || job.running) return
    job.run(null, null, { existing: running }).then(() => detail.reload()).catch(() => undefined)
  }, [detail.value])

  useEffect(() => {
    if (course?.status === 'ready' && !job.running) navigate('course', { courseId }, { replace: true })
  }, [course?.status])

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (detail.error && !detail.value) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  if (!course) return null

  if (course.status === 'intake') {
    return <Intake course={course} intake={detail.value.intake} job={job} onDone={() => detail.reload()} />
  }
  return <Blueprint course={course} job={job} onChange={() => detail.reload()} />
}

function Intake({ course, intake, job, onDone }) {
  const { t } = useApp()
  const questions = intake?.questionnaire?.questions ?? []
  const [answers, setAnswers] = useState({})
  const [timeline, setTimeline] = useState('balanced')
  const [weekly, setWeekly] = useState(180)
  const [deadline, setDeadline] = useState('')

  const pick = (question, optionId) => setAnswers(current => {
    const previous = current[question.id] ?? { choice: [], other: '' }
    const choice = question.multi
      ? (previous.choice.includes(optionId) ? previous.choice.filter(id => id !== optionId) : [...previous.choice, optionId])
      : [optionId]
    return { ...current, [question.id]: { ...previous, choice } }
  })

  async function submit() {
    try {
      await job.run('course/intake', { courseId: course.id, answers, timeline, weeklyMinutes: weekly, deadline: deadline || undefined })
      onDone()
    } catch {
      // shown below
    }
  }

  if (job.running) {
    const label = job.progress?.label === 'questions' ? t('thinkingQuestions')
      : job.progress?.done ? t('blueprintSoFar', { count: job.progress.done })
        : t('designingBlueprint')
    return <div className="aha-page"><h2 className="aha-title">{course.goal}</h2><JobProgress progress={job.progress} label={label} onCancel={job.cancel} /></div>
  }

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}>
      <h2 className="aha-title">{t('craftQuestionsTitle')}</h2>
      <p className="aha-subtitle">{course.goal}</p>
      <p className="aha-hint">{t('craftQuestionsHint')}</p>
    </div>
    {questions.map((question, index) => <section key={question.id} className="aha-card">
      <div className="aha-cardTitle">{index + 1}. {question.prompt}</div>
      <div className="aha-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
        {question.options.map(option => <button key={option.id} type="button" className="aha-option" data-active={answers[question.id]?.choice?.includes(option.id) ?? false} onClick={() => pick(question, option.id)}>
          <b>{option.label}</b>{option.detail ? <small>{option.detail}</small> : null}
        </button>)}
      </div>
      <input className="aha-input" placeholder={t('craftOther')} value={answers[question.id]?.other ?? ''} onChange={event => {
        const value = event.currentTarget.value
        setAnswers(current => ({ ...current, [question.id]: { choice: current[question.id]?.choice ?? [], other: value } }))
      }} />
    </section>)}
    <section className="aha-card">
      <div className="aha-cardTitle">{t('craftPace')}</div>
      <div className="aha-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
        {PACES.map(([value, label, hint]) => <button key={value} type="button" className="aha-option" data-active={timeline === value} onClick={() => setTimeline(value)}><b>{t(label)}</b><small>{t(hint)}</small></button>)}
      </div>
      <div className="aha-row">
        <label className="aha-label" style={{ flex: 1, minWidth: 220 }}>{t('weeklyMinutes')}
          <select className="aha-select" value={weekly} onChange={event => setWeekly(Number(event.currentTarget.value))}>
            {WEEKLY.map(value => <option key={value} value={value}>{t('minutesUnit', { minutes: value })}</option>)}
          </select>
        </label>
        <label className="aha-label" style={{ flex: 1, minWidth: 220 }}>{t('deadline')}
          <input className="aha-input" type="date" value={deadline} onChange={event => setDeadline(event.currentTarget.value)} />
        </label>
      </div>
    </section>
    <ErrorLine error={job.error} />
    <div className="aha-row"><button type="button" className="aha-btn" data-kind="primary" onClick={submit}>{t('makeBlueprint')}</button></div>
  </div>
}

function cloneUnits(units) {
  return JSON.parse(JSON.stringify(units ?? []))
}

function moveIn(list, index, delta) {
  const next = [...list]
  const target = index + delta
  if (target < 0 || target >= next.length) return list
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function Blueprint({ course, job, onChange }) {
  const { api, t, toast } = useApp()
  const [units, setUnits] = useState(() => cloneUnits(course.units))
  const [title, setTitle] = useState(course.title)
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    setUnits(cloneUnits(course.units))
    setTitle(course.title)
    setDirty(false)
  }, [course])

  const edit = mutate => {
    setUnits(current => {
      const next = cloneUnits(current)
      mutate(next)
      return next.filter(unit => unit.lectures.length).map(unit => ({ ...unit, lectures: unit.lectures.filter(lecture => lecture.lessons.length) }))
    })
    setDirty(true)
  }

  const lessonCount = useMemo(() => units.reduce((sum, unit) => sum + unit.lectures.reduce((inner, lecture) => inner + lecture.lessons.length, 0), 0), [units])
  const minutes = useMemo(() => units.reduce((sum, unit) => sum + unit.lectures.reduce((inner, lecture) => inner + lecture.lessons.reduce((acc, lesson) => acc + (lesson.estMinutes || 15), 0), 0), 0), [units])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.call('course/save-blueprint', { courseId: course.id, blueprint: { ...course, title, units } })
      setDirty(false)
      toast(t('saved'))
      onChange()
      return true
    } catch (failure) {
      setError(failure)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function revise(event) {
    event.preventDefault()
    if (!instruction.trim()) return
    if (dirty && !(await save())) return
    try {
      await job.run('course/revise', { courseId: course.id, instruction })
      setInstruction('')
      onChange()
    } catch {
      // shown below
    }
  }

  async function confirm() {
    if (dirty && !(await save())) return
    try {
      await job.run('course/confirm', { courseId: course.id })
      onChange()
    } catch {
      // shown below
    }
  }

  if (job.running) {
    const label = job.progress?.label === 'practice' || job.progress?.label === 'projects'
      ? t('confirming', { done: job.progress.done, total: job.progress.total })
      : job.progress?.done ? t('revisingSoFar', { count: job.progress.done })
        : t('revising')
    return <div className="aha-page"><h2 className="aha-title">{course.emoji} {course.title}</h2><JobProgress progress={job.progress} label={label} onCancel={job.cancel} /></div>
  }

  return <div className="aha-page">
    <div className="aha-spread">
      <div className="aha-col" style={{ gap: 4, flex: 1 }}>
        <span className="aha-hint">{t('blueprintTitle')}</span>
        <div className="aha-row" style={{ flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 28 }}>{course.emoji}</span>
          <input className="aha-input aha-title" style={{ border: 'none', padding: '2px 4px' }} value={title} onChange={event => { setTitle(event.currentTarget.value); setDirty(true) }} />
        </div>
        {course.subtitle ? <p className="aha-subtitle">{course.subtitle}</p> : null}
        <p className="aha-hint">{t('lessonsCount', { done: 0, total: lessonCount })} · {t('minutesLeft', { minutes })}</p>
      </div>
      <div className="aha-row">
        {dirty ? <button type="button" className="aha-btn" disabled={saving} onClick={save}>{t('saveEdits')}</button> : null}
        <button type="button" className="aha-btn" data-kind="primary" onClick={confirm}>{t('confirmCourse')}</button>
      </div>
    </div>
    {course.summary ? <p>{course.summary}</p> : null}
    <p className="aha-hint">{t('blueprintHint')}</p>
    <form className="aha-row" onSubmit={revise}>
      <input className="aha-input" style={{ flex: 1 }} value={instruction} placeholder={t('revisePlaceholder')} onChange={event => setInstruction(event.currentTarget.value)} aria-label={t('reviseLabel')} />
      <button type="submit" className="aha-btn" disabled={!instruction.trim()}>{t('revise')}</button>
    </form>
    <ErrorLine error={error ?? job.error} />

    <div className="aha-tree">
      {units.map((unit, unitIndex) => <div key={unit.id ?? unitIndex} className="aha-unit">
        <div className="aha-lesson" style={{ fontWeight: 650 }}>
          <span className="aha-tag">{t('unitN', { n: unitIndex + 1 })}</span>
          <input value={unit.title} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].title = value }) }} />
          <RowTools onUp={() => edit(next => { next.splice(0, next.length, ...moveIn(next, unitIndex, -1)) })} onDown={() => edit(next => { next.splice(0, next.length, ...moveIn(next, unitIndex, 1)) })} onRemove={() => edit(next => { next.splice(unitIndex, 1) })} />
        </div>
        {unit.lectures.map((lecture, lectureIndex) => <div key={lecture.id ?? lectureIndex} className="aha-lecture">
          <div className="aha-lesson" style={{ fontWeight: 600 }}>
            <span className="aha-hint">{t('lectureN', { n: lectureIndex + 1 })}</span>
            <input value={lecture.title} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].lectures[lectureIndex].title = value }) }} />
            <RowTools onUp={() => edit(next => { const list = next[unitIndex].lectures; list.splice(0, list.length, ...moveIn(list, lectureIndex, -1)) })} onDown={() => edit(next => { const list = next[unitIndex].lectures; list.splice(0, list.length, ...moveIn(list, lectureIndex, 1)) })} onRemove={() => edit(next => { next[unitIndex].lectures.splice(lectureIndex, 1) })} />
          </div>
          {lecture.lessons.map((lesson, lessonIndex) => <div key={lesson.id ?? lessonIndex} className="aha-lesson">
            <span className="aha-dot" />
            <input value={lesson.title} title={lesson.summary} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].lectures[lectureIndex].lessons[lessonIndex].title = value }) }} />
            <span className="aha-hint">{t('estMinutes', { minutes: lesson.estMinutes })}</span>
            <RowTools onUp={() => edit(next => { const list = next[unitIndex].lectures[lectureIndex].lessons; list.splice(0, list.length, ...moveIn(list, lessonIndex, -1)) })} onDown={() => edit(next => { const list = next[unitIndex].lectures[lectureIndex].lessons; list.splice(0, list.length, ...moveIn(list, lessonIndex, 1)) })} onRemove={() => edit(next => { next[unitIndex].lectures[lectureIndex].lessons.splice(lessonIndex, 1) })} />
          </div>)}
          <div><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => edit(next => { next[unitIndex].lectures[lectureIndex].lessons.push({ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }) })}>+ {t('addLesson')}</button></div>
        </div>)}
        <div><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => edit(next => { next[unitIndex].lectures.push({ title: t('untitled'), lessons: [{ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }] }) })}>+ {t('addLecture')}</button></div>
      </div>)}
      <div><button type="button" className="aha-btn" data-kind="ghost" onClick={() => edit(next => { next.push({ title: t('untitled'), objectives: [], lectures: [{ title: t('untitled'), lessons: [{ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }] }] }) })}>+ {t('addUnit')}</button></div>
    </div>

    {course.projects?.length ? <section className="aha-col">
      <h3 className="aha-cardTitle">{t('projects')}</h3>
      <div className="aha-grid">{course.projects.map(project => <div key={project.id} className="aha-card"><b>{project.title}</b><p className="aha-hint">{project.brief}</p></div>)}</div>
    </section> : null}
  </div>
}

function RowTools({ onUp, onDown, onRemove }) {
  const { t } = useApp()
  return <span className="aha-row" style={{ gap: 2, flexWrap: 'nowrap' }}>
    <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onUp} title={t('moveUp')} aria-label={t('moveUp')}>↑</button>
    <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onDown} title={t('moveDown')} aria-label={t('moveDown')}>↓</button>
    <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onRemove} title={t('remove')} aria-label={t('remove')}>✕</button>
  </span>
}
