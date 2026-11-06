// The material library's folders, as the host keeps them and the browser
// shows them: how long a name may be, when two names are the same folder,
// and the order names and titles are listed in (numbers in order, so
// 「第2讲」 comes before 「第10讲」).

export const FOLDER_NAME_CHARS = 60

// A folder's name as it is kept: control characters and runs of spaces as
// one space, trimmed, at most FOLDER_NAME_CHARS (empty when nothing is left).
export function cleanFolderName(name) {
  const value = String(name ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
  return [...value].slice(0, FOLDER_NAME_CHARS).join('').trim()
}

// A name as the learner tells two apart: case, width and runs of spaces
// aside, so 「数学」, 「数学 」 and 「ＡＢＣ」/「abc」 are one folder each.
export function folderKey(name) {
  return String(name ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function compareNames(a, b) {
  return collator.compare(String(a ?? ''), String(b ?? ''))
}
