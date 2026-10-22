import assert from 'node:assert/strict'
import { test } from 'node:test'

import { layoutMindMap, MAP_GAP, outlineTree, textWidth } from '../src/ui/mindmap.js'

const outline = {
  title: '简谐运动',
  units: [
    { title: '振动从哪里来', lectures: [{ title: '回复力', lessons: ['回复力：为什么会来回振动', '振幅、周期与频率'] }, { title: '运动的样子', lessons: ['从圆周运动看简谐运动'] }] },
    { title: '单摆与能量', lectures: [{ title: '单摆', lessons: ['小角度近似：单摆为什么是简谐运动，以及它在多大的摆角之内才算准确'] }] },
  ],
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('the outline grows to the right, each node centred on what hangs from it', () => {
  const map = layoutMindMap(outlineTree(outline))
  const node = key => map.nodes.find(item => item.key === key)
  assert.deepEqual(map.nodes.map(item => item.key), ['root', 'u0', 'u0.0', 'u0.0.0', 'u0.0.1', 'u0.1', 'u0.1.0', 'u1', 'u1.0', 'u1.0.0'], 'in reading order')
  // Columns: course, units, lectures, lessons.
  assert.ok(node('root').x < node('u0').x && node('u0').x < node('u0.0').x && node('u0.0').x < node('u0.0.0').x)
  assert.equal(node('u0').x, node('u1').x)
  // A lecture sits at the middle of its lessons.
  const centre = item => item.y + item.h / 2
  assert.ok(Math.abs(centre(node('u0.0')) - (centre(node('u0.0.0')) + centre(node('u0.0.1'))) / 2) < 1e-9)
  // Nothing overlaps, and units are set apart.
  for (const [index, a] of map.nodes.entries()) for (const b of map.nodes.slice(index + 1)) assert.ok(!overlaps(a, b), `${a.key} × ${b.key}`)
  assert.ok(node('u1.0.0').y - (node('u0.1.0').y + node('u0.1.0').h) >= MAP_GAP.y + MAP_GAP.unit - 1e-9)
  // A long title wraps into a taller box; the map's size covers everything.
  assert.ok(node('u1.0.0').h > node('u0.1.0').h)
  assert.ok(map.nodes.every(item => item.x + item.w <= map.width && item.y + item.h <= map.height))
  assert.deepEqual(map.links.filter(link => link.from === 'u0').map(link => link.to), ['u0.0', 'u0.1'])
  assert.equal(map.last, 'u1.0.0', 'the newest node is the last lesson')
})

test('a map can be laid out while the outline is still being written', () => {
  assert.equal(layoutMindMap(outlineTree({ title: '' }, '目标')).nodes[0].title, '目标', 'the goal stands in for a title not yet written')
  const growing = layoutMindMap(outlineTree({ title: '课', units: [{ title: '第一单元', lectures: [{ title: '', lessons: [] }] }] }))
  assert.deepEqual(growing.nodes.map(item => [item.key, item.title]), [['root', '课'], ['u0', '第一单元'], ['u0.0', '…']])
  assert.equal(growing.last, 'u0.0')
  assert.equal(layoutMindMap(outlineTree({ title: '课' })).last, 'root')
  // Lessons with a meta line are taller.
  const plain = layoutMindMap({ title: 'c', units: [{ key: 'u0', title: 'u', lectures: [{ key: 'l', title: 'l', lessons: [{ key: 'a', title: 'a' }] }] }] })
  const meta = layoutMindMap({ title: 'c', units: [{ key: 'u0', title: 'u', lectures: [{ key: 'l', title: 'l', lessons: [{ key: 'a', title: 'a', meta: { minutes: 12 } }] }] }] })
  assert.equal(meta.nodes.at(-1).h - plain.nodes.at(-1).h, MAP_GAP.meta)
  assert.ok(textWidth('简谐', 14) > textWidth('ab', 14))
})
