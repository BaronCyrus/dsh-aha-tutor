// The host row publishes its services here; the teacher preset's tool plugin
// (a separate loader row) reads them. A global symbol keeps this working even
// if the two entries ever load separate copies of this module.

const KEY = Symbol.for('dsh-aha-tutor.runtime')

export function publishRuntime(runtime) {
  globalThis[KEY] = runtime
  return () => {
    if (globalThis[KEY] === runtime) delete globalThis[KEY]
  }
}

export function getRuntime() {
  const runtime = globalThis[KEY]
  if (!runtime) throw new Error('Aha Tutor is still starting. Try again in a moment.')
  return runtime
}
