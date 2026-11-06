// Library folders: one level, each material in at most one of them (its
// meta's `folderId`); a material in none is 未分类. Folders are kept by id
// in folders.json. Their names are only shown, never used as paths.

import { assertId, isId, newId } from '../core/ids.js'
import { cleanFolderName, compareNames, folderKey } from '../core/library.js'
import { TutorError } from './generate.js'

const byFolderName = (a, b) => compareNames(a.name, b.name)

function cleanName(name) {
  const value = cleanFolderName(name)
  if (!value) throw new TutorError('folder-name-empty', 'Give the folder a name')
  return value
}

export function createFolders({ store, now = () => new Date() }) {
  const stamp = () => now().toISOString()
  const file = () => store.paths.folders()
  const valid = list => (Array.isArray(list) ? list : []).filter(folder => isId(folder?.id, 'fld') && typeof folder.name === 'string' && folder.name)

  async function read() {
    return valid((await store.readJson(file(), null))?.folders)
  }

  async function list() {
    return { folders: (await read()).sort(byFolderName) }
  }

  // The folder with this id, or null (it was deleted, or never was).
  async function find(id) {
    if (!isId(id, 'fld')) return null
    return (await read()).find(folder => folder.id === id) ?? null
  }

  // reuse: hand back the folder that already has this name (uploading a
  // computer's folder again adds to it) instead of refusing the name.
  async function create({ name, reuse = false }) {
    const wanted = cleanName(name)
    let folder = null
    let existed = false
    await store.updateJson(file(), { folders: [] }, current => {
      const folders = valid(current?.folders)
      const same = folders.find(entry => folderKey(entry.name) === folderKey(wanted))
      if (same && !reuse) throw new TutorError('folder-exists', 'There is a folder with this name already')
      if (same) {
        folder = same
        existed = true
        return { folders }
      }
      folder = { id: newId('fld'), name: wanted, createdAt: stamp() }
      return { folders: [...folders, folder] }
    })
    return { folder, existed }
  }

  async function rename({ id, name }) {
    assertId(id, 'fld')
    const wanted = cleanName(name)
    let folder = null
    await store.updateJson(file(), { folders: [] }, current => {
      const folders = valid(current?.folders)
      const index = folders.findIndex(entry => entry.id === id)
      if (index < 0) throw new TutorError('not-found', 'Folder not found')
      if (folders.some(entry => entry.id !== id && folderKey(entry.name) === folderKey(wanted))) throw new TutorError('folder-exists', 'There is a folder with this name already')
      folder = { ...folders[index], name: wanted }
      return { folders: folders.map(entry => (entry.id === id ? folder : entry)) }
    })
    return { folder }
  }

  // The folder goes; its materials stay in the library, 未分类.
  async function remove({ id }) {
    assertId(id, 'fld')
    await store.updateJson(file(), { folders: [] }, current => ({ folders: valid(current?.folders).filter(entry => entry.id !== id) }))
    let moved = 0
    for (const materialId of await store.listIds(store.paths.materials(), 'mat')) {
      const meta = await store.readJson(store.paths.material(materialId), null)
      if (meta?.folderId !== id) continue
      // A material removed meanwhile is not written back.
      const done = await store.updateJson(store.paths.material(materialId), null, value => {
        if (!value) throw new TutorError('not-found', 'Material not found')
        return { ...value, folderId: null }
      }).then(() => true, () => false)
      if (done) moved += 1
    }
    return { removed: id, moved }
  }

  // Into a folder, or out of every folder (folderId null).
  async function move({ id, folderId }) {
    assertId(id, 'mat')
    if (folderId !== null && !(await find(folderId))) throw new TutorError('not-found', 'Folder not found')
    const material = await store.updateJson(store.paths.material(id), null, meta => {
      if (!meta) throw new TutorError('not-found', 'Material not found')
      return { ...meta, folderId }
    })
    return { material }
  }

  return Object.freeze({ list, find, create, rename, remove, move })
}
