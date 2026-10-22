// The classroom's first-run tour: which parts it points at, and where its
// card goes so that it never covers what it is about. Framework-free so the
// placement can be tested without a browser.

// Each step names the element it lights up (a selector inside the
// classroom) and its copy keys. A step whose element is missing (the side
// panel folded away) is skipped.
export const CLASSROOM_TOUR = Object.freeze([
  { target: '.aha-stage', title: 'tourBoardTitle', text: 'tourBoard' },
  { target: '.aha-controls', title: 'tourControlsTitle', text: 'tourControls' },
  { target: '[data-tour=raise]', title: 'tourRaiseTitle', text: 'tourRaise' },
  { target: '[data-tour=reexplain]', title: 'tourReexplainTitle', text: 'tourReexplain' },
  { target: '[data-tour=challenge]', title: 'tourChallengeTitle', text: 'tourChallenge' },
  { target: '.aha-panel', title: 'tourPanelTitle', text: 'tourPanel' },
])

const GAP = 12
const EDGE = 8

// hole: the lit box and card: the card's size, both relative to the root
// ({ width, height }). The card goes below the hole when it fits there,
// else above, else beside it; never outside the root.
export function tourPlacement(hole, card, root) {
  const clamp = (value, max) => Math.max(EDGE, Math.min(value, max - EDGE))
  const left = clamp(hole.x, root.width - card.width)
  if (hole.y + hole.height + GAP + card.height <= root.height - EDGE) return { x: left, y: hole.y + hole.height + GAP, side: 'below' }
  if (hole.y - GAP - card.height >= EDGE) return { x: left, y: hole.y - GAP - card.height, side: 'above' }
  // A hole as tall as the room (the board): the card sits inside it, at the
  // bottom right, where the board is least busy.
  return { x: clamp(hole.x + hole.width - card.width - GAP, root.width - card.width), y: clamp(hole.y + hole.height - card.height - GAP, root.height - card.height), side: 'inside' }
}

// The box to light up around an element's box, a little larger, kept
// inside the root.
export function tourHole(box, root, pad = 6) {
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  return { x, y, width: Math.min(root.width, box.x + box.width + pad) - x, height: Math.min(root.height, box.y + box.height + pad) - y }
}
