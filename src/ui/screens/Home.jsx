import { useRef, useState } from 'react'

import { describeMaterial, Empty, ErrorLine, errorText, MaterialPicker, Modal, Progress, Spinner, useLibraryIntake } from '../components.jsx'
import { useApp, useLoad, usePersistentState } from '../hooks.js'
import { Icon } from '../icons.jsx'
import { PictureChips, useFileDrop, usePictureUploads } from '../pictures.jsx'
import { PlanItem, togglePlanItem } from '../PlanItem.jsx'
import { LIMITS } from '../../core/course-model.js'
import { isPictureFile } from '../../core/pictures.js'
import { toDay } from '../../core/planner.js'

const MODES = [
  ['course', 'modeCourse', '🎓'],
  ['explain', 'modeExplain', '💡'],
  ['solve', 'modeSolve', '🧮'],
  ['visualize', 'modeVisualize', '📈'],
  ['digest', 'modeDigest', '📚'],
  ['short', 'modeShort', '🎬'],
]
// The modes that open 即时答疑: pictures dropped in them go with the
// question, not into the library.
const QUESTION_MODES = ['explain', 'solve', 'visualize']

export function HomeScreen() {
  const { api, t, navigate, toast } = useApp()
  const [mode, setMode] = useState('course')
  // Web research before a course: on by default, off when materials are
  // attached (they set the scope), and the learner's own choice wins.
  const [webDefault, setWebDefault] = usePersistentState('craftWeb', true)
  const [webChoice, setWebChoice] = useState(null)
  const [text, setText] = useState('')
  const [materialIds, setMaterialIds] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [digestChoice, setDigestChoice] = useState(null)
  const [leftOut, setLeftOut] = useState(0)
  const pictures = usePictureUploads()
  // Files dropped or pasted follow the mode they came in: into the library
  // (a course, a digest, a question's documents), or with the question.
  const attachedNow = useRef(materialIds)
  attachedNow.current = materialIds
  const droppedIn = useRef(mode)
  function attach(added) {
    const current = attachedNow.current
    const fresh = added.map(item => item.id).filter(id => !current.includes(id))
    const room = Math.max(0, LIMITS.materials - current.length)
    setMaterialIds([...current, ...fresh.slice(0, room)])
    setLeftOut(Math.max(0, fresh.length - room))
  }
  const intake = useLibraryIntake({
    onAdded: added => {
      if (droppedIn.current === 'digest' && added.length === 1) {
        navigate('item', { kind: 'digest', materialId: added[0].id })
        return
      }
      attach(added)
      if (droppedIn.current === 'digest' && added.length > 1) setDigestChoice(added)
    },
  })
  const drop = useFileDrop(({ files, folders }) => {
    setNotice(null)
    if (mode === 'short') {
      setNotice('shortNoFiles')
      return
    }
    droppedIn.current = mode
    const asks = QUESTION_MODES.includes(mode)
    const shots = asks ? files.filter(file => isPictureFile(file)) : []
    if (shots.length) pictures.add(shots)
    intake.take({ files: asks ? files.filter(file => !isPictureFile(file)) : files, folders })
  })
  const courses = useLoad(() => api.call('course/list'), [])
  const plan = useLoad(() => api.call('plan/get', { today: toDay(new Date()) }), [])
  const samples = useLoad(() => api.call('samples/list'), [])

  const web = webChoice ?? (materialIds.length ? false : webDefault)
  function toggleWeb() {
    setWebChoice(!web)
    if (!materialIds.length) setWebDefault(!web)
  }

  // Pictures pasted for a question go into the library when the mode is
  // then changed to a course or a digest (存进资料库), as their materials.
  async function keepPictures() {
    const ids = []
    for (const picture of pictures.ready) ids.push((await api.run('picture/keep', { id: picture.id })).material.id)
    return ids
  }

  async function start(quick = false) {
    const goal = text.trim()
    setError(null)
    if (pictures.busy) return
    if (mode === 'course') {
      if (!goal && !materialIds.length && !pictures.ready.length) return
      setBusy(true)
      try {
        const kept = await keepPictures()
        const { job } = await api.call('course/start', { goal, materialIds: [...new Set([...materialIds, ...kept])].slice(0, LIMITS.materials), quick, web })
        navigate('craft', { jobId: job.id })
      } catch (failure) {
        setError(failure)
      } finally {
        setBusy(false)
      }
      return
    }
    if (mode === 'digest') {
      let ids = materialIds
      if (pictures.ready.length) {
        setBusy(true)
        try {
          ids = [...new Set([...materialIds, ...await keepPictures()])]
        } catch (failure) {
          setError(failure)
          return
        } finally {
          setBusy(false)
        }
      }
      if (!ids.length) {
        setPicking(true)
        return
      }
      if (ids.length === 1) {
        navigate('item', { kind: 'digest', materialId: ids[0] })
        return
      }
      // A digest reads one document: the learner picks which.
      try {
        const library = await api.call('material/list')
        setDigestChoice(ids.map(id => library.find(item => item.id === id)).filter(Boolean))
      } catch (failure) {
        setError(failure)
      }
      return
    }
    if (mode === 'short') {
      const isUrl = /^https?:\/\//iu.test(goal)
      navigate('shorts', { draftTopic: isUrl ? '' : goal, draftUrl: isUrl ? goal : '', token: Date.now().toString(36) })
      return
    }
    if (!goal && !pictures.ready.length) return
    navigate('assist', { draftMode: mode, draftRequest: goal, draftMaterials: materialIds, draftPictures: pictures.ready, token: Date.now().toString(36) })
  }

  const active = (courses.value ?? []).filter(course => course.status === 'ready' && !course.archived && course.progress.percent < 100).slice(0, 3)
  const pending = (courses.value ?? []).filter(course => course.status !== 'ready' && !course.archived).slice(0, 2)
  const today = plan.value?.today ?? []
  const todayDay = toDay(new Date())
  async function toggle(item, day) {
    try {
      plan.setValue(await togglePlanItem(api, item, day, todayDay))
    } catch (failure) {
      setError(failure)
    }
  }

  return <div className="aha-page">
    <section className="aha-hero">
      <div className="aha-heroTitle">{t('heroTitle')}</div>
      <p className="aha-subtitle">{t('heroHint')}</p>
      <div className="aha-composer" {...drop.box}>
        <textarea value={text} placeholder={t('heroPlaceholder')} onChange={event => setText(event.currentTarget.value)} onPaste={drop.paste}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start() }} />
        <PictureChips uploads={pictures} />
        {pictures.items.length && !QUESTION_MODES.includes(mode) ? <p className="aha-hint" role="status">{t(mode === 'short' ? 'shortNoFiles' : 'picturesToLibrary')}</p> : null}
        <div className="aha-spread">
          <div className="aha-row" style={{ gap: 6 }}>
            <button type="button" className="aha-btn" data-size="sm" onClick={() => setPicking(true)}><Icon name="plus" size={15} />{materialIds.length ? t('attached', { count: materialIds.length }) : t('attach')}</button>
            {mode === 'course' ? <button type="button" className="aha-chip" data-active={web} aria-pressed={web} onClick={toggleWeb} title={t('webResearchHint')}>🌐 {t('webResearch')}</button> : null}
          </div>
          <div className="aha-row" style={{ gap: 6 }}>
            {mode === 'course' ? <button type="button" className="aha-btn" data-kind="ghost" disabled={busy} onClick={() => start(true)}>{t('quickStart')}</button> : null}
            <button type="button" className="aha-btn" data-kind="primary" disabled={busy || pictures.busy || (!text.trim() && !materialIds.length && !pictures.ready.length)} onClick={() => start(false)}>{busy ? <span className="aha-spinner" /> : null}{t('start')}</button>
          </div>
        </div>
        {drop.box['data-over'] ? <div className="aha-dropCover" aria-hidden="true">{t(mode === 'short' ? 'shortNoFiles' : 'dropToAttach')}</div> : null}
      </div>
      {intake.status}
      {leftOut ? <p className="aha-hint" role="status">{t('pickLeftOut', { count: leftOut, max: LIMITS.materials })}</p> : null}
      {notice ? <p className="aha-hint" role="status">{t(notice)}</p> : null}
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
        {today.map(item => <div key={`${item.kind}:${item.refId}`} className="aha-card" style={{ padding: '6px 14px' }}>
          <PlanItem item={item} day={todayDay} today={todayDay} onToggle={toggle} />
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
              toast(errorText(t, failure))
            }
          }}>{t('importSample')}</button>
        </div>)}
      </div>
    </section> : null}

    {picking ? <MaterialPicker selected={materialIds} onChange={setMaterialIds} onClose={() => setPicking(false)} /> : null}
    {digestChoice ? <Modal title={t('digestWhich')} onClose={() => setDigestChoice(null)} width={560}>
      <p className="aha-hint">{t('digestWhichHint')}</p>
      <div className="aha-col" style={{ gap: 6, maxHeight: 360, overflow: 'auto' }}>
        {digestChoice.map(item => <button key={item.id} type="button" className="aha-option" onClick={() => { setDigestChoice(null); navigate('item', { kind: 'digest', materialId: item.id }) }}>
          <b>{item.title}</b><small>{describeMaterial(item, t)}</small>
        </button>)}
      </div>
    </Modal> : null}
  </div>
}
