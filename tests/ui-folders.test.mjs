import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanFolderName, folderKey } from '../src/core/library.js'
import { ALL, FOLDER_FILE_LIMIT, foldersFromInput, inView, knownView, planFolder, readDrop, readFolderEntry, shortList, UNFILED, viewCounts } from '../src/ui/folders.js'
import { format, zh } from '../src/ui/i18n.js'

const t = (key, values) => format(zh[key] ?? key, values)

const MATERIALS = [
  { id: 'mat_a', title: '第10讲 导数', folderId: 'fld_math' },
  { id: 'mat_b', title: '随手笔记' },
  { id: 'mat_c', title: '第2讲 函数', folderId: 'fld_math' },
  { id: 'mat_d', title: '力学', folderId: 'fld_phys' },
  { id: 'mat_e', title: '旧讲义', folderId: null },
]

test('a folder lists its materials by title, numbers in order; all and unfiled keep their order', () => {
  assert.deepEqual(inView(MATERIALS, 'fld_math').map(material => material.id), ['mat_c', 'mat_a'])
  const uploaded = [{ id: 'u1', title: '匀变速直线运动', fileName: '第2讲 匀变速.md', folderId: 'f' }, { id: 'u2', title: '运动的描述', fileName: '第1讲 运动.md', folderId: 'f' }, { id: 'u3', title: '链接', folderId: 'f' }]
  assert.deepEqual(inView(uploaded, 'f').map(material => material.id), ['u2', 'u1', 'u3'], 'by file name as on the computer, else by title')
  assert.deepEqual(inView(MATERIALS, UNFILED).map(material => material.id), ['mat_b', 'mat_e'])
  assert.equal(inView(MATERIALS, ALL), MATERIALS)
  assert.deepEqual([...viewCounts(MATERIALS)], [[ALL, 5], [UNFILED, 2], ['fld_math', 2], ['fld_phys', 1]])
  const folders = [{ id: 'fld_math', name: '数学' }]
  assert.deepEqual([knownView('fld_math', folders), knownView('fld_gone', folders), knownView(UNFILED, []), knownView(ALL, [])], ['fld_math', ALL, UNFILED, ALL])
})

test('folder names are kept tidy and told apart as the learner would', () => {
  assert.equal(cleanFolderName('  五上\n数学\t 课本 '), '五上 数学 课本')
  assert.equal([...cleanFolderName('📚'.repeat(70))].length, 60, 'cut by characters, never inside one')
  assert.equal(cleanFolderName(' \n '), '')
  assert.equal(folderKey('ＭＡＴＨ  五上'), folderKey('math 五上'))
})

const file = (path, size = 10) => ({ name: path.split('/').pop(), size, type: '', webkitRelativePath: path })

test('a folder picked with the dialog is grouped by the folder, with paths inside it', () => {
  const [group] = foldersFromInput([file('数学/第2讲.pdf'), file('数学/第一章/练习.pdf'), file('数学/.DS_Store')])
  assert.equal(group.name, '数学')
  assert.deepEqual(group.entries.map(entry => entry.path), ['第2讲.pdf', '第一章/练习.pdf', '.DS_Store'])
  const many = foldersFromInput(Array.from({ length: FOLDER_FILE_LIMIT + 1 }, (_, index) => file(`大/${index}.pdf`)))
  assert.deepEqual(many, [{ name: '大', entries: [], tooMany: true }])
})

// File system entries as a drop hands them out: directories read in batches.
function directory(name, children, batch = 2) {
  return {
    name,
    isDirectory: true,
    isFile: false,
    createReader() {
      let at = 0
      return { readEntries(done) { const next = children.slice(at, at + batch); at += batch; setTimeout(() => done(next), 0) } }
    },
  }
}
const fileEntry = (name, size = 10) => ({ name, isDirectory: false, isFile: true, file(done) { done({ name, size, type: '' }) } })

test('a dropped folder is read with its subfolders, hidden folders left closed', async () => {
  const root = directory('资料', [fileEntry('b.pdf'), directory('第一章', [fileEntry('练习.docx'), fileEntry('答案.pdf')]), directory('.git', [fileEntry('HEAD')]), fileEntry('a.pdf')])
  const loose = { name: 'loose.md', size: 4 }
  const items = [
    { kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null },
    { kind: 'file', webkitGetAsEntry: () => fileEntry('loose.md'), getAsFile: () => loose },
    { kind: 'string', webkitGetAsEntry: () => null },
  ]
  const dropped = readDrop({ items, files: [] })
  assert.deepEqual(dropped.loose, [loose])
  const [folder] = await dropped.folders()
  assert.equal(folder.name, '资料')
  assert.deepEqual(folder.entries.map(entry => entry.path).sort(), ['a.pdf', 'b.pdf', '第一章/答案.pdf', '第一章/练习.docx'].sort())
  assert.deepEqual(await readFolderEntry(directory('大', [fileEntry('1.pdf'), fileEntry('2.pdf'), fileEntry('3.pdf')]), 2), { name: '大', entries: [], tooMany: true })
  // Without entries, the dropped files are loose ones.
  const plain = readDrop({ items: [], files: [loose] })
  assert.deepEqual([plain.loose, await plain.folders()], [[loose], []])
})

test('a folder upload is planned: into the folder of its name, new files only, the unreadable listed', () => {
  const folders = [{ id: 'fld_math', name: '五上数学' }]
  const materials = [{ id: 'mat_x', folderId: 'fld_math', fileName: '第一章/练习.pdf', fileSize: 10 }, { id: 'mat_y', folderId: 'fld_other', fileName: '第2讲.pdf', fileSize: 10 }]
  const entries = ['第10讲.pdf', '第2讲.pdf', '第一章/练习.pdf', '第一章/练习.PDF', '视频.mp4', '旧课件.ppt', '.DS_Store', '~$讲义.docx', 'Thumbs.db'].map((path, index) => ({ file: { name: path.split('/').pop(), size: index === 3 ? 99 : 10 }, path }))
  const plan = planFolder({ name: ' 五上数学 ', entries }, { folders, materials })
  assert.equal(plan.folder, folders[0], 'the folder of that name, spaces aside')
  assert.deepEqual(plan.upload.map(entry => entry.path), ['第2讲.pdf', '第10讲.pdf', '第一章/练习.PDF'], 'in name order; a changed file is new')
  assert.deepEqual(plan.known, ['第一章/练习.pdf'])
  assert.deepEqual(plan.unsupported, ['旧课件.ppt', '视频.mp4'])
  const fresh = planFolder({ name: '', entries: entries.slice(0, 2) }, { folders, materials, fallbackName: '新文件夹' })
  assert.deepEqual([fresh.name, fresh.folder, fresh.upload.length, fresh.known.length], ['新文件夹', null, 2, 0], 'a new folder knows no files')
  assert.equal(planFolder({ name: '大', tooMany: true }).tooMany, true)
})

test('long lists are cut for a sentence', () => {
  assert.equal(shortList(['a', 'b'], t), 'a、b')
  assert.equal(shortList(['a', 'b', 'c', 'd'], t, 2), 'a、b 等 2 个')
})
