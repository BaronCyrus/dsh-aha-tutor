// Pictures pasted or dropped into a question (即时答疑): what counts as one,
// how many a question takes, and what a question with only pictures asks.
// Shared by the host and the browser, so free of Node and DOM APIs.

// A question shows the teacher at most this many pictures (a model call
// takes four); on a follow-up its own come first, then earlier ones.
export const QUESTION_PICTURES = 4

// The picture files a question takes, by extension. Other files dropped
// into a question go into the library as materials.
export const PICTURE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif'])

const extensionOf = name => (/\.([^./\\]+)$/u.exec(String(name ?? ''))?.[1] ?? '').toLowerCase()

// A file the browser hands over (pasted, dropped or picked) is a picture
// when its type or its name says so.
export function isPictureFile({ name, type } = {}) {
  const mime = String(type ?? '').toLowerCase()
  if (mime) return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)
  return PICTURE_EXTENSIONS.includes(extensionOf(name))
}

const startsWith = (bytes, values, offset = 0) => values.every((value, index) => bytes[offset + index] === value)
const ascii = text => [...text].map(character => character.charCodeAt(0))

// The picture's format from its first bytes (PNG, JPEG, GIF or WebP), or
// null: the name or the type the browser gave is not trusted.
export function pictureMime(bytes) {
  const head = bytes ?? []
  if (head.length >= 8 && startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (head.length >= 3 && startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (head.length >= 6 && startsWith(head, ascii('GIF8'))) return 'image/gif'
  if (head.length >= 12 && startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

const ASKS = Object.freeze({
  zh: { solve: '帮我解图里的题', explain: '讲讲图里的内容', visualize: '把图里的内容画出来讲讲' },
  en: { solve: 'Help me solve the problem in the picture', explain: 'Explain what the picture shows', visualize: 'Draw out what the picture shows' },
})

// What a question with pictures and no words asks, by mode, in the
// learner's language. It is saved as the question, so the thread reads
// like any other.
export function pictureAsk(mode, language = 'zh-CN') {
  const asks = /^zh/iu.test(String(language)) ? ASKS.zh : ASKS.en
  return asks[mode] ?? asks.explain
}
