// While a lesson board is being written: what the teacher is doing (reaching
// the model, thinking the lesson through, writing step N and what that step
// is about) and how much is ready. The host reports it through the board
// job's preview. Before the first step it also shows the two stages and the
// seconds so far; when the lesson has caught up with the writing it shows
// only the step being written.

import { useEffect, useState } from 'react'

import { Inline } from './board/Board.jsx'
import { useApp } from './hooks.js'

const STAGES = [['thinking', 'prepThinking'], ['writing', 'prepWriting']]

// hand: the board writes in the handwriting font (Settings → board font).
export function PrepProgress({ prep, label, first, hand = true }) {
  const { t } = useApp()
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!first) return undefined
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [first])
  const phase = prep.phase ?? 'starting'
  const stage = STAGES.findIndex(([name]) => name === phase)
  const seconds = Math.max(0, Math.round(((prep.elapsedMs ?? 0) + now - (prep.receivedAt ?? now)) / 1000))
  return <div className="aha-prep" role="status" aria-live="polite">
    <div className="aha-spread">
      <span className="aha-row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="aha-spinner" /><b>{label}</b></span>
      {first ? <span className="aha-hint">{t('prepSeconds', { seconds })}</span> : null}
    </div>
    {first ? <ol className="aha-prepStages">
      {STAGES.map(([name, key], index) => <li key={name} data-state={index < stage ? 'done' : index === stage ? 'now' : 'next'}>{t(key)}</li>)}
    </ol> : null}
    <div className="aha-prepNow">
      {phase === 'writing'
        ? <>{t('prepStep', { n: (prep.steps ?? 0) + 1 })}{prep.current ? <>：<span className="aha-prepHint" data-hand={hand ? 'true' : undefined}><Inline text={prep.current} /></span></> : '…'}</>
        : phase === 'thinking' ? t('prepThinkingDetail', { chars: (prep.thinking ?? 0).toLocaleString() }) : t('prepStarting')}
    </div>
    {phase === 'writing' ? <div className="aha-hint">{t('prepCounts', { steps: prep.steps ?? 0, chars: (prep.chars ?? 0).toLocaleString() })}</div> : null}
  </div>
}
