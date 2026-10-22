import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { snippetOf } from '../src/core/retrieval.js'
import { createJobs } from '../src/host/jobs.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

test('an excerpt is cut around where the query matches best', () => {
  const text = `${'无关的开头。'.repeat(40)}泰勒展开把函数写成多项式，误差由拉格朗日余项给出。${'无关的结尾。'.repeat(40)}`
  const snippet = snippetOf(text, '拉格朗日余项', { width: 60 })
  assert.match(snippet, /拉格朗日余项/u)
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'))
  assert.ok(snippet.length <= 62)
  assert.equal(snippetOf('short text', 'x'), 'short text')
  assert.equal(snippetOf('a'.repeat(300), 'zzz', { width: 10 }), `${'a'.repeat(10)}…`)
  assert.equal(snippetOf('## 用法\n| **举手提问** | 没听懂就举手 |'), '用法 · 举手提问 · 没听懂就举手')
})

test('the library is searched across all its materials, with pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aha-library-'))
  try {
    const store = createStore({ root: join(root, 'data') })
    const studio = createStudio({ store, llm: {}, jobs: createJobs() })
    const add = async (id, title, chunks, kind = 'pdf') => {
      await store.writeJson(store.paths.material(id), { id, title, kind, chars: chunks.join('').length, createdAt: new Date().toISOString() })
      await store.writeJson(store.paths.materialChunks(id), chunks.map((text, index) => ({ text, page: index + 1 })))
    }
    await add('mat_calculus01', '微积分讲义', ['极限与连续。', '导数的定义与几何意义。', '泰勒展开与拉格朗日余项：误差估计。'])
    await add('mat_physics001', 'Physics notes', ['Simple harmonic motion and Hooke law.', 'Taylor series appear in the small-angle approximation.'])
    await add('mat_photo00001', '照片', ['泰勒'], 'image')
    const { results } = await studio.searchMaterials({ query: '泰勒展开 余项' })
    assert.equal(results[0].materialId, 'mat_calculus01')
    assert.equal(results[0].page, 3)
    assert.match(results[0].snippet, /拉格朗日余项/u)
    assert.ok(!results.some(hit => hit.materialId === 'mat_photo00001'), 'images have no text to search')
    const english = await studio.searchMaterials({ query: 'Taylor series' })
    assert.deepEqual(english.results.map(hit => [hit.title, hit.page]), [['Physics notes', 2]])
    assert.deepEqual((await studio.searchMaterials({ query: '   ' })).results, [])
    // A new material is found without a restart.
    await add('mat_extra00001', '补充', ['泰勒展开的收敛半径。'])
    assert.ok((await studio.searchMaterials({ query: '收敛半径' })).results.some(hit => hit.materialId === 'mat_extra00001'))
    // The endpoint passes only a string on.
    const routes = createRoutes({ studio })
    assert.deepEqual((await routes['material/search']({ query: { evil: true } })).results, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
