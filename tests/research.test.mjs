import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanQueries, createResearch, mergeSources, skipReason } from '../src/host/research.js'

const source = (url, title = url, snippet = '') => ({ url, title, snippet })

test('search queries are cleaned, deduplicated and capped, with the goal as a fallback', () => {
  assert.deepEqual(cleanQueries(['等差数列 教学', ' 等差数列 教学 ', '', 'Sn 推导', '高斯求和', '第四个'], '等差数列'), ['等差数列 教学', 'Sn 推导', '高斯求和'])
  assert.deepEqual(cleanQueries(null, '学会配方法'), ['学会配方法'])
})

test('sources from several searches merge round-robin, untrusted fields capped and odd links dropped', () => {
  const merged = mergeSources([
    [source('https://a.example/1', 'A1'), source('https://b.example/2', 'B2')],
    [source('https://a.example/1', 'A1 again'), source('javascript:alert(1)', 'bad'), source('https://c.example/3', '', 'x'.repeat(900))],
  ])
  assert.deepEqual(merged.map(entry => entry.url), ['https://a.example/1', 'https://b.example/2', 'https://c.example/3'])
  assert.equal(merged[2].title, 'c.example', 'a source without a title is named by its host')
  assert.equal(merged[2].snippet.length, 400)
  const many = mergeSources([Array.from({ length: 30 }, (_, index) => source(`https://s.example/${index}`))])
  assert.equal(many.length, 10)
})

test('a skipped search says why', () => {
  assert.equal(skipReason({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }), 'no-credential')
  assert.equal(skipReason({ code: 'WEB_PROVIDER_UNAVAILABLE' }), 'unavailable')
  assert.equal(skipReason(new Error('boom')), 'failed')
  assert.equal(skipReason(undefined), 'empty')
})

test('research asks for queries, searches through DSH and degrades when it cannot', async () => {
  const llm = { async complete() { return JSON.stringify({ queries: ['等差数列 教学设计', '等差数列 求和 推导'] }) } }
  const searched = []
  const web = {
    async search(request, signal) {
      searched.push([request.query, request.maxResults, signal instanceof AbortSignal])
      return { sources: [source(`https://edu.example/${encodeURIComponent(request.query)}`, request.query)], truncated: false }
    },
  }
  const signal = new AbortController().signal
  const found = await createResearch({ getWeb: () => web, llm }).run({ goal: '等差数列', language: 'zh-CN', signal })
  assert.deepEqual(found.queries, ['等差数列 教学设计', '等差数列 求和 推导'])
  assert.deepEqual(searched, [['等差数列 教学设计', 6, true], ['等差数列 求和 推导', 6, true]])
  assert.equal(found.sources.length, 2)

  assert.deepEqual(await createResearch({ getWeb: () => null, llm }).run({ goal: 'x' }), { skipped: 'unavailable', sources: [] })
  const locked = { async search() { throw Object.assign(new Error('no key'), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }) } }
  const skipped = await createResearch({ getWeb: () => locked, llm }).run({ goal: 'x' })
  assert.equal(skipped.skipped, 'no-credential')
  assert.deepEqual(skipped.sources, [])
})
