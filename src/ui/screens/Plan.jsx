import { useEffect, useMemo, useState } from 'react'

import { ErrorLine, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { PlanItem, togglePlanItem } from '../PlanItem.jsx'
import { parseDay, toDay } from '../../core/planner.js'

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
  const today = toDay(new Date())
  const [selected, setSelected] = useState(today)

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

  async function toggle(item, day) {
    setError(null)
    try {
      plan.setValue(await togglePlanItem(api, item, day, today))
    } catch (failure) {
      setError(failure)
    }
  }

  const courseTitle = id => courses.value?.find(course => course.id === id)?.title ?? ''
  const calendar = plan.value?.calendar ?? []
  const selectedItems = calendar.find(entry => entry.day === selected)?.items ?? []

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
    {plan.loading && !plan.value ? <Spinner label={t('loading')} /> : <>
      <PlanCalendar days={calendar} today={today} selected={selected} onSelect={setSelected} weekdayNames={weekdayNames} />
      <section className="aha-card">
        <b>{selected === today ? `${t('today')} · ` : ''}{t('dayLabel', { month: parseDay(selected).getMonth() + 1, day: parseDay(selected).getDate(), weekday: weekdayNames[parseDay(selected).getDay()] })}</b>
        {selectedItems.length
          ? selectedItems.map(item => <PlanItem key={`${item.kind}:${item.refId}`} item={item} day={selected} today={today} onToggle={toggle} />)
          : <p className="aha-hint">{selected === today ? t('noPlanToday') : t('dayEmpty')}</p>}
      </section>
    </>}
  </div>
}

const pad = value => String(value).padStart(2, '0')
const shiftMonth = (month, delta) => {
  const date = parseDay(`${month}-01`)
  date.setMonth(date.getMonth() + delta)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

// A month at a time, weeks starting on Monday: each day lists what was or
// is planned, ticked items marked.
function PlanCalendar({ days, today, selected, onSelect, weekdayNames }) {
  const { t } = useApp()
  const [month, setMonth] = useState(today.slice(0, 7))
  const byDay = useMemo(() => new Map(days.map(entry => [entry.day, entry.items])), [days])
  const first = parseDay(`${month}-01`)
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = [...Array((first.getDay() + 6) % 7).fill(null), ...Array.from({ length }, (_, index) => `${month}-${pad(index + 1)}`)]
  return <section className="aha-card aha-calendar">
    <div className="aha-spread">
      <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setMonth(value => shiftMonth(value, -1))} aria-label={t('prevMonth')}>‹</button>
      <b>{t('monthLabel', { year: first.getFullYear(), month: first.getMonth() + 1 })}</b>
      <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => setMonth(value => shiftMonth(value, 1))} aria-label={t('nextMonth')}>›</button>
    </div>
    <div className="aha-calGrid">
      {[1, 2, 3, 4, 5, 6, 0].map(day => <span key={day} className="aha-calHead">{weekdayNames[day]}</span>)}
      {cells.map((day, index) => {
        if (!day) return <span key={`gap${index}`} />
        const items = byDay.get(day) ?? []
        const finished = items.length > 0 && items.every(item => item.kind === 'exam' || item.checked)
        return <button key={day} type="button" className="aha-calDay" data-today={day === today ? 'true' : undefined} data-selected={day === selected ? 'true' : undefined} data-past={day < today ? 'true' : undefined} onClick={() => onSelect(day)}>
          <span className="aha-calNum">{Number(day.slice(8))}{finished ? ' ✓' : ''}</span>
          {items.slice(0, 3).map(item => <span key={`${item.kind}:${item.refId}`} className="aha-calItem" data-kind={item.kind} data-checked={item.checked ? 'true' : undefined}>{item.title}</span>)}
          {items.length > 3 ? <span className="aha-calMore">+{items.length - 3}</span> : null}
        </button>
      })}
    </div>
  </section>
}
