// Library folders in the browser: what each view of the library shows and
// in what order, and a computer's folder (picked with the folder dialog or
// dropped) read and planned before anything is sent.

import { cleanFolderName, compareNames, folderKey } from '../core/library.js'

// Views besides the folders themselves: every material, and those in none.
export const ALL = 'all'
export const UNFILED = 'none'

// The files the upload box takes, by extension (the host reads these).
export const UPLOAD_EXTENSIONS = Object.freeze(['pdf', 'docx', 'pptx', 'md', 'markdown', 'txt', 'csv', 'json', 'tex', 'py', 'js', 'ts', 'html', 'png', 'jpg', 'jpeg', 'webp', 'gif'])
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map(extension => `.${extension}`).join(',')

// A computer's folder holding more files than this is not read: uploading
// each costs a model call, so such a folder is better taken in parts.
export const FOLDER_FILE_LIMIT = 1000

const extensionOf = path => (/\.([^./]+)$/u.exec(String(path))?.[1] ?? '').toLowerCase()
// What a computer leaves in folders (.DS_Store, Thumbs.db, Office's ~$
// lock files, anything in a hidden folder) is passed over without a word.
const isClutter = path => String(path).split('/').some(part => part.startsWith('.') || part.startsWith('~$')) || /^(thumbs\.db|desktop\.ini)$/iu.test(String(path).split('/').pop())

export const folderOf = material => material?.folderId ?? UNFILED

// The view to show: a folder deleted meanwhile falls back to every material.
export function knownView(view, folders) {
  if (view === ALL || view === UNFILED) return view
  return (folders ?? []).some(folder => folder.id === view) ? view : ALL
}

// What a view shows: every material, or the unfiled ones, newest first as
// they came; a folder's materials in the order of their file names (paths,
// for a computer's folder uploaded whole), else their titles, numbers in
// order, as the folder lists on the computer.
const sortName = material => material.fileName || material.title
export function inView(materials, view) {
  const list = materials ?? []
  if (view === ALL) return list
  const shown = list.filter(material => folderOf(material) === view)
  return view === UNFILED ? shown : [...shown].sort((a, b) => compareNames(sortName(a), sortName(b)))
}

// How many materials each view shows, by view key.
export function viewCounts(materials) {
  const counts = new Map([[ALL, 0], [UNFILED, 0]])
  for (const material of materials ?? []) {
    counts.set(ALL, counts.get(ALL) + 1)
    counts.set(folderOf(material), (counts.get(folderOf(material)) ?? 0) + 1)
  }
  return counts
}

// The files of a folder picked with the folder dialog, by the folder they
// are in: [{ name, entries: [{ file, path }] }], path being where the file
// sits inside that folder ('第一章/讲义.pdf'). Past FOLDER_FILE_LIMIT files
// a folder comes back as { name, tooMany }.
export function foldersFromInput(files) {
  const list = [...(files ?? [])]
  const groups = new Map()
  for (const file of list) {
    const parts = String(file.webkitRelativePath || file.name).split('/').filter(Boolean)
    const name = parts.length > 1 ? parts[0] : ''
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push({ file, path: parts.length > 1 ? parts.slice(1).join('/') : parts[0] ?? file.name })
  }
  return [...groups].map(([name, entries]) => (list.length > FOLDER_FILE_LIMIT ? { name, entries: [], tooMany: true } : { name, entries }))
}

// What was dropped: loose files, and a function reading the dropped folders
// through their file system entries ([{ name, entries } | { name, tooMany }]).
// Call it while the drop event runs, which is the only time its items can
// be read; the folders themselves are read afterwards.
export function readDrop(dataTransfer) {
  const items = dataTransfer?.items
  const roots = []
  const loose = []
  for (let index = 0; index < (items?.length ?? 0); index += 1) {
    const item = items[index]
    if (item?.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) roots.push(entry)
    else {
      const file = item.getAsFile?.()
      if (file) loose.push(file)
    }
  }
  // A browser without entries gives the files alone.
  if (!roots.length && !loose.length) loose.push(...(dataTransfer?.files ?? []))
  return { loose, folders: () => Promise.all(roots.map(root => readFolderEntry(root))) }
}

// A dropped folder's files, its subfolders' included (hidden ones are not
// opened), each with its path inside the folder.
export async function readFolderEntry(root, limit = FOLDER_FILE_LIMIT) {
  const entries = []
  const queue = [{ directory: root, path: '' }]
  while (queue.length) {
    const { directory, path } = queue.shift()
    for (const child of await readAll(directory)) {
      const childPath = path ? `${path}/${child.name}` : child.name
      if (child.isDirectory) {
        if (!child.name.startsWith('.')) queue.push({ directory: child, path: childPath })
      } else if (child.isFile) {
        if (entries.length >= limit) return { name: root.name, entries: [], tooMany: true }
        entries.push({ file: await new Promise((resolve, reject) => child.file(resolve, reject)), path: childPath })
      }
    }
  }
  return { name: root.name, entries }
}

// A directory's entries: the reader hands them out a batch at a time, then
// an empty batch.
function readAll(directory) {
  const reader = directory.createReader()
  const all = []
  return new Promise((resolve, reject) => {
    const next = () => reader.readEntries(batch => {
      if (!batch.length) return resolve(all)
      all.push(...batch)
      return next()
    }, reject)
    next()
  })
}

// What uploading one of the computer's folders does: the library folder it
// goes into (`folder`, the one of that name when there is one; else a new
// one is made), the files to send in name order, and those left out: the
// unsupported ones and those already in that folder (same path and size),
// listed; the computer's own leftovers, not listed. A file in a subfolder is
// sent by its path, so the library tells 「第一章/练习」 from 「第二章/练习」.
export function planFolder({ name, entries = [], tooMany = false }, { folders = [], materials = [], fallbackName = '' } = {}) {
  const folderName = cleanFolderName(name) || cleanFolderName(fallbackName)
  const folder = (folders ?? []).find(entry => folderKey(entry.name) === folderKey(folderName)) ?? null
  const known = new Set((materials ?? []).filter(material => folder && material.folderId === folder.id && material.fileName).map(material => `${material.fileName}\u0000${material.fileSize ?? ''}`))
  const plan = { name: folderName, folder, upload: [], unsupported: [], known: [], tooMany }
  for (const entry of [...entries].sort((a, b) => compareNames(a.path, b.path))) {
    if (isClutter(entry.path)) continue
    if (!UPLOAD_EXTENSIONS.includes(extensionOf(entry.path))) plan.unsupported.push(entry.path)
    else if (known.has(`${entry.path}\u0000${entry.file?.size ?? ''}`)) plan.known.push(entry.path)
    else plan.upload.push(entry)
  }
  return plan
}

// A few items of a list for a sentence, and how many more there are.
export function shortList(items, t, shown = 6) {
  const list = items ?? []
  const head = list.slice(0, shown).join(t('listJoin'))
  return list.length > shown ? `${head}${t('listMore', { count: list.length - shown })}` : head
}
