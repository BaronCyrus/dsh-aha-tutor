// The page's navigation: icons with their names, or icons only. Framework-
// free so it can be tested without a browser.

// Below this width of the plugin's page the names would leave the page too
// little room: the navigation shows its icons and opens over the page for
// one pick.
export const NAV_NARROW = 640

// The screens with a classroom (a lesson, instant answers, explainer
// shorts), whose board needs the room: the navigation keeps to its icons
// there, as on a narrow page.
export const CLASS_SCREENS = Object.freeze(['lesson', 'assist', 'shorts'])

// What the navigation shows:
// - 'open': icons and names;
// - 'folded': icons only, each name in a bubble on hover or keyboard focus;
// - 'peek': opened over the page.
// choice is the learner's 'open' or 'folded', kept in this browser. A narrow
// page and a class leave it aside, and the pages after them show it again.
export function navState({ choice, narrow, inClass = false, peek }) {
  if (narrow || inClass) return peek ? 'peek' : 'folded'
  return choice === 'folded' ? 'folded' : 'open'
}

// The fold button. On a narrow page or in a class it opens or closes the
// navigation over the page and keeps the learner's choice; otherwise it
// flips the choice.
export function foldNav({ choice, narrow, inClass = false, peek }) {
  if (narrow || inClass) return { choice, peek: !peek }
  return { choice: choice === 'folded' ? 'open' : 'folded', peek: false }
}

// Where a folded icon's name goes: beside the icon, centred on it, in the
// page's coordinates (both boxes as getBoundingClientRect gives them).
export function tipPlace(icon, page, gap = 8) {
  return { top: icon.top - page.top + icon.height / 2, left: icon.right - page.left + gap }
}
