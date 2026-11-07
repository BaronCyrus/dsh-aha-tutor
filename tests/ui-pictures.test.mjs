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

before(async () => {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  outDir = await mkdtemp(join(cache, 'aha-pictures-'))
  await build({
    config: false,
    entry: { pictures: join(root, 'tests', 'fixtures', 'ui', 'pictures.js') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    logLevel: 'silent',
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests', 'fixtures', 'ui', 'primitives.js') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'], alwaysBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
  })
  const file = (await readdir(outDir)).find(name => /^pictures\.m?js$/u.test(name))
  bundle = await import(pathToFileURL(join(outDir, file)).href)
})

after(() => rm(outDir, { recursive: true, force: true }))

function textOf(node) {
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

const flush = () => act(async () => { for (let index = 0; index < 8; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) })

// The page's base, for the host's routes.
function withDocument(run) {
  return async () => {
    globalThis.document = { baseURI: 'http://dsh.test/plugin/', addEventListener() {}, removeEventListener() {} }
    try {
      await run()
    } finally {
      delete globalThis.document
      delete globalThis.fetch
    }
  }
}

const picture = (id, fields = {}) => ({ id, name: `${id}.png`, mime: 'image/png', size: 100, sight: 'image', text: null, failed: null, materialId: null, ...fields })

async function render(element, value) {
  let renderer
  await act(async () => { renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { t, language: 'zh', navigate() {}, toast() {}, ...value } }, element)) })
  return renderer
}

test('what the teacher would take in of a picture, and pictures alone it could not', () => {
  assert.equal(bundle.pictureUse(picture('pic_a', { sight: 'image' })), 'image')
  assert.equal(bundle.pictureUse(picture('pic_a', { sight: 'text', text: '题目' })), 'text')
  assert.equal(bundle.pictureUse(picture('pic_a', { sight: 'text', text: '  ' })), 'none')
  assert.equal(bundle.pictureUse(picture('pic_a', { sight: 'none' })), 'none')
  assert.equal(bundle.unusableAlone([]), null)
  assert.equal(bundle.unusableAlone([picture('pic_a', { sight: 'none' }), picture('pic_b')]), null)
  assert.deepEqual(bundle.unusableAlone([picture('pic_a', { sight: 'none' })]), { code: 'pictures-need-words' })
  assert.deepEqual(bundle.unusableAlone([picture('pic_a', { sight: 'text', text: '' })]), { code: 'pictures-unread' })
})

test('the chips say what each picture is to the teacher, and how to let it see them', withDocument(async () => {
  const went = []
  const uploads = {
    leftOut: 2,
    remove() {},
    items: [
      { key: 'up:1', status: 'uploading', name: 'image.png', picture: null },
      { key: 'up:2', status: 'reading', name: 'b.png', picture: picture('pic_b', { sight: null }) },
      { key: 'pic_c', status: 'ready', picture: picture('pic_c', { sight: 'text', text: '已知 x²=4' }) },
      { key: 'pic_d', status: 'ready', picture: picture('pic_d', { sight: 'none' }) },
      { key: 'up:5', status: 'failed', name: 'big.png', picture: null, error: { code: 'image-too-large' } },
    ],
  }
  const renderer = await render(h(bundle.PictureChips, { uploads }), { navigate: screen => went.push(screen) })
  const shown = textOf(renderer.root)
  for (const line of ['正在上传…', '正在读图里的字…', '只读出了图里的字', '老师看不到这张图', '图片要小于 10 MB。', '一次提问最多附 4 张图，多出的 2 张没有附上。', '现在选的模型都看不了图']) assert.ok(shown.includes(line), line)
  // A picture being read already shows; one on its way waits.
  const thumbs = renderer.root.findAll(node => node.type === 'img')
  assert.deepEqual(thumbs.map(node => node.props.src), ['http://dsh.test/plugin/api/aha-tutor/picture?id=pic_b', 'http://dsh.test/plugin/api/aha-tutor/picture?id=pic_c', 'http://dsh.test/plugin/api/aha-tutor/picture?id=pic_d'])
  const chip = renderer.root.findAll(node => node.props.className === 'aha-attach')
  assert.deepEqual(chip.map(node => node.props['data-warn'] ?? null), [null, null, null, 'true', 'true'])
  assert.equal(chip[2].props.title, '已知 x²=4', 'the text read shows on hover')
  await act(async () => { renderer.root.find(node => node.type === 'button' && textOf(node) === '去设置').props.onClick() })
  assert.deepEqual(went, ['settings'])
}))

test('pictures read as text only say so; seen pictures need no note', withDocument(async () => {
  const uploads = { leftOut: 0, remove() {}, items: [{ key: 'a', status: 'ready', picture: picture('pic_a', { sight: 'text', text: '题' }) }] }
  const renderer = await render(h(bundle.PictureChips, { uploads }), {})
  assert.match(textOf(renderer.root), /老师只拿到图里读出的字，看不到图形/u)
  const seen = await render(h(bundle.PictureChips, { uploads: { leftOut: 0, remove() {}, items: [{ key: 'b', status: 'ready', picture: picture('pic_b') }] } }), {})
  assert.doesNotMatch(textOf(seen.root), /设置|读出的字/u)
}))

// A test component around the hooks: what it was handed, and its uploads.
function Probe({ onReady }) {
  const uploads = bundle.usePictureUploads()
  const drop = bundle.useFileDrop(found => onReady.dropped.push(found))
  onReady.current = { uploads, drop }
  return h(bundle.PictureChips, { uploads })
}

test('a screenshot pasted alone is taken; a copy with text pastes its text', withDocument(async () => {
  const state = { dropped: [] }
  await render(h(Probe, { onReady: state }), { api: { call: async () => null } })
  const shot = new File([new Uint8Array([0x89, 0x50])], 'image.png', { type: 'image/png' })
  let prevented = 0
  const paste = (files, plain) => state.current.drop.paste({ clipboardData: { files, getData: type => (type === 'text/plain' ? plain : '') }, preventDefault: () => { prevented += 1 } })
  paste([shot], '')
  paste([shot], '一列表格')
  paste([], '只是文字')
  assert.equal(state.dropped.length, 1)
  assert.deepEqual(state.dropped[0].files, [shot])
  assert.equal(prevented, 1)
}))

test('a drop of files is taken, and a drag of something else is left alone', withDocument(async () => {
  const state = { dropped: [] }
  await render(h(Probe, { onReady: state }), { api: { call: async () => null } })
  const file = new File(['%PDF-1.7'], '讲义.pdf', { type: 'application/pdf' })
  const transfer = { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file }], files: [file] }
  let prevented = 0
  const event = dataTransfer => ({ dataTransfer, preventDefault: () => { prevented += 1 }, currentTarget: { contains: () => false }, relatedTarget: null })
  await act(async () => { state.current.drop.box.onDragOver(event(transfer)) })
  assert.equal(state.current.drop.box['data-over'], 'true')
  await act(async () => { state.current.drop.box.onDrop(event(transfer)) })
  assert.equal(state.current.drop.box['data-over'], undefined)
  assert.deepEqual(state.dropped[0].files, [file])
  assert.deepEqual(await state.dropped[0].folders(), [])
  // Text dragged from the page is not a file drop.
  await act(async () => { state.current.drop.box.onDrop(event({ types: ['text/plain'], items: [] })) })
  assert.equal(state.dropped.length, 1)
  assert.equal(prevented, 2)
}))

test('pictures upload as question pictures, four at most, and one taken out is forgotten', withDocument(async () => {
  const sent = []
  const calls = []
  let next = 0
  globalThis.fetch = async (url, init) => {
    sent.push(String(url))
    next += 1
    return new Response(JSON.stringify({ ok: true, value: { job: { id: `job_${next}`, status: 'done', result: { picture: picture(`pic_up${next}`, { name: init.body.name }) } } } }), { status: 200 })
  }
  const api = {
    call: async (endpoint, payload) => { calls.push([endpoint, payload]); return null },
    follow: async value => value.job.result,
    cancel() {},
  }
  const state = { dropped: [] }
  const renderer = await render(h(Probe, { onReady: state }), { api })
  const files = Array.from({ length: 5 }, (_, index) => new File([new Uint8Array([0x89, 0x50])], `shot${index}.png`, { type: 'image/png' }))
  await act(async () => { state.current.uploads.add(files) })
  await flush()
  assert.equal(sent.length, 4)
  assert.ok(sent.every(url => url.startsWith('http://dsh.test/plugin/api/aha-tutor/upload?') && url.includes('for=question')))
  assert.deepEqual(state.current.uploads.ready.map(item => item.name), ['shot0.png', 'shot1.png', 'shot2.png', 'shot3.png'])
  assert.equal(state.current.uploads.leftOut, 1)
  assert.match(textOf(renderer.root), /多出的 1 张没有附上/u)
  assert.equal(state.current.uploads.busy, false)
  const [first] = state.current.uploads.items
  await act(async () => { state.current.uploads.remove(first.key) })
  assert.deepEqual(calls, [['picture/discard', { id: first.picture.id }]])
  assert.equal(state.current.uploads.items.length, 3)
  // Asked: the chips go, and the host keeps the pictures with the thread.
  await act(async () => { state.current.uploads.clear() })
  assert.equal(state.current.uploads.items.length, 0)
  assert.equal(calls.length, 1)
}))

test('the pictures over a board open large, say what the teacher saw, and go into the library', withDocument(async () => {
  const ran = []
  const api = {
    call: async (endpoint, payload) => (endpoint === 'picture/get' ? { pictures: payload.ids.map(id => (id === 'pic_gone' ? null : picture(id, { materialId: id === 'pic_kept' ? 'mat_kept0001' : null }))) } : null),
    run: async (endpoint, payload) => { ran.push([endpoint, payload]); return { material: { id: 'mat_new00001' } } },
  }
  const renderer = await render(h(bundle.TurnPictures, { pictures: [{ id: 'pic_one', seen: 'image' }, { id: 'pic_kept', seen: 'text' }, { id: 'pic_none', seen: 'none' }, { id: 'pic_gone', seen: 'image' }] }), { api })
  await flush()
  const shown = textOf(renderer.root)
  for (const line of ['老师只读了图里的字', '老师没看到这张图', '已存进资料库', '图已删除']) assert.ok(shown.includes(line), line)
  const keeps = renderer.root.findAll(node => node.type === 'button' && textOf(node) === '存进资料库')
  assert.equal(keeps.length, 2)
  await act(async () => { keeps[0].props.onClick() })
  await flush()
  assert.deepEqual(ran, [['picture/keep', { id: 'pic_one' }]])
  assert.equal(renderer.root.findAll(node => node.type === 'button' && textOf(node) === '存进资料库').length, 1)
  await act(async () => { renderer.root.findAll(node => node.props.className === 'aha-turnThumb')[0].props.onClick() })
  assert.ok(renderer.root.findAll(node => node.props.className === 'aha-pictureLarge').length === 1, 'opened large')
}))

// ── the home page ──────────────────────────────────────────────────────────

async function renderHome({ uploads = [] } = {}) {
  const went = []
  const calls = []
  globalThis.fetch = async url => {
    const query = new URL(String(url)).searchParams
    const name = query.get('name')
    uploads.push({ name, question: query.get('for') === 'question' })
    const result = query.get('for') === 'question' ? { picture: picture(`pic_${uploads.length}aaaa`, { name }) } : { material: { id: `mat_${uploads.length}aaaaaa`, title: name, kind: 'pdf' } }
    return new Response(JSON.stringify({ ok: true, value: { job: { id: `job_${uploads.length}`, status: 'done', result } } }), { status: 200 })
  }
  const api = {
    call: async (endpoint, payload) => {
      calls.push([endpoint, payload])
      if (endpoint === 'course/list') return []
      if (endpoint === 'plan/get') return { today: [] }
      if (endpoint === 'samples/list') return []
      return null
    },
    follow: async value => value.job.result,
    run: async () => null,
    cancel() {},
  }
  const renderer = await render(h(bundle.HomeScreen), { api, navigate: (screen, params) => went.push([screen, params]) })
  await flush()
  const mode = label => act(async () => { renderer.root.find(node => node.type === 'button' && node.props.className === 'aha-chip' && textOf(node).includes(label)).props.onClick() })
  const composer = () => renderer.root.find(node => node.props.className === 'aha-composer')
  const drop = async files => {
    const transfer = { types: ['Files'], items: files.map(file => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file })), files }
    await act(async () => { composer().props.onDrop({ dataTransfer: transfer, preventDefault() {} }) })
    await flush()
  }
  return { renderer, went, calls, uploads, mode, drop, composer }
}

const pdf = name => new File(['%PDF-1.7'], name, { type: 'application/pdf' })
const png = name => new File([new Uint8Array([0x89, 0x50])], name, { type: 'image/png' })

test('a document dropped on the home page in 消化长文档 goes into the library and is digested at once', withDocument(async () => {
  const home = await renderHome()
  await home.mode('消化长文档')
  await home.drop([pdf('论文.pdf')])
  assert.deepEqual(home.uploads, [{ name: '论文.pdf', question: false }])
  assert.deepEqual(home.went, [['item', { kind: 'digest', materialId: 'mat_1aaaaaa' }]])
}))

test('several documents dropped to digest are all kept, then one is picked', withDocument(async () => {
  const home = await renderHome()
  await home.mode('消化长文档')
  await home.drop([pdf('第一章.pdf'), pdf('第二章.pdf')])
  assert.equal(home.went.length, 0)
  assert.match(textOf(home.renderer.root), /消化哪一份？/u)
  const choice = home.renderer.root.findAll(node => node.type === 'button' && node.props.className === 'aha-option' && textOf(node).includes('第二章.pdf'))
  await act(async () => { choice[0].props.onClick() })
  assert.deepEqual(home.went, [['item', { kind: 'digest', materialId: 'mat_2aaaaaa' }]])
}))

test('in 陪我解题 a dropped picture goes with the question, a document into the library', withDocument(async () => {
  const home = await renderHome()
  await home.mode('陪我解题')
  await home.drop([png('题目.png'), pdf('讲义.pdf')])
  assert.deepEqual(home.uploads, [{ name: '题目.png', question: true }, { name: '讲义.pdf', question: false }])
  assert.match(textOf(home.renderer.root), /已附 1 份资料/u)
  // Pictures alone may start the question.
  const start = home.renderer.root.find(node => node.type === 'button' && textOf(node) === '开始')
  assert.equal(start.props.disabled, false)
  await act(async () => { start.props.onClick() })
  const [[screen, params]] = home.went
  assert.equal(screen, 'assist')
  assert.equal(params.draftMode, 'solve')
  assert.equal(params.draftRequest, '')
  assert.deepEqual(params.draftMaterials, ['mat_2aaaaaa'])
  assert.deepEqual(params.draftPictures.map(item => item.name), ['题目.png'])
}))

test('a course takes dropped pictures into the library; a short takes no files', withDocument(async () => {
  const home = await renderHome()
  await home.drop([png('课本第一页.png')])
  assert.deepEqual(home.uploads, [{ name: '课本第一页.png', question: false }])
  assert.match(textOf(home.renderer.root), /已附 1 份资料/u)
  await home.mode('两分钟短片')
  await home.drop([pdf('讲义.pdf')])
  assert.equal(home.uploads.length, 1)
  assert.match(textOf(home.renderer.root), /两分钟短片只用主题或网址，不收文件和图片/u)
}))
