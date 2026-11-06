import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { folderKey } from '../src/core/library.js'
import { createFolders } from '../src/host/folders.js'
import { uploadRoute } from '../src/host/http.js'
import { createJobs } from '../src/host/jobs.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms) })

async function finish(jobs, started) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = jobs.get(started.id)
    if (job.status !== 'running') {
      if (job.status !== 'done') throw Object.assign(new Error(job.error?.message), { code: job.error?.code })
      return job.result
    }
    await wait(2)
  }
  throw new Error('job timed out')
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'aha-folders-'))
  const store = createStore({ root: join(root, 'data') })
  const folders = createFolders({ store })
  const jobs = createJobs()
  const llm = { supportsImages: () => false, complete: async () => JSON.stringify({ summary: '一份讲义', topics: ['导数'] }), stream: async () => '{}' }
  const studio = createStudio({ store, llm, jobs, folders })
  t.after(async () => {
    jobs.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const material = async (id, folderId) => {
    await store.writeJson(store.paths.material(id), { id, title: id, kind: 'markdown', chars: 10, createdAt: new Date().toISOString(), ...(folderId ? { folderId } : {}) })
    await store.writeJson(store.paths.materialChunks(id), [{ id: 'c1', text: `${id} 讲导数的定义与求导法则。` }])
  }
  return { store, folders, jobs, studio, material }
}

test('folders are named once each, listed by name with numbers in order', async t => {
  const { folders } = await setup(t)
  const ten = (await folders.create({ name: '第10单元' })).folder
  await folders.create({ name: '第2单元' })
  await folders.create({ name: '  数学\n五上  ' })
  assert.deepEqual((await folders.list()).folders.map(folder => folder.name), ['第2单元', '第10单元', '数学 五上'])
  assert.match(ten.id, /^fld_[a-z0-9]{6,40}$/u)

  await assert.rejects(folders.create({ name: '第10单元 ' }), error => error.code === 'folder-exists')
  await assert.rejects(folders.create({ name: 'ＡＢＣ' }).then(() => folders.create({ name: 'abc' })), error => error.code === 'folder-exists', 'width and case aside')
  const again = await folders.create({ name: '第10单元', reuse: true })
  assert.deepEqual([again.folder.id, again.existed], [ten.id, true], 'a folder uploaded again reuses its folder')
  await assert.rejects(folders.create({ name: '  ' }), error => error.code === 'folder-name-empty')
  assert.equal((await folders.create({ name: '长'.repeat(80) })).folder.name.length, 60)
  assert.equal(folderKey(' 数学  五上 '), folderKey('数学 五上'))

  const renamed = await folders.rename({ id: ten.id, name: '第十单元' })
  assert.equal(renamed.folder.name, '第十单元')
  await assert.rejects(folders.rename({ id: ten.id, name: '第2单元' }), error => error.code === 'folder-exists')
  await assert.rejects(folders.rename({ id: 'fld_missing01', name: 'x' }), error => error.code === 'not-found')
})

test('materials move in and out of a folder; deleting a folder keeps them, unfiled', async t => {
  const { store, folders, material } = await setup(t)
  const { folder } = await folders.create({ name: '数学' })
  const other = (await folders.create({ name: '物理' })).folder
  await material('mat_folder0001')
  await material('mat_folder0002', folder.id)
  await material('mat_folder0003', other.id)

  assert.equal((await folders.move({ id: 'mat_folder0001', folderId: folder.id })).material.folderId, folder.id)
  await assert.rejects(folders.move({ id: 'mat_folder0001', folderId: 'fld_missing01' }), error => error.code === 'not-found')
  await assert.rejects(folders.move({ id: 'mat_missing001', folderId: folder.id }), error => error.code === 'not-found')
  await assert.rejects(stat(store.paths.materialDir('mat_missing001')), error => error.code === 'ENOENT', 'a missing material is not written')

  const before = await readFile(store.paths.material('mat_folder0003'), 'utf8')
  assert.deepEqual(await folders.remove({ id: folder.id }), { removed: folder.id, moved: 2 })
  assert.deepEqual((await folders.list()).folders.map(entry => entry.name), ['物理'])
  for (const id of ['mat_folder0001', 'mat_folder0002']) assert.equal((await store.readJson(store.paths.material(id), null)).folderId, null, `${id} stays, unfiled`)
  assert.equal(await readFile(store.paths.material('mat_folder0003'), 'utf8'), before, 'a material elsewhere is left alone')
  assert.equal((await folders.move({ id: 'mat_folder0003', folderId: null })).material.folderId, null)
})

test('an upload goes into its folder with its file name and size, and searching can stay in a folder', async t => {
  const { folders, jobs, studio, material } = await setup(t)
  const { folder } = await folders.create({ name: '导数' })
  const bytes = Buffer.from('# 导数\n\n导数是瞬时变化率，求导法则有和差积商。')
  const { material: kept } = await finish(jobs, studio.upload({ name: '导数讲义.md', bytes, folderId: folder.id }))
  assert.deepEqual([kept.folderId, kept.fileName, kept.fileSize], [folder.id, '导数讲义.md', bytes.length])
  const gone = (await folders.create({ name: '临时' })).folder
  await folders.remove({ id: gone.id })
  const { material: loose } = await finish(jobs, studio.upload({ name: 'b.md', base64: bytes.toString('base64'), folderId: gone.id }))
  assert.equal(loose.folderId, null, 'a folder deleted meanwhile files it under none')

  await material('mat_search0001')
  const everywhere = await studio.searchMaterials({ query: '求导法则' })
  assert.deepEqual(new Set(everywhere.results.map(hit => hit.materialId)), new Set([kept.id, loose.id, 'mat_search0001']))
  assert.deepEqual((await studio.searchMaterials({ query: '求导法则', folder: folder.id })).results.map(hit => hit.materialId), [kept.id])
  assert.deepEqual(new Set((await studio.searchMaterials({ query: '求导法则', folder: 'none' })).results.map(hit => hit.materialId)), new Set([loose.id, 'mat_search0001']))
})

test('the routes check folder ids and pass them on', async () => {
  const seen = []
  const keep = name => request => { seen.push([name, request]); return { id: 'job_x' } }
  const routes = createRoutes({
    studio: { upload: keep('upload'), addUrl: keep('url'), searchMaterials: keep('search') },
    folders: { move: keep('move'), list: keep('list'), create: keep('create'), rename: keep('rename'), remove: keep('remove') },
  })
  routes['material/upload']({ name: 'a.md', base64: 'eA==', folderId: 'fld_abcdef12' })
  routes['material/url']({ url: 'https://example.com', folderId: null })
  routes['material/search']({ query: 'x', folder: 'none' })
  routes['material/search']({ query: 'x', folder: 'fld_abcdef12' })
  routes['material/search']({ query: 'x' })
  routes['material/move']({ id: 'mat_abcdef12', folderId: null })
  routes['folder/create']({ name: '数学', reuse: true })
  routes['folder/rename']({ id: 'fld_abcdef12', name: '物理' })
  routes['folder/remove']({ id: 'fld_abcdef12' })
  routes['folder/list']({})
  assert.deepEqual(seen.map(([name, request]) => [name, request?.folderId ?? request?.folder ?? request?.name ?? request?.id ?? null]), [
    ['upload', 'fld_abcdef12'], ['url', null], ['search', 'none'], ['search', 'fld_abcdef12'], ['search', null], ['move', 'mat_abcdef12'], ['create', '数学'], ['rename', '物理'], ['remove', 'fld_abcdef12'], ['list', null],
  ])
  assert.deepEqual(seen[5][1], { id: 'mat_abcdef12', folderId: null }, 'null takes it out of every folder')
  assert.equal(seen[6][1].reuse, true)
  for (const bad of [() => routes['material/move']({ id: 'mat_abcdef12', folderId: '../x' }), () => routes['material/search']({ query: 'x', folder: 'all' }), () => routes['folder/remove']({ id: 'mat_abcdef12' }), () => routes['material/upload']({ name: 'a', base64: 'eA==', folderId: 5 })]) {
    assert.throws(bad, error => error.code === 'invalid')
  }

  // The upload route files a valid folder id, and none for anything else.
  const taken = []
  const route = uploadRoute({ studio: { upload: request => { taken.push(request.folderId); return { id: 'job_x' } } } })
  for (const query of ['folder=fld_abcdef12', 'folder=..%2Fx', '']) {
    const response = await route.fetch(new Request(`http://dsh.internal/api/aha-tutor/upload?name=a.txt&${query}`, { method: 'POST', body: new Uint8Array(4), duplex: 'half' }))
    assert.equal(response.status, 200)
  }
  assert.deepEqual(taken, ['fld_abcdef12', null, null])
})
