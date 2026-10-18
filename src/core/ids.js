// Short, collision-resistant ids that are safe as file names on every OS:
// lowercase letters, digits and one underscore, never a Windows device name.

const ID_PATTERN = /^[a-z]{2,6}_[a-z0-9]{6,40}$/u

function randomPart(length) {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let text = ''
  for (const byte of bytes) text += (byte % 36).toString(36)
  return text
}

export function newId(prefix) {
  if (!/^[a-z]{2,6}$/u.test(prefix)) throw new TypeError(`invalid id prefix "${prefix}"`)
  return `${prefix}_${Date.now().toString(36)}${randomPart(6)}`
}

export function isId(value, prefix) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return false
  return prefix === undefined || value.startsWith(`${prefix}_`)
}

export function assertId(value, prefix) {
  if (!isId(value, prefix)) throw new TypeError(`invalid ${prefix ?? ''} id`)
  return value
}

// Local ids inside one document (steps, ops, questions): short and stable.
export function localIds(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)
}
