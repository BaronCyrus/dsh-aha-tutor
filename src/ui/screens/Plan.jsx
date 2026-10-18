import { useEffect, useState } from 'react'

import { Empty, ErrorLine, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { toDay } from '../../core/planner.js'

const WEEKLY = [60, 120, 180, 240, 300, 420, 600, 900]

export function PlanScreen() {
  const { api, t, navigate } = useApp()
  const plan = useLoad(() => api.call('plan/get', { today: toDay(new Date()) }), [])
  const review = useLoad(() => api.call('review/session'), [])
  const courses = useLoad(() => api.call('course/list'), [])
  const [weekly, setWeekly] = useState(300)
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 0])
  const [exam, setExam] = useState({ title: '', day: '', courseId: '' })
  const [error, setError] = useState(null)
  const weekdayNames = t('weekdays').split(',')

  useEffect(() => {
    if (!plan.value) return
    setWeekly(plan.value.settings.weeklyMinutes)
    setDays(plan.value.settings.studyDays)
  }, [plan.value?.settings])

  async function save() {
    setError(null)
    try {
      plan.setValue(await api.call('plan/settings', { weeklyMinutes: weekly, studyDays: days }))
    } catch (failure) {
      setError(failure)
    }
  }

  async function addExam(event) {
    event.preventDefault()
    if (!exam.title.trim() || !exam.day) return
    try {
      plan.setValue(await api.call('plan/add-exam', { ...exam, courseId: exam.courseId || undefined }))
      setExam({ title: '', day: '', courseId: '' })
    } catch (failure) {
      setError(failure)
    }
  }

  const courseTitle = id => courses.value?.find(course => course.id === id)?.title ?? ''
  const schedule = plan.value?.plan.days.slice(0, 14) ?? []

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}><h2 className="aha-title">{t('planTitle')}</h2><p className="aha-hint">{t('planHint')}</p></div>
    <section className="aha-card">
      <div className="aha-spread">
        <b>{review.value?.items?.length ? t('reviewDue', { count: review.value.items.length }) : t('nothingToReview')}</b>
        <button type="button" className="aha-btn" data-kind="primary" disabled={!review.value?.items?.length} onClick={() => navigate('practice', { review: true })}>{t('startReview')}</button>
      </div>
    </section>
    <section className="aha-card">
      <div className="aha-row">
        <label className="aha-label" style={{ minWidth: 200 }}>{t('weeklyMinutes')}
          <select className="aha-select" value={weekly} onChange={event => setWeekly(Number(event.currentTarget.value))}>{WEEKLY.map(value => <option key={value} value={value}>{t('minutesUnit', { minutes: value })}</option>)}</select>
        </label>
        <div className="aha-label">{t('studyDays')}
          <div className="aha-row" style={{ gap: 4 }}>{[1, 2, 3, 4, 5, 6, 0].map(day => <button key={day} type="button" className="aha-chip" data-active={days.includes(day)} onClick={() => setDays(current => (current.includes(day) ? current.filter(value => value !== day) : [...current, day]))}>{weekdayNames[day]}</button>)}</div>
        </div>
        <button type="button" className="aha-btn" data-kind="primary" onClick={save}>{t('savePlan')}</button>
      </div>
      {(plan.value?.plan.warnings ?? []).filter(warning => warning.kind === 'deadline-at-risk').map(warning => <div key={warning.courseId} className="aha-feedback" data-ok="false">{t('deadlineRisk', { course: courseTitle(warning.courseId), finish: warning.finishDay, deadline: warning.deadline, minutes: warning.neededWeeklyMinutes })}</div>)}
    </section>
    <section className="aha-card">
      <b>{t('exams')}</b>
      {(plan.value?.exams ?? []).map(item => <div key={item.id} className="aha-spread"><span>{item.title} · {item.day}{item.courseId ? ` · ${courseTitle(item.courseId)}` : ''}</span><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={async () => plan.setValue(await api.call('plan/remove-exam', { id: item.id }))}>{t('delete')}</button></div>)}
      <form className="aha-row" onSubmit={addExam}>
        <input className="aha-input" style={{ flex: 2, minWidth: 160 }} placeholder={t('examTitle')} value={exam.title} onChange={event => setExam({ ...exam, title: event.currentTarget.value })} />
        <input className="aha-input" style={{ flex: 1, minWidth: 140 }} type="date" value={exam.day} onChange={event => setExam({ ...exam, day: event.currentTarget.value })} />
        <select className="aha-select" style={{ flex: 1, minWidth: 140 }} value={exam.courseId} onChange={event => setExam({ ...exam, courseId: event.currentTarget.value })}>
          <option value="">—</option>
          {(courses.value ?? []).filter(course => course.status === 'ready').map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
        <button type="submit" className="aha-btn">{t('addExam')}</button>
      </form>
    </section>
    <ErrorLine error={error ?? plan.error} />
    {plan.loading && !plan.value ? <Spinner label={t('loading')} /> : schedule.length ? <section className="aha-col">
      {schedule.map(day => <div key={day.day} className="aha-card">
        <div className="aha-spread"><b>{day.day === toDay(new Date()) ? t('today') : day.day} · {weekdayNames[new Date(`${day.day}T12:00:00`).getDay()]}</b><span className="aha-hint">{t('minutesUnit', { minutes: day.minutes })}</span></div>
        {day.items.map((item, index) => <div key={`${item.refId}-${index}`} className="aha-spread">
          <span><span className="aha-tag">{item.kind === 'lesson' ? t('lessonItem') : item.kind === 'review' ? t('reviewItem') : t('examItem')}</span> {item.title}{item.courseTitle ? <span className="aha-hint"> · {item.courseTitle}</span> : null}</span>
          {item.kind === 'lesson' ? <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('lesson', { courseId: item.courseId, lessonId: item.refId })}>{t('learn')}</button> : null}
        </div>)}
      </div>)}
    </section> : <Empty>{t('noPlanToday')}</Empty>}
  </div>
}
