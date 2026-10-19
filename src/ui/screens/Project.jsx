import { useState } from 'react'

import { copyText, ErrorLine, JobProgress, Spinner } from '../components.jsx'
import { useApp, useJob, useLoad } from '../hooks.js'
import { Icon } from '../icons.jsx'
import { RichText } from '../markdown.jsx'

export function ProjectScreen({ courseId, projectId }) {
  const { api, t, dsh, toast } = useApp()
  const detail = useLoad(() => api.call('project/get', { courseId, projectId }), [courseId, projectId])
  const job = useJob()
  const [notes, setNotes] = useState('')
  const [includeFiles, setIncludeFiles] = useState(true)
  const [workspace, setWorkspace] = useState(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(null)

  if (detail.loading && !detail.value) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  if (!detail.value) return <div className="aha-page"><ErrorLine error={detail.error} /></div>
  const { project, submissions } = detail.value
  const folder = workspace?.path ?? detail.value.workspace

  async function open() {
    setOpening(true)
    setError(null)
    try {
      const result = await api.call('project/open', { courseId, projectId })
      setWorkspace(result)
      const opened = await dsh.openWorkspace(result.path, result.prompt).catch(() => false)
      toast(opened ? t('workspaceSession') : t('workspaceReady', { path: result.path }))
    } catch (failure) {
      setError(failure)
    } finally {
      setOpening(false)
    }
  }

  async function submit() {
    try {
      await job.run('project/submit', { courseId, projectId, notes, includeWorkspace: includeFiles })
      setNotes('')
      detail.reload()
    } catch {
      // shown below
    }
  }

  return <div className="aha-page" style={{ maxWidth: 900 }}>
    <h2 className="aha-title">{project.title}</h2>
    <section className="aha-card"><b>{t('projectBrief')}</b><RichText text={project.brief} /></section>
    {project.milestones?.length ? <section className="aha-card"><b>{t('milestones')}</b><ol style={{ margin: 0, paddingLeft: 20 }}>{project.milestones.map(item => <li key={item.id}><b>{item.title}</b>{item.detail ? <div className="aha-hint">{item.detail}</div> : null}</li>)}</ol></section> : null}
    {project.rubric?.length ? <section className="aha-card"><b>{t('rubric')}</b>{project.rubric.map(item => <div key={item.id} className="aha-spread"><span>{item.criterion}{item.detail ? <span className="aha-hint"> · {item.detail}</span> : null}</span><span className="aha-tag">{item.points}</span></div>)}</section> : null}

    <section className="aha-card">
      <div className="aha-row">
        <button type="button" className="aha-btn" data-kind="primary" disabled={opening} onClick={open}><Icon name="folder" size={15} />{opening ? t('openingWorkspace') : t('openWorkspace')}</button>
        {folder ? <><code className="aha-hint" style={{ overflowWrap: 'anywhere' }}>{folder}</code><button type="button" className="aha-btn" data-size="sm" data-kind="ghost" onClick={() => { copyText(folder); toast(t('copied')) }}>{t('copyPath')}</button></> : null}
      </div>
      <p className="aha-hint">{t('workspaceManual')}</p>
      <ErrorLine error={error} />
    </section>

    <section className="aha-card">
      <b>{t('submitProject')}</b>
      <textarea className="aha-textarea" value={notes} placeholder={t('submitNotes')} onChange={event => setNotes(event.currentTarget.value)} />
      <label className="aha-row" style={{ gap: 6 }}><input type="checkbox" checked={includeFiles} onChange={event => setIncludeFiles(event.currentTarget.checked)} />{t('includeFiles')}</label>
      {job.running ? <JobProgress progress={job.progress} label={t('reviewing')} onCancel={job.cancel} /> : <div><button type="button" className="aha-btn" data-kind="primary" disabled={!notes.trim() && !includeFiles} onClick={submit}>{t('submitProject')}</button></div>}
      <ErrorLine error={job.error} />
    </section>

    {submissions.length ? <section className="aha-col">
      <h3 className="aha-cardTitle">{t('submissions')}</h3>
      {[...submissions].reverse().map((submission, index) => <div key={index} className="aha-card">
        <div className="aha-spread"><b>{t('reviewTotal', { total: submission.review.total, max: submission.review.max })}</b><span className="aha-hint">{new Date(submission.at).toLocaleString()}</span></div>
        {submission.review.summary ? <RichText text={submission.review.summary} compact /> : null}
        {submission.review.scores.map(score => <div key={score.criterionId} className="aha-spread" style={{ alignItems: 'flex-start' }}><span><b>{score.criterion}</b><div className="aha-hint">{score.comment}</div></span><span className="aha-tag">{score.points}/{score.max}</span></div>)}
        {submission.review.strengths?.length ? <div><b>{t('strengths')}</b><ul style={{ margin: 0 }}>{submission.review.strengths.map((item, position) => <li key={position}>{item}</li>)}</ul></div> : null}
        {submission.review.nextSteps?.length ? <div><b>{t('nextSteps')}</b><ul style={{ margin: 0 }}>{submission.review.nextSteps.map((item, position) => <li key={position}>{item}</li>)}</ul></div> : null}
      </div>)}
    </section> : null}
  </div>
}
