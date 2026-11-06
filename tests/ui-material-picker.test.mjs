import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement as h } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'tsdown'

import { format, zh } from '../src/ui/i18n.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const root = fileURLToPath(new URL('..', import.meta.url))
const t = (key, values) => format(zh[key] ?? key, values)

let bundle
let outDir

// The components are JSX: bundle them for Node, with React shared with the
// renderer (the bundle sits under node_modules so it finds the same React).
before(async () => {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  outDir = await mkdtemp(join(cache, 'aha-material-picker-'))
  await build({
    config: false,
    entry: { picker: join(root, 'tests', 'fixtures', 'ui', 'material-picker.js') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    logLevel: 'silent',
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests', 'fixtures', 'ui', 'primitives.js') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'], alwaysBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
  })
  const file = (await readdir(outDir)).find(name => /^picker\.m?js$/u.test(name))
  bundle = await import(pathToFileURL(join(outDir, file)).href)
})

after(() => rm(outDir, { recursive: true, force: true }))

function textOf(node) {
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

const buttons = (renderer, label) => renderer.root.findAll(node => node.type === 'button' && textOf(node).includes(label))
const press = (renderer, label) => act(async () => { buttons(renderer, label)[0].props.onClick({ stopPropagation() {} }) })

const LIBRARY = Array.from({ length: 4 }, (_, index) => ({ id: `mat_pick000${index + 1}`, title: `资料 ${index + 1}`, kind: 'pdf', pages: 3 }))

async function renderPicker(max) {
  const api = { call: async endpoint => (endpoint === 'material/list' ? LIBRARY : null) }
  const state = { selected: [] }
  let renderer
  const element = () => h(bundle.AppContext.Provider, { value: { api, t, language: 'zh' } }, h(bundle.MaterialPicker, {
    selected: state.selected,
    max,
    onChange: value => { state.selected = value; renderer.update(element()) },
    onClose() {},
  }))
  await act(async () => { renderer = TestRenderer.create(element()) })
  const boxes = () => renderer.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox')
  return { renderer, state, boxes, tick: index => act(() => { boxes()[index].props.onChange() }) }
}

test('the picker counts what is picked and, once full, greys out the rest and says why', async () => {
  const { renderer, state, boxes, tick } = await renderPicker(2)
  assert.equal(boxes().length, 4)
  assert.match(textOf(renderer.root), /已选 0 \/ 2 份/u)
  assert.ok(boxes().every(box => !box.props.disabled))
  tick(0)
  tick(2)
  assert.deepEqual(state.selected, ['mat_pick0001', 'mat_pick0003'])
  assert.match(textOf(renderer.root), /已选 2 \/ 2 份/u)
  assert.match(textOf(renderer.root), /已经选满 2 份。要换一份，先取消勾选一份。/u)
  assert.deepEqual(boxes().map(box => Boolean(box.props.disabled)), [false, true, false, true], 'only the unpicked ones are greyed out')
  tick(1)
  assert.deepEqual(state.selected, ['mat_pick0001', 'mat_pick0003'], 'a greyed box picks nothing')
  tick(0)
  assert.deepEqual(state.selected, ['mat_pick0003'])
  assert.ok(boxes().every(box => !box.props.disabled), 'room again once one is unticked')
  assert.doesNotMatch(textOf(renderer.root), /已经选满/u)
})

test('files uploaded in the picker beyond its room stay in the library, and it says so', async () => {
  const { renderer, state, tick } = await renderPicker(2)
  tick(3)
  const zone = renderer.root.find(node => typeof node.props.onAdded === 'function')
  await act(async () => { zone.props.onAdded([{ id: 'mat_newone01' }, { id: 'mat_newtwo02' }, { id: 'mat_newthr03' }]) })
  assert.deepEqual(state.selected, ['mat_pick0004', 'mat_newone01'])
  assert.match(textOf(renderer.root), /另外 2 份已存进资料库，但没有选上：最多只能选 2 份。/u)
})

test('the ⋯ menu opens, runs the action picked and closes', async () => {
  const listeners = new Map()
  globalThis.document = { addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type) }
  try {
    const picked = []
    let renderer
    await act(async () => {
      renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { api: {}, t, language: 'zh' } }, h(bundle.MoreMenu, { items: [{ label: '删除课程', danger: true, onSelect: () => picked.push('delete') }] })))
    })
    const toggle = renderer.root.find(node => node.type === 'button' && node.props['aria-haspopup'] === 'menu')
    assert.equal(toggle.props['aria-label'], '更多操作')
    assert.equal(renderer.root.findAll(node => node.props.role === 'menuitem').length, 0)
    await act(async () => { toggle.props.onClick() })
    const [item] = renderer.root.findAll(node => node.type === 'button' && node.props.role === 'menuitem')
    assert.equal(item.props['data-danger'], 'true')
    assert.ok(listeners.has('keydown') && listeners.has('pointerdown'), 'Escape and a press outside close it')
    await act(async () => { listeners.get('keydown')({ key: 'Escape' }) })
    assert.equal(renderer.root.findAll(node => node.props.role === 'menuitem').length, 0)
    await act(async () => { toggle.props.onClick() })
    await act(async () => { renderer.root.find(node => node.props.role === 'menuitem').props.onClick() })
    assert.deepEqual(picked, ['delete'])
    assert.equal(renderer.root.findAll(node => node.props.role === 'menuitem').length, 0, 'closed after the pick')
    const stop = []
    renderer.root.find(node => node.props.className === 'aha-menuAnchor').props.onClick({ stopPropagation: () => stop.push(true) })
    assert.deepEqual(stop, [true], 'a click on it never opens the card under it')
  } finally {
    delete globalThis.document
  }
})

const FOLDERS = [{ id: 'fld_math0001', name: '五上数学' }, { id: 'fld_phys0001', name: '物理' }]
const FILED = [
  { id: 'mat_math0010', title: '第10讲 小数除法', kind: 'pdf', pages: 4, folderId: 'fld_math0001' },
  { id: 'mat_math0002', title: '第2讲 小数乘法', kind: 'pdf', pages: 4, folderId: 'fld_math0001' },
  { id: 'mat_math0003', title: '第3讲 位置', kind: 'pdf', pages: 4, folderId: 'fld_math0001' },
  { id: 'mat_phys0001', title: '力', kind: 'pdf', pages: 4, folderId: 'fld_phys0001' },
  { id: 'mat_loose001', title: '笔记', kind: 'markdown' },
]

test('the picker shows a folder at a time and picks a whole folder, as much as there is room for', async () => {
  const api = { call: async endpoint => (endpoint === 'material/list' ? FILED : endpoint === 'folder/list' ? { folders: FOLDERS } : null) }
  const state = { selected: ['mat_loose001'] }
  let renderer
  const element = () => h(bundle.AppContext.Provider, { value: { api, t, language: 'zh' } }, h(bundle.MaterialPicker, { selected: state.selected, max: 3, onChange: value => { state.selected = value; renderer.update(element()) }, onClose() {} }))
  await act(async () => { renderer = TestRenderer.create(element()) })
  const chips = () => renderer.root.findAll(node => node.type === 'button' && node.props.className === 'aha-chip')
  assert.deepEqual(chips().map(textOf), ['全部5', '未分类1', '五上数学3', '物理1'])
  const titles = () => renderer.root.findAll(node => node.type === 'label').map(node => textOf(node.findByType('b')))
  await act(async () => { chips()[2].props.onClick() })
  assert.deepEqual(titles(), ['第2讲 小数乘法', '第3讲 位置', '第10讲 小数除法'], 'in name order, numbers in order')
  await press(renderer, '全选这个文件夹（3 份）')
  assert.deepEqual(state.selected, ['mat_loose001', 'mat_math0002', 'mat_math0003'], 'as many as there is room for, in order')
  assert.match(textOf(renderer.root), /这个文件夹还有 1 份没选上：最多只能选 3 份。/u)
  await act(async () => { chips()[3].props.onClick() })
  assert.deepEqual(titles(), ['力'])
  assert.doesNotMatch(textOf(renderer.root), /没选上/u, 'the note is about the folder it was for')
  await act(async () => { chips()[2].props.onClick() })
  // One unpicked by hand: the folder is picked again into the room left.
  act(() => { renderer.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange() })
  assert.deepEqual(state.selected, ['mat_loose001', 'mat_math0003'])
  await press(renderer, '全选这个文件夹（3 份）')
  assert.deepEqual(state.selected, ['mat_loose001', 'mat_math0003', 'mat_math0002'])
  // Picked whole (room allowing): the button unpicks the folder.
  state.selected = ['mat_math0002', 'mat_math0003', 'mat_math0010']
  await act(async () => { renderer.update(element()) })
  await press(renderer, '取消全选这个文件夹')
  assert.deepEqual(state.selected, [])
})

test('a whole folder of the computer is planned, confirmed, uploaded into its folder and reported', async () => {
  const calls = []
  const sent = []
  globalThis.document = { baseURI: 'http://dsh.test/plugins/aha/', addEventListener() {}, removeEventListener() {} }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const query = new URL(url).searchParams
    sent.push({ name: query.get('name'), folder: query.get('folder') })
    if (query.get('name').endsWith('坏.pdf')) return { status: 200, json: async () => ({ ok: false, error: { code: 'aha-tutor/encrypted', message: 'This PDF is password protected' } }) }
    return { status: 200, json: async () => ({ ok: true, value: { job: { id: 'job_x', status: 'done', result: { material: { id: `mat_${sent.length}`, title: query.get('name') } } } } }) }
  }
  try {
    const api = {
      async call(endpoint, payload) {
        calls.push([endpoint, payload])
        if (endpoint === 'folder/list') return { folders: [{ id: 'fld_math0001', name: '五上数学' }] }
        if (endpoint === 'material/list') return [{ id: 'mat_old', fileName: '第1讲.pdf', fileSize: 10, folderId: 'fld_math0001' }]
        if (endpoint === 'folder/create') return { folder: { id: 'fld_new00001', name: payload.name }, existed: false }
        return null
      },
      follow: async value => value.job.result,
      cancel: async () => undefined,
    }
    const added = []
    let renderer
    await act(async () => {
      renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { api, t, language: 'zh' } }, h(bundle.UploadZone, { onAdded: (materials, info) => added.push([materials.map(material => material.id), info.folders.map(folder => folder.id)]) })))
    })
    const pickFolder = async files => {
      const input = renderer.root.find(node => node.type === 'input' && node.props.webkitdirectory !== undefined)
      await act(async () => { input.props.onChange({ currentTarget: { files, value: 'x' } }) })
    }

    // Into the folder of the same name: the file already there is skipped.
    await pickFolder([file('五上数学/第1讲.pdf'), file('五上数学/第2讲.pdf'), file('五上数学/单元/坏.pdf'), file('五上数学/录像.mp4'), file('五上数学/.DS_Store')])
    const dialog = () => renderer.root.findAll(node => node.props.role === 'dialog')
    assert.equal(dialog().length, 1)
    const plan = textOf(dialog()[0])
    assert.match(plan, /会把 2 个文件上传到资料库里已有的文件夹「五上数学」。/u)
    assert.match(plan, /1 个文件已经在这个文件夹里，会跳过。/u)
    assert.match(plan, /1 个文件不支持，会跳过：录像\.mp4/u)
    assert.match(plan, /会用掉一些模型额度/u)
    assert.doesNotMatch(plan, /DS_Store/u)
    await press(renderer, '开始上传（2 个）')
    assert.deepEqual(sent, [{ name: '单元/坏.pdf', folder: 'fld_math0001' }, { name: '第2讲.pdf', folder: 'fld_math0001' }], 'sent by path in name order, into the folder')
    assert.equal(calls.filter(([endpoint]) => endpoint === 'folder/create').length, 0, 'the folder of that name is used')
    const report = textOf(renderer.root.find(node => node.props.className === 'aha-uploadReport'))
    assert.match(report, /已上传 1 份到「五上数学」。/u)
    assert.match(report, /跳过 1 个已经在里面的文件。/u)
    assert.match(report, /1 个没传成：单元\/坏\.pdf（/u)
    assert.deepEqual(added, [[['mat_2'], ['fld_math0001']]])

    // A new name makes a folder; cancelling the plan sends nothing.
    sent.length = 0
    await pickFolder([file('物理/力.pdf')])
    assert.match(textOf(dialog()[0]), /会在资料库新建文件夹「物理」，上传其中的 1 个文件。/u)
    await press(renderer, '取消')
    assert.deepEqual([sent.length, dialog().length], [0, 0])
    await pickFolder([file('物理/力.pdf')])
    await press(renderer, '开始上传（1 个）')
    assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'folder/create').map(([, payload]) => payload), [{ name: '物理', reuse: true }])
    assert.deepEqual(sent, [{ name: '力.pdf', folder: 'fld_new00001' }])

    // Too many files: said, not read.
    await pickFolder(Array.from({ length: 1001 }, (_, index) => file(`大/${index}.pdf`)))
    assert.match(textOf(dialog()[0]), /「大」里的文件太多了（超过 1000 个），没有读取。/u)
    assert.equal(renderer.root.findAll(node => node.type === 'button' && textOf(node).startsWith('开始上传')).length, 0)
  } finally {
    globalThis.fetch = realFetch
    delete globalThis.document
  }
})

function file(path, size = 10) {
  return { name: path.split('/').pop(), size, type: 'application/pdf', webkitRelativePath: path }
}

test('the library starts a course from a whole folder, in file order, at most 30 after saying so', async () => {
  const folderMaterials = count => Array.from({ length: count }, (_, index) => ({ id: `mat_lib${String(index + 1).padStart(5, '0')}`, title: `讲义 ${count - index}`, kind: 'markdown', fileName: `第${index + 1}讲.md`, folderId: 'fld_math0001' }))
  for (const [count, asks] of [[3, false], [32, true]]) {
    const calls = []
    const visited = []
    const library = folderMaterials(count)
    const api = {
      async call(endpoint, payload) {
        calls.push([endpoint, payload])
        if (endpoint === 'material/list') return [...library].reverse()
        if (endpoint === 'folder/list') return { folders: [{ id: 'fld_math0001', name: '数学' }] }
        if (endpoint === 'course/start') return { job: { id: 'job_x', status: 'running' } }
        return null
      },
      follow: async () => null,
      cancel: async () => undefined,
    }
    let renderer
    await act(async () => {
      renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { api, t, language: 'zh', navigate: (screen, params) => visited.push([screen, params]), toast() {} } }, h(bundle.MaterialsScreen)))
    })
    await act(async () => { renderer.root.findAll(node => node.type === 'button' && node.props.className === 'aha-chip').find(node => textOf(node).startsWith('数学')).props.onClick() })
    assert.deepEqual(renderer.root.findAll(node => node.props['data-material']).slice(0, 2).map(node => textOf(node.findByType('b'))), [`讲义 ${count}`, `讲义 ${count - 1}`], 'by file name, not by title')
    await press(renderer, '用这个文件夹建课')
    if (asks) {
      assert.match(textOf(renderer.root.find(node => node.props.role === 'dialog')), /这个文件夹有 32 份资料，一门课最多用 30 份，会按名称用前 30 份建课。/u)
      assert.equal(calls.filter(([endpoint]) => endpoint === 'course/start').length, 0, 'nothing starts before the learner agrees')
      await press(renderer, '确定')
    }
    const [, payload] = calls.find(([endpoint]) => endpoint === 'course/start')
    assert.equal(payload.goal, '用「数学」里的资料学习')
    assert.deepEqual(payload.materialIds, library.slice(0, Math.min(count, 30)).map(material => material.id))
    assert.deepEqual(visited, [['craft', { jobId: 'job_x' }]])
  }
})

test('a material moves to a folder from its card', async () => {
  const calls = []
  const api = {
    async call(endpoint, payload) {
      calls.push([endpoint, payload])
      if (endpoint === 'material/list') return [{ id: 'mat_move0001', title: '讲义', kind: 'markdown' }]
      if (endpoint === 'folder/list') return { folders: [{ id: 'fld_math0001', name: '数学' }] }
      return {}
    },
  }
  const toasts = []
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { api, t, language: 'zh', navigate() {}, toast: text => toasts.push(text) } }, h(bundle.MaterialsScreen)))
  })
  const select = renderer.root.find(node => node.type === 'select' && node.props['aria-label'] === '移到文件夹')
  assert.deepEqual(select.findAllByType('option').map(textOf), ['未分类', '数学'])
  await act(async () => { select.props.onChange({ currentTarget: { value: 'fld_math0001' } }) })
  assert.deepEqual(calls.find(([endpoint]) => endpoint === 'material/move')[1], { id: 'mat_move0001', folderId: 'fld_math0001' })
  assert.deepEqual(toasts, ['「讲义」已移到「数学」。'])
})
