// One planned item, on the home page and in the plan calendar: a tick box
// for lessons and reviews on today or an earlier day, the title with its
// course, the minutes, and a way in. Ticks made by finishing a lesson or a
// review cannot be taken back here.

import { CourseLabel } from './components.jsx'
import { useApp } from './hooks.js'

export function PlanItem({ item, day, today, onToggle }) {
  const { t, navigate } = useApp()
  const tickable = item.kind !== 'exam' && day <= today
  const automatic = item.checked === 'auto'
  return <div className="aha-planItem" data-checked={item.checked ? 'true' : undefined}>
    {tickable ? <input type="checkbox" className="aha-check" checked={Boolean(item.checked)} disabled={automatic}
      title={automatic ? t('checkedAuto') : undefined} aria-label={item.checked ? t('unmarkDone') : t('markDone')}
      onChange={() => onToggle?.(item, day)} /> : null}
    <span className="aha-tag">{item.kind === 'lesson' ? t('lessonItem') : item.kind === 'review' ? t('reviewItem') : t('examItem')}</span>
    <span className="aha-planTitle">{item.title}<CourseLabel title={item.courseTitle} emoji={item.courseEmoji} /></span>
    {item.minutes ? <span className="aha-hint">{t('minutesUnit', { minutes: item.minutes })}</span> : null}
    {item.kind === 'lesson' && !item.checked ? <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('lesson', { courseId: item.courseId, lessonId: item.refId })}>{t('learn')}</button> : null}
    {item.kind === 'review' && !item.checked && day === today ? <button type="button" className="aha-btn" data-size="sm" onClick={() => navigate('practice', { courseId: item.courseId ?? undefined, review: true })}>{t('review')}</button> : null}
  </div>
}

// Tick by hand, or take a hand-made tick back; resolves with the new plan.
export function togglePlanItem(api, item, day, today) {
  return item.checked === 'manual'
    ? api.call('plan/uncheck', { today, day, refId: item.refId })
    : api.call('plan/check', { today, day, item })
}
