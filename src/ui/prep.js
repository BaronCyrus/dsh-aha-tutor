// What the lesson-preparation card (PrepProgress.jsx) shows, kept apart from
// React so the rules can be tested.

// The card takes the place of the small "preparing" pill only once the wait
// has lasted this long: a model that writes at once starts the lesson within
// a second or two, and the card would only flash.
export const PREP_DELAY_MS = 3000

const STAGES = [['thinking', 'prepThinking'], ['writing', 'prepWriting']]

// The two stages (thinking, then writing) with their states, or null when
// the model has not thought first: then the card shows only the step being
// written, with nothing ticked that never happened.
export function prepStages(prep) {
  if (!((prep?.thinking ?? 0) > 0)) return null
  const stage = STAGES.findIndex(([name]) => name === prep.phase)
  return STAGES.map(([name, key], index) => ({ name, key, state: index < stage ? 'done' : index === stage ? 'now' : 'next' }))
}
