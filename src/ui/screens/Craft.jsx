import { useEffect, useMemo, useRef, useState } from 'react'

import { blueprintDiff, diffIsEmpty, LESSON_DEPTHS } from '../../core/course-model.js'
import { BlueprintMap } from '../BlueprintMap.jsx'
import { Confirm, ErrorLine, JobProgress, MaterialPicker, SourceList, Spinner } from '../components.jsx'
import { useApp, useJob, useLoad } from '../hooks.js'
import { outlineTree } from '../mindmap.js'

const PACES = [['intensive', 'paceIntensive', 'paceIntensiveHint'], ['balanced', 'paceBalanced', 'paceBalancedHint'], ['relaxed', 'paceRelaxed', 'paceRelaxedHint']]
const SIZES = [['auto', 'sizeAuto', 'sizeAutoHint'], ['short', 'sizeShort', 'sizeShortHint'], ['standard', 'sizeStandard', 'sizeStandardHint'], ['full', 'sizeFull', 'sizeFullHint']]
const WEEKLY = [60, 120, 180, 300, 420, 600]

// Course crafting: intake questions → blueprint (edit / revise) → confirm.
// `edit` reopens the editor for a course that is already running; `add`
// opens it with the panel for adding materials.
export function CraftScreen({ jobId, courseId, edit = false, add = false }) {
  const { api, t, navigate } = useApp()
  const [error, setError] = useState(null)
  const [stage, setStage] = useState('questions')

  // Arriving from Home with a start job: wait for it, then switch to the course.
  useEffect(() => {
    if (!jobId || courseId) return undefined
    const controller = new AbortController()
    api.follow({ job: { id: jobId, status: 'running' } }, { signal: controller.signal, onProgress: progress => setStage(progress?.label === 'research' ? 'research' : 'questions') })
      .then(result => navigate('craft', { courseId: result.courseId }, { replace: true }))
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [jobId, courseId])

  if (!courseId) {
    return <div className="aha-page">
      <h2 className="aha-title">{t('craftQuestionsTitle')}</h2>
      {error ? <><ErrorLine error={error} /><button type="button" className="aha-btn" onClick={() => navigate('home')}>{t('back')}</button></> : <Spinner label={stage === 'research' ? t('researching') : t('thinkingQuestions')} />}
    </div>
  }
  return <CraftCourse courseId={courseId} edit={edit} add={add} />
}

function CraftCourse({ courseId, edit, add }) {
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
    if (course?.status === 'ready' && !job.running && !edit) navigate('course', { courseId }, { replace: true })
  }, [course?.status])

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (detail.error && !detail.value) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  if (!course) return null

  if (course.status === 'intake') {
    return <Intake course={course} intake={detail.value.intake} job={job} onDone={() => detail.reload()} />
  }
  return <Blueprint course={course} proposal={detail.value.proposal} progress={detail.value.progress} boards={detail.value.ready?.boards ?? []} job={job} onChange={() => detail.reload()} adding={add} />
}

function Intake({ course, intake, job, onDone }) {
  const { t } = useApp()
  const questions = intake?.questionnaire?.questions ?? []
  const [answers, setAnswers] = useState({})
  const [timeline, setTimeline] = useState('balanced')
  const [size, setSize] = useState('auto')
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
      await job.run('course/intake', { courseId: course.id, answers, timeline, size, weeklyMinutes: weekly, deadline: deadline || undefined })
      onDone()
    } catch {
      // shown below
    }
  }

  if (job.running) {
    if (job.progress?.label === 'questions') return <div className="aha-page"><h2 className="aha-title">{course.goal}</h2><JobProgress progress={job.progress} label={t('thinkingQuestions')} onCancel={job.cancel} /></div>
    return <BuildLog course={course} job={job} research={intake?.research} />
  }

  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}>
      <h2 className="aha-title">{t('craftQuestionsTitle')}</h2>
      <p className="aha-subtitle">{course.goal}</p>
      <p className="aha-hint">{t('craftQuestionsHint')}</p>
      {intake?.research ? <ResearchNote research={intake.research} /> : null}
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
      <div className="aha-cardTitle">{t('craftSize')}</div>
      <div className="aha-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
        {SIZES.map(([value, label, hint]) => <button key={value} type="button" className="aha-option" data-active={size === value} onClick={() => setSize(value)}><b>{t(label)}</b><small>{t(hint)}</small></button>)}
      </div>
    </section>
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

// What the web search before the questions found, or why there was none.
function ResearchNote({ research }) {
  const { t } = useApp()
  if (research.skipped) return <p className="aha-hint">{t('researchSkipped', { reason: t(`researchSkipped_${research.skipped}`) })}</p>
  return <details className="aha-sources">
    <summary>{t('researchFound', { count: research.sources.length })}</summary>
    <SourceList sources={research.sources} />
  </details>
}

// While the blueprint is written: what the teacher is doing, and the outline
// growing as a mind map that follows what is written last.
function BuildLog({ course, job, research }) {
  const { t } = useApp()
  const units = job.preview?.units ?? []
  const tree = useMemo(() => outlineTree(job.preview, course.goal), [job.preview, course.goal])
  const lessons = units.reduce((sum, unit) => sum + unit.lectures.reduce((count, lecture) => count + lecture.lessons.length, 0), 0)
  const phase = job.progress?.label === 'materials' ? 'materials' : units.length ? 'lessons' : 'units'
  const steps = [
    ...(research?.sources?.length ? [['research', t('buildResearch', { count: research.sources.length })]] : []),
    ['answers', t('buildAnswers')],
    ...(course.materialIds?.length ? [['materials', t('buildMaterials')]] : []),
    ['units', t('buildUnits')],
    ['lessons', lessons ? t('buildLessonsSoFar', { count: lessons }) : t('buildLessons')],
  ]
  const at = steps.findIndex(([key]) => key === phase)
  return <div className="aha-page">
    <div className="aha-col" style={{ gap: 4 }}>
      <h2 className="aha-title">{job.preview?.title || course.goal}</h2>
      <p className="aha-hint">{t('designingBlueprint')} {t('keepsRunning')}</p>
    </div>
    <ol className="aha-buildLog">
      {steps.map(([key, label], index) => <li key={key} data-state={index < at ? 'done' : index === at ? 'current' : 'todo'}>
        <span className="aha-buildMark" aria-hidden="true">{index < at ? '✓' : index === at ? <span className="aha-spinner" /> : ''}</span>
        <span>{label}</span>
      </li>)}
    </ol>
    {units.length ? <BlueprintMap tree={tree} live /> : null}
    <div className="aha-row"><button type="button" className="aha-btn" data-kind="ghost" onClick={job.cancel}>{t('cancel')}</button></div>
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

// Materials added to a course: chosen (or uploaded) here, then the teacher
// proposes how the outline should use them.
function AddMaterials({ course, job, onDone, onClose }) {
  const { api, t } = useApp()
  const library = useLoad(() => api.call('material/list'), [])
  const [chosen, setChosen] = useState([])
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState('')
  const titles = new Map((library.value ?? []).map(item => [item.id, item.title]))
  async function send() {
    try {
      await job.run('course/add-materials', { courseId: course.id, materialIds: chosen, instruction: note.trim() })
      onDone()
    } catch {
      // shown below
    }
  }
  return <section className="aha-card aha-addMaterials">
    <div className="aha-spread"><b>{t('addMaterialsTitle')}</b><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={onClose}>{t('cancel')}</button></div>
    <p className="aha-hint">{t('addMaterialsHint')}</p>
    <div className="aha-row" style={{ gap: 6 }}>
      {chosen.map(id => <span key={id} className="aha-tag">{titles.get(id) ?? '…'}</span>)}
      <button type="button" className="aha-btn" data-size="sm" onClick={() => { library.reload(); setPicking(true) }}>{chosen.length ? t('changeMaterials') : t('pickMaterials')}</button>
    </div>
    <input className="aha-input" value={note} placeholder={t('addMaterialsPlaceholder')} aria-label={t('addMaterialsPlaceholder')} onChange={event => setNote(event.currentTarget.value)} />
    <div className="aha-row"><button type="button" className="aha-btn" data-kind="primary" disabled={!chosen.length} onClick={send}>{t('addMaterialsSend')}</button></div>
    {picking ? <MaterialPicker selected={chosen} max={12} exclude={course.materialIds ?? []} onChange={value => { setChosen(value); library.reload() }} onClose={() => setPicking(false)} /> : null}
  </section>
}

function Blueprint({ course, proposal, progress, boards, job, onChange, adding: startAdding = false }) {
  const { api, t, toast, navigate } = useApp()
  const ready = course.status === 'ready'
  const [units, setUnits] = useState(() => cloneUnits(course.units))
  const [title, setTitle] = useState(course.title)
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [reworkMenu, setReworkMenu] = useState(null)
  const [reworking, setReworking] = useState(null)
  // A new blueprint opens as a map; a course being edited, as the list.
  const [view, setView] = useState(ready ? 'list' : 'map')
  const [adding, setAdding] = useState(startAdding)
  const [flash, setFlash] = useState(null)
  const tree = useRef(null)
  const rework = useJob()
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
  const diff = useMemo(() => (proposal?.blueprint?.units ? blueprintDiff(course, proposal.blueprint) : null), [course, proposal])
  // A lesson that has been started (or already has a board) has something to lose.
  const started = lesson => Boolean(lesson.id) && ((progress?.lessons?.[lesson.id]?.status ?? 'new') !== 'new' || boards.includes(lesson.id))
  const locked = Boolean(diff) || Boolean(reworking)

  const mapTree = useMemo(() => ({
    title,
    units: units.map((unit, unitIndex) => ({
      key: `u${unitIndex}`,
      title: unit.title,
      lectures: unit.lectures.map((lecture, lectureIndex) => ({
        key: `u${unitIndex}.${lectureIndex}`,
        title: lecture.title,
        lessons: lecture.lessons.map((lesson, lessonIndex) => ({ key: `u${unitIndex}.${lectureIndex}.${lessonIndex}`, title: lesson.title, meta: { depth: lesson.depth, minutes: lesson.estMinutes } })),
      })),
    })),
  }), [units, title])
  const mapMeta = meta => <>
    {meta.depth ? <span className="aha-depth" data-depth={meta.depth}>{t(`depth_${meta.depth}`)}</span> : null}
    <span>{t('estMinutes', { minutes: meta.minutes })}</span>
  </>

  // A lesson picked on the map is shown, and its title ready to edit, in the list.
  useEffect(() => {
    if (!flash || view !== 'list') return undefined
    const row = tree.current?.querySelector(`[data-path="${flash}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row?.querySelector('input')?.focus({ preventScroll: true })
    const timer = setTimeout(() => setFlash(null), 1700)
    return () => clearTimeout(timer)
  }, [flash, view])

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

  // AI changes come back as a proposal: the learner sees the difference first.
  async function revise(event, preset) {
    event?.preventDefault()
    const request = preset ?? instruction.trim()
    if (!request) return
    if (dirty && !(await save())) return
    try {
      await job.run('course/revise', { courseId: course.id, instruction: request })
      setInstruction('')
      onChange()
    } catch {
      // shown below
    }
  }

  async function settle(endpoint, message) {
    setError(null)
    try {
      await api.call(endpoint, { courseId: course.id })
      if (message) toast(message)
      onChange()
    } catch (failure) {
      setError(failure)
    }
  }

  // Split a lesson in two or take it deeper; the result is an unsaved edit.
  async function reworkLesson(unitIndex, lectureIndex, lessonIndex, mode) {
    setReworkMenu(null)
    const unit = units[unitIndex]
    const lecture = unit.lectures[lectureIndex]
    setReworking(`${unitIndex}.${lectureIndex}.${lessonIndex}`)
    try {
      const result = await rework.run('course/rework-lesson', { courseId: course.id, lesson: lecture.lessons[lessonIndex], unitTitle: unit.title, lectureTitle: lecture.title, mode })
      edit(next => { next[unitIndex].lectures[lectureIndex].lessons.splice(lessonIndex, 1, ...result.lessons) })
      toast(t(mode === 'split' ? 'splitDone' : 'deepenDone'))
    } catch {
      // shown below
    } finally {
      setReworking(null)
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

  async function backToCourse() {
    if (dirty && !(await save())) return
    navigate('course', { courseId: course.id })
  }

  if (job.running) {
    const label = job.progress?.label === 'practice' || job.progress?.label === 'projects'
      ? t('confirming', { done: job.progress.done, total: job.progress.total })
      : job.progress?.done ? t('revisingSoFar', { count: job.progress.done })
        : t('revising')
    return <div className="aha-page"><h2 className="aha-title">{course.emoji} {course.title}</h2><JobProgress progress={job.progress} label={label} onCancel={job.cancel} /></div>
  }

  const askRemove = (text, run) => setRemoving({ text, run })

  return <div className="aha-page">
    <div className="aha-spread">
      <div className="aha-col" style={{ gap: 4, flex: 1 }}>
        <span className="aha-hint">{ready ? t('editOutline') : t('blueprintTitle')}</span>
        <div className="aha-row" style={{ flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 28 }}>{course.emoji}</span>
          <input className="aha-input aha-title" style={{ border: 'none', padding: '2px 4px' }} value={title} disabled={locked} onChange={event => { setTitle(event.currentTarget.value); setDirty(true) }} />
        </div>
        {course.subtitle ? <p className="aha-subtitle">{course.subtitle}</p> : null}
        <p className="aha-hint">{t('lessonsCount', { done: 0, total: lessonCount })} · {t('minutesLeft', { minutes })}</p>
      </div>
      <div className="aha-row">
        {dirty ? <button type="button" className="aha-btn" disabled={saving || locked} onClick={save}>{t('saveEdits')}</button> : null}
        {ready
          ? <button type="button" className="aha-btn" data-kind="primary" disabled={saving || locked} onClick={backToCourse}>{dirty ? t('saveAndBack') : t('backToCourse')}</button>
          : <button type="button" className="aha-btn" data-kind="primary" disabled={locked} onClick={confirm}>{t('confirmCourse')}</button>}
      </div>
    </div>
    {course.summary ? <p>{course.summary}</p> : null}

    {diff ? <section className="aha-card aha-proposal">
      <div className="aha-col" style={{ gap: 2 }}>
        <b>{t('proposalTitle')}</b>
        {proposal.materials?.length ? <span className="aha-hint">{t('proposalMaterials', { titles: proposal.materials.map(item => `《${item.title}》`).join('') })}</span> : null}
        {proposal.instruction ? <span className="aha-hint">“{proposal.instruction}”</span> : null}
      </div>
      {diffIsEmpty(diff) ? <p className="aha-hint">{t('proposalNoChange')}</p> : <ul className="aha-diff">
        {diff.title ? <li data-kind="renamed"><span className="aha-diffTag">{t('diffRenamed')}</span>{diff.title.from} → {diff.title.to}</li> : null}
        {diff.unitsAdded.map((unitTitle, index) => <li key={`ua${index}`} data-kind="added"><span className="aha-diffTag">{t('diffAdded')}</span>{t('diffUnit', { title: unitTitle })}</li>)}
        {diff.unitsRemoved.map((unitTitle, index) => <li key={`ur${index}`} data-kind="removed"><span className="aha-diffTag">{t('diffRemoved')}</span>{t('diffUnit', { title: unitTitle })}</li>)}
        {diff.added.map((entry, index) => <li key={`a${index}`} data-kind="added"><span className="aha-diffTag">{t('diffAdded')}</span>{entry.title}<span className="aha-hint"> · {entry.unit}</span></li>)}
        {diff.removed.map((entry, index) => <li key={`r${index}`} data-kind="removed"><span className="aha-diffTag">{t('diffRemoved')}</span>{entry.title}<span className="aha-hint"> · {entry.unit}</span></li>)}
        {diff.renamed.map((entry, index) => <li key={`n${index}`} data-kind="renamed"><span className="aha-diffTag">{t('diffRenamed')}</span>{entry.from} → {entry.to}</li>)}
        {diff.changed.map((entry, index) => <li key={`c${index}`} data-kind="changed"><span className="aha-diffTag">{t('diffChanged')}</span>{entry.title}<span className="aha-hint"> · {entry.unit}</span></li>)}
      </ul>}
      <div className="aha-row">
        <button type="button" className="aha-btn" data-kind="primary" onClick={() => settle('course/proposal-apply', t('proposalApplied'))}>{t('applyProposal')}</button>
        <button type="button" className="aha-btn" onClick={() => settle('course/proposal-discard')}>{t('discardProposal')}</button>
      </div>
    </section> : <>
      <p className="aha-hint">{t('blueprintHint')}</p>
      <form className="aha-row" onSubmit={revise}>
        <input className="aha-input" style={{ flex: 1 }} value={instruction} placeholder={t('revisePlaceholder')} onChange={event => setInstruction(event.currentTarget.value)} aria-label={t('reviseLabel')} />
        <button type="submit" className="aha-btn" disabled={!instruction.trim() || locked}>{t('revise')}</button>
        {ready ? <button type="button" className="aha-btn" disabled={locked} onClick={() => revise(null, t('extendInstruction'))}>{t('extendCourse')}</button> : null}
        <button type="button" className="aha-btn" disabled={locked} aria-expanded={adding} onClick={() => setAdding(value => !value)}>{t('addMaterials')}</button>
      </form>
      {adding ? <AddMaterials course={course} job={job} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChange() }} /> : null}
    </>}
    <ErrorLine error={error ?? job.error ?? rework.error} />

    <div className="aha-viewToggle" role="group" aria-label={t('outlineView')}>
      <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('viewList')}</button>
      <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>{t('viewMap')}</button>
    </div>
    {view === 'map' ? <BlueprintMap tree={mapTree} renderMeta={mapMeta} onPick={key => { setFlash(key); setView('list') }} /> : <fieldset ref={tree} className="aha-tree" disabled={locked}>
      {units.map((unit, unitIndex) => <div key={unit.id ?? unitIndex} className="aha-unit">
        <div className="aha-lesson" style={{ fontWeight: 650 }}>
          <span className="aha-tag">{t('unitN', { n: unitIndex + 1 })}</span>
          <input value={unit.title} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].title = value }) }} />
          <RowTools onUp={() => edit(next => { next.splice(0, next.length, ...moveIn(next, unitIndex, -1)) })} onDown={() => edit(next => { next.splice(0, next.length, ...moveIn(next, unitIndex, 1)) })} onRemove={() => askRemove(t('confirmRemoveUnit', { title: unit.title }), () => edit(next => { next.splice(unitIndex, 1) }))} />
        </div>
        {unit.lectures.map((lecture, lectureIndex) => <div key={lecture.id ?? lectureIndex} className="aha-lecture">
          <div className="aha-lesson" style={{ fontWeight: 600 }}>
            <span className="aha-hint">{t('lectureN', { n: lectureIndex + 1 })}</span>
            <input value={lecture.title} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].lectures[lectureIndex].title = value }) }} />
            <RowTools onUp={() => edit(next => { const list = next[unitIndex].lectures; list.splice(0, list.length, ...moveIn(list, lectureIndex, -1)) })} onDown={() => edit(next => { const list = next[unitIndex].lectures; list.splice(0, list.length, ...moveIn(list, lectureIndex, 1)) })} onRemove={() => askRemove(t('confirmRemoveLecture', { title: lecture.title }), () => edit(next => { next[unitIndex].lectures.splice(lectureIndex, 1) }))} />
          </div>
          {lecture.lessons.map((lesson, lessonIndex) => {
            const key = `${unitIndex}.${lectureIndex}.${lessonIndex}`
            const remove = () => edit(next => { next[unitIndex].lectures[lectureIndex].lessons.splice(lessonIndex, 1) })
            return <div key={lesson.id ?? lessonIndex} className="aha-lesson" data-path={`u${key}`} data-flash={flash === `u${key}` ? 'true' : undefined}>
              <span className="aha-dot" />
              <input value={lesson.title} title={lesson.summary} onChange={event => { const value = event.currentTarget.value; edit(next => { next[unitIndex].lectures[lectureIndex].lessons[lessonIndex].title = value }) }} />
              <select className="aha-depthSelect" data-depth={lesson.depth || undefined} value={lesson.depth ?? ''} title={t('depthTitle')} aria-label={t('depthTitle')}
                onChange={event => { const value = event.currentTarget.value; edit(next => { const target = next[unitIndex].lectures[lectureIndex].lessons[lessonIndex]; if (value) target.depth = value; else delete target.depth }) }}>
                <option value="">{t('depthNone')}</option>
                {LESSON_DEPTHS.map(depth => <option key={depth} value={depth}>{t(`depth_${depth}`)}</option>)}
              </select>
              <span className="aha-hint">{t('estMinutes', { minutes: lesson.estMinutes })}</span>
              {reworking === key ? <Spinner /> : !started(lesson) ? <span className="aha-menuAnchor">
                <button type="button" className="aha-btn" data-kind="ghost" data-size="sm" title={t('reworkLesson')} aria-label={t('reworkLesson')} aria-expanded={reworkMenu === key} onClick={() => setReworkMenu(open => (open === key ? null : key))}>✦</button>
                {reworkMenu === key ? <div className="aha-card aha-menu" onMouseLeave={() => setReworkMenu(null)}>
                  <button type="button" className="aha-btn" data-kind="ghost" onClick={() => reworkLesson(unitIndex, lectureIndex, lessonIndex, 'split')}>{t('splitLesson')}</button>
                  <button type="button" className="aha-btn" data-kind="ghost" onClick={() => reworkLesson(unitIndex, lectureIndex, lessonIndex, 'deepen')}>{t('deepenLesson')}</button>
                </div> : null}
              </span> : null}
              <RowTools onUp={() => edit(next => { const list = next[unitIndex].lectures[lectureIndex].lessons; list.splice(0, list.length, ...moveIn(list, lessonIndex, -1)) })} onDown={() => edit(next => { const list = next[unitIndex].lectures[lectureIndex].lessons; list.splice(0, list.length, ...moveIn(list, lessonIndex, 1)) })} onRemove={() => (started(lesson) ? askRemove(t('confirmRemoveStarted', { title: lesson.title }), remove) : remove())} />
            </div>
          })}
          <div><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => edit(next => { next[unitIndex].lectures[lectureIndex].lessons.push({ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }) })}>+ {t('addLesson')}</button></div>
        </div>)}
        <div><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={() => edit(next => { next[unitIndex].lectures.push({ title: t('untitled'), lessons: [{ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }] }) })}>+ {t('addLecture')}</button></div>
      </div>)}
      <div><button type="button" className="aha-btn" data-kind="ghost" onClick={() => edit(next => { next.push({ title: t('untitled'), objectives: [], lectures: [{ title: t('untitled'), lessons: [{ title: t('untitled'), objectives: [], concepts: [], estMinutes: 15 }] }] }) })}>+ {t('addUnit')}</button></div>
    </fieldset>}

    {course.projects?.length ? <section className="aha-col">
      <h3 className="aha-cardTitle">{t('projects')}</h3>
      <div className="aha-grid">{course.projects.map(project => <div key={project.id} className="aha-card"><b>{project.title}</b><p className="aha-hint">{project.brief}</p></div>)}</div>
    </section> : null}
    {removing ? <Confirm danger text={removing.text} onConfirm={() => { removing.run(); setRemoving(null) }} onCancel={() => setRemoving(null)} /> : null}
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
