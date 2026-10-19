// What the classroom's side panel shows: progress through the lesson's goals
// and a transcript of what has been said so far, with the learner's questions.
// Framework-free so it can be tested without a browser.

// steps: the board's own steps (no asides); mainIndex: the one being taught.
// Returns 'done' | 'current' | 'todo' per goal, or null when the board marks
// no goals (older lessons), in which case the goals are listed without state.
export function goalStates(steps, mainIndex, count, ended = false) {
  if (!count) return []
  if (!steps.some(step => Number.isInteger(step.goal))) return null
  if (ended) return Array(count).fill('done')
  const last = Array(count).fill(-1)
  steps.forEach((step, index) => {
    if (Number.isInteger(step.goal) && step.goal < count) last[step.goal] = Math.max(last[step.goal], index)
  })
  const current = steps[mainIndex]?.goal
  return last.map((lastIndex, goal) => {
    if (current === goal) return 'current'
    if (lastIndex >= 0 && mainIndex > lastIndex) return 'done'
    return 'todo'
  })
}

// steps: everything on the board in playing order, asides included; upto: the
// furthest step reached; asides: { id, kind, label, streaming, steps }.
// Entries: { key, kind: 'say' | 'question' | 'reexplain' | 'correction', text,
// stepIndex, aside, pending } — stepIndex is where clicking the entry jumps to.
export function transcriptEntries(steps, upto, asides = []) {
  const entries = []
  const kindOf = aside => (aside.kind === 'question' || aside.kind === 'correction' ? aside.kind : 'reexplain')
  const started = new Set()
  const owner = id => asides.find(aside => id.startsWith(`${aside.id}_`))
  steps.forEach((step, stepIndex) => {
    if (stepIndex > upto) return
    if (step.aside) {
      const aside = owner(step.id)
      if (aside && !started.has(aside.id)) {
        started.add(aside.id)
        entries.push({ key: `${aside.id}:ask`, kind: kindOf(aside), text: aside.label, stepIndex, aside: true })
      }
    }
    if (step.say) entries.push({ key: step.id, kind: 'say', text: step.say, stepIndex, aside: step.aside === true })
  })
  // A question whose answer has not started yet still shows, as pending.
  for (const aside of asides) {
    if (aside.streaming && !aside.steps.length) entries.push({ key: `${aside.id}:ask`, kind: kindOf(aside), text: aside.label, stepIndex: -1, aside: true, pending: true })
  }
  return entries
}
