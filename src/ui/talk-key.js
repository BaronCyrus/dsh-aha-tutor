// Push-to-talk in the classroom: hold V to speak and let go to send, or tap
// V, speak, and tap it again. Framework-free so it can be tested without a
// browser.

// A key held at least this long before it comes up was held to speak: the
// recording ends with it. A shorter press is a tap, and the recording goes
// on until the key is pressed again.
export const HOLD_MS = 350

// V on its own: Cmd+V, Ctrl+V and the like stay the browser's.
export const isTalkKey = event => (event?.key === 'v' || event?.key === 'V') && !event.ctrlKey && !event.metaKey && !event.altKey

// Where typing goes, keys are text rather than classroom shortcuts.
export const typingInto = target => Boolean(target?.isContentEditable) || /^(input|textarea|select)$/iu.test(String(target?.tagName ?? ''))

// The key's presses and releases as what the recorder should do. phase: the
// recorder's ('idle', 'starting', 'recording' or 'working'); at: the event's
// time in milliseconds. Each returns 'start', 'stop' or null.
export function createTalkKey() {
  let downAt = null
  const live = phase => phase === 'starting' || phase === 'recording'
  return {
    down(phase, at) {
      if (phase === 'idle') {
        downAt = at
        return 'start'
      }
      downAt = null
      return live(phase) ? 'stop' : null
    },
    up(phase, at) {
      if (downAt === null) return null
      const held = at - downAt
      downAt = null
      return held >= HOLD_MS && live(phase) ? 'stop' : null
    },
  }
}
