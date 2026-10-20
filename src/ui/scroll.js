// Scrolling the plugin page (it scrolls inside .aha-main), kept apart from
// React so the rules can be tested.

// The wide page's top padding: a revealed element keeps this much air above it.
const TOP_GAP = 12

// In one column, the instant-answer and shorts pages scroll as a whole and
// their history (and the composer) sit under the classroom, so a classroom
// opened from there starts out of sight. Bring its top to the top of the
// page. Wide layouts fit the window and do not scroll, so nothing moves there.
export function revealTop(element, { reducedMotion = prefersReducedMotion() } = {}) {
  const scroller = element?.closest?.('.aha-main')
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return false
  const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - TOP_GAP
  if (Math.abs(offset) < 1) return false
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset), behavior: reducedMotion ? 'auto' : 'smooth' })
  return true
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
