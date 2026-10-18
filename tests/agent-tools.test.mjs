import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, TOOL_GUIDE } from '../src/agent.js'
import { publishRuntime } from '../src/host/runtime.js'

test('the preset registers five tools with schemas DSH accepts and a guide section', async () => {
  const tools = []
  const sections = []
  apply({ tools: { register: definition => { tools.push(definition); return () => undefined } }, systemPrompt: { section: section => { sections.push(section); return () => undefined } } })
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['aha_cheatsheet', 'aha_course', 'aha_learner', 'aha_quiz', 'aha_whiteboard'])
  assert.equal(sections[0].interpolate, false)
  assert.equal(sections[0].text, TOOL_GUIDE)

  const started = []
  const unpublish = publishRuntime({
    ready: Promise.resolve(),
    store: { readJson: async () => null, paths: { profile: () => 'profile.json' } },
    courses: { list: async () => [{ title: '线性代数', status: 'ready', archived: false, progress: { percent: 40 }, next: { title: '特征值' } }] },
    studio: { assist: request => { started.push(request); return { id: 'job_abcdefgh' } } },
    jobs: { get: () => null },
  })
  try {
    const board = tools.find(tool => tool.name === 'aha_whiteboard')
    const value = await board.execute({ topic: '特征值', request: '直观解释', mode: 'visualize' }, { signal: new AbortController().signal })
    assert.match(value.threadId, /^thd_/u)
    assert.equal(started[0].mode, 'visualize')
    assert.equal(started[0].newThreadId, value.threadId)
    assert.equal(board.output.presentationMeta({ mode: 'visualize' }, value).kind, 'aha-tutor/board')
    assert.match(board.output.render({}, value)[0].text, /side panel/u)

    const learner = tools.find(tool => tool.name === 'aha_learner')
    const summary = await learner.execute({}, { signal: new AbortController().signal })
    assert.match(summary, /线性代数 — 40% done, next: 特征值/u)
  } finally {
    unpublish()
  }
})
