import { useRef, useState } from 'react'

import { Empty, ErrorLine, Progress, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'

const FILTERS = [['all', 'filterAll'], ['active', 'filterActive'], ['done', 'filterDone'], ['archived', 'filterArchived']]

export function CoursesScreen() {
  const { api, t, navigate, toast } = useApp()
  const courses = useLoad(() => api.call('course/list'), [])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const input = useRef(null)

  const rows = (courses.value ?? []).filter(course => {
    if (filter === 'archived') return course.archived
    if (course.archived) return false
    if (filter === 'active') return course.status !== 'ready' || course.progress.percent < 100
    if (filter === 'done') return course.status === 'ready' && course.progress.percent >= 100
    return true
  }).filter(course => !query.trim() || `${course.title} ${course.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()))

  async function importPack(file) {
    setError(null)
    try {
      const json = await file.text()
      const course = await api.call('course/import', { json })
      toast(t('courseReady'))
      navigate('course', { courseId: course.id })
    } catch (failure) {
      setError(failure)
    }
  }

  return <div className="aha-page">
    <div className="aha-spread">
      <h2 className="aha-title">{t('coursesTitle')}</h2>
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={() => input.current?.click()}>{t('importPack')}</button>
        <button type="button" className="aha-btn" data-kind="primary" onClick={() => navigate('home')}>+ {t('modeCourse')}</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) importPack(file); event.currentTarget.value = '' }} />
      </div>
    </div>
    <div className="aha-spread">
      <div className="aha-row" style={{ gap: 6 }}>{FILTERS.map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={filter === value} onClick={() => setFilter(value)}>{t(label)}</button>)}</div>
      <input className="aha-input" style={{ maxWidth: 260 }} value={query} placeholder={t('searchCourses')} onChange={event => setQuery(event.currentTarget.value)} />
    </div>
    <ErrorLine error={error ?? courses.error} />
    {courses.loading && !courses.value ? <Spinner label={t('loading')} /> : rows.length ? <div className="aha-grid">
      {rows.map(course => <div key={course.id} className="aha-card" data-click="true" onClick={() => navigate(course.status === 'ready' ? 'course' : 'craft', { courseId: course.id })}>
        <div className="aha-row" style={{ flexWrap: 'nowrap' }}><span style={{ fontSize: 26 }}>{course.emoji}</span><span className="aha-cardTitle">{course.title}</span></div>
        {course.subtitle ? <p className="aha-hint">{course.subtitle}</p> : null}
        {course.status === 'ready' ? <>
          <Progress value={course.progress.percent} />
          <span className="aha-hint">{t('lessonsCount', course.progress)}{course.next ? ` · ${t('nextUp', { title: course.next.title })}` : ''}</span>
        </> : <span className="aha-tag">{course.status === 'intake' ? t('statusIntake') : t('statusBlueprint')}</span>}
      </div>)}
    </div> : <Empty>{t('noCourses')}</Empty>}
  </div>
}
