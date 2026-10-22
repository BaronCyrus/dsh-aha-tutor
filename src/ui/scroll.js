// Scrolling the plugin page (it scrolls inside .aha-main) and keeping
// popovers inside it, kept apart from React so the rules can be tested.

// The wide page's top padding: a revealed element keeps this much air above it.
const TOP_GAP = 12
// Air a popover keeps from the edges of the area that clips it.
const EDGE = 8

// The nearest box that cuts off what sticks out sideways: the page
// (.aha-main), a classroom's scrolling body, a side panel.
function clippingArea(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== 'visible') return node
  }
  return null
}

// A popover hung from a button (the microphone's note) sticks out of the area
// that clips it when the button sits away from that area's edge, as in a
// narrow window. Narrow it to the area and move it inward. Returns the shift
// in pixels.
export function keepInside(element) {
  const area = clippingArea(element)
  if (!area) return 0
  element.style.width = ''
  element.style.transform = ''
  const room = area.getBoundingClientRect()
  element.style.width = `${Math.min(element.getBoundingClientRect().width, room.width - 2 * EDGE)}px`
  const box = element.getBoundingClientRect()
  const shift = box.left < room.left + EDGE ? room.left + EDGE - box.left : Math.min(0, room.right - EDGE - box.right)
  if (shift) element.style.transform = `translateX(${Math.round(shift)}px)`
  return shift
}

// keepInside now and whenever the area changes size. The window's resize
// event is not enough: it comes while DSH's sidebar is still sliding, so the
// area is measured mid-way. Returns a function that stops watching.
export function keepInsideWhileShown(element) {
  keepInside(element)
  const area = clippingArea(element)
  if (!area || typeof ResizeObserver !== 'function') return () => undefined
  const watch = new ResizeObserver(() => keepInside(element))
  watch.observe(area)
  return () => watch.disconnect()
}

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
