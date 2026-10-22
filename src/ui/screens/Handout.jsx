// A lesson's one-page handout: what it covered, its key points in one line
// each, a worked example, common mistakes, a glossary and questions to check
// oneself. Made on request from the lesson's board, then kept; printable.

import { useEffect, useState } from 'react'

import { Inline } from '../board/Board.jsx'
import { ErrorLine, JobProgress } from '../components.jsx'
import { useApp, useJob } from '../hooks.js'

export function HandoutScreen({ courseId, lessonId }) {
  const { api, t, navigate } = useApp()
  const job = useJob()
  const [handout, setHandout] = useState(null)
  const [error, setError] = useState(null)

  const load = async force => {
    setError(null)
    try {
      const first = await api.call('lesson/handout', { courseId, lessonId, force })
      setHandout(first.job ? (await job.run(null, null, { existing: first.job })).handout : first.handout)
    } catch (failure) {
      setError(failure)
    }
  }
  useEffect(() => { load(false) }, [courseId, lessonId])

  // Answers are folded away on screen and printed open.
  const print = () => {
    for (const details of document.querySelectorAll('.aha-handout details')) details.open = true
    window.print()
  }

  const back = <button type="button" className="aha-btn" data-kind="ghost" onClick={() => navigate('lesson', { courseId, lessonId })}>← {t('backToLesson')}</button>
  if (error) return <div className="aha-page"><ErrorLine error={error} /><div className="aha-row">{back}</div></div>
  if (!handout) return <div className="aha-page"><JobProgress progress={job.progress} label={t('handoutMaking')} onCancel={job.running ? job.cancel : undefined} /></div>
  return <div className="aha-page" style={{ maxWidth: 860 }}>
    <div className="aha-spread aha-noprint">
      {back}
      <div className="aha-row">
        <button type="button" className="aha-btn" onClick={print}>{t('print')}</button>
        <button type="button" className="aha-btn" data-kind="ghost" onClick={() => { setHandout(null); load(true) }}>{t('regenerate')}</button>
      </div>
    </div>
    <article className="aha-printable aha-handout">
      <header>
        <span className="aha-hint">{t('handout')}</span>
        <h2>{handout.title}</h2>
        {handout.summary ? <p className="aha-handoutSummary"><Inline text={handout.summary} /></p> : null}
      </header>
      <section>
        <h3>{t('handoutPoints')}</h3>
        <ol className="aha-handoutPoints">
          {handout.points.map((point, index) => <li key={index}>
            <b><Inline text={point.title} /></b>
            {point.oneLine ? <div className="aha-handoutOneLine"><Inline text={point.oneLine} /></div> : null}
            {point.detail ? <div className="aha-hint"><Inline text={point.detail} /></div> : null}
          </li>)}
        </ol>
      </section>
      {handout.example ? <section>
        <h3>{t('handoutExample')}</h3>
        <p><Inline text={handout.example.problem} /></p>
        <ol className="aha-handoutSteps">{handout.example.steps.map((step, index) => <li key={index}><Inline text={step} /></li>)}</ol>
        {handout.example.answer ? <div className="aha-handoutAnswer"><b>{t('handoutAnswer')}</b> <Inline text={handout.example.answer} /></div> : null}
      </section> : null}
      {handout.mistakes.length ? <section>
        <h3>{t('handoutMistakes')}</h3>
        <ul className="aha-handoutMistakes">{handout.mistakes.map((item, index) => <li key={index}>
          <span data-wrong="true"><Inline text={item.mistake} /></span>
          {item.fix ? <span>→ <Inline text={item.fix} /></span> : null}
        </li>)}</ul>
      </section> : null}
      {handout.glossary.length ? <section>
        <h3>{t('handoutGlossary')}</h3>
        <dl className="aha-handoutGlossary">{handout.glossary.map((item, index) => <div key={index}><dt><Inline text={item.term} /></dt><dd><Inline text={item.meaning} /></dd></div>)}</dl>
      </section> : null}
      {handout.questions.length ? <section>
        <h3>{t('handoutQuestions')}</h3>
        <ol className="aha-handoutQuestions">{handout.questions.map((item, index) => <li key={index}>
          <Inline text={item.question} />
          {item.answer ? <details><summary>{t('handoutAnswer')}</summary><Inline text={item.answer} /></details> : null}
        </li>)}</ol>
      </section> : null}
    </article>
  </div>
}
