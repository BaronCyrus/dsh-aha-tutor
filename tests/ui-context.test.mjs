import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { createElement as h } from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import { SETTINGS_CHANNEL, useAppValue } from '../src/ui/context.js'
import { cloudVoiceOf } from '../src/ui/speech.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function memoryStorage() {
  const items = new Map()
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
  }
}

beforeEach(() => {
  globalThis.window = { localStorage: memoryStorage() }
})

afterEach(() => {
  delete globalThis.window
})

// A host whose settings the test changes; it counts how often they are read.
function fakeHost(settings) {
  const host = { settings, reads: 0 }
  host.rpc = {
    call: async (channel, endpoint) => {
      if (endpoint !== 'settings/get') return { ok: true, value: {} }
      host.reads += 1
      return { ok: true, value: structuredClone(host.settings) }
    },
  }
  return host
}

// One open view of the plugin: the full page, a side-panel board or a card.
function View({ host, seen }) {
  seen.current = useAppValue({ rpc: host.rpc, t: key => key, language: 'zh' }).value
  return null
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Messages between channels arrive a moment later; wait for what they cause.
async function until(check) {
  for (let tries = 0; tries < 100 && !check(); tries += 1) await act(() => pause(10))
  assert.ok(check(), String(check))
}

test('a voice changed in one view is the voice of every open view, audio kept in the browser included', async () => {
  const host = fakeHost({ voiceEngine: 'cloud', ttsProvider: 'openai', tts: { openai: { voice: 'alloy' } } })
  const page = { current: null }
  const board = { current: null }
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(h('div', null, h(View, { host, seen: page }), h(View, { host, seen: board })))
  })
  await until(() => host.reads === 2 && board.current.settings.voiceEngine === 'cloud')
  assert.equal(page.current.speech.settings.cloudVoice, cloudVoiceOf(host.settings))

  // Settings' Test speaks as soon as the save is done, before React renders
  // again: the voice must already be the new one by then.
  host.settings = { ...host.settings, tts: { openai: { voice: 'nova' } } }
  await act(async () => {
    await page.current.settingsSaved()
    assert.equal(page.current.speech.settings.cloudVoice, cloudVoiceOf(host.settings))
  })
  await until(() => board.current.settings.tts.openai.voice === 'nova')
  assert.equal(board.current.speech.settings.cloudVoice, cloudVoiceOf(host.settings), 'the other view\'s audio is kept for the new voice')
  await act(() => pause(30))
  assert.equal(host.reads, 4, 'once in each view: the saving view does not hear itself')

  // The system voice lives in the browser; it travels with the message.
  await act(async () => { page.current.setVoiceId('Tingting') })
  await until(() => board.current.settings.voiceId === 'Tingting')
  assert.equal(page.current.settings.voiceId, 'Tingting')
  assert.equal(host.reads, 4)

  await act(async () => { renderer.unmount() })
  const elsewhere = new BroadcastChannel(SETTINGS_CHANNEL)
  elsewhere.postMessage({})
  await pause(50)
  elsewhere.close()
  assert.equal(host.reads, 4, 'a closed view no longer listens')
})
