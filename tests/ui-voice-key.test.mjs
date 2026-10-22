import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement as h, createRef } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'tsdown'

import { format, zh } from '../src/ui/i18n.js'
import { HOLD_MS } from '../src/ui/talk-key.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const root = fileURLToPath(new URL('..', import.meta.url))
const t = (key, values) => format(zh[key] ?? key, values)

let bundle
let outDir

// VoiceButton is JSX: bundle it for Node, with React shared with the
// renderer (the bundle sits under node_modules so it finds the same React).
before(async () => {
  const cache = join(root, 'node_modules', '.cache')
  await mkdir(cache, { recursive: true })
  outDir = await mkdtemp(join(cache, 'aha-voice-key-'))
  await build({
    config: false,
    entry: { voice: join(root, 'tests', 'fixtures', 'ui', 'voice-button.js') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    logLevel: 'silent',
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(root, 'tests', 'fixtures', 'ui', 'primitives.js') },
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'], alwaysBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
  })
  const file = (await readdir(outDir)).find(name => /^voice\.m?js$/u.test(name))
  bundle = await import(pathToFileURL(join(outDir, file)).href)
})

after(() => rm(outDir, { recursive: true, force: true }))

// A browser for the recorder: a microphone that opens when told to, a
// MediaRecorder, audio decoding, and DSH's speech route answering with the
// next of `said`.
function fakeBrowser(said) {
  const saved = {}
  for (const name of ['navigator', 'window', 'document', 'MediaRecorder', 'AudioContext', 'OfflineAudioContext', 'fetch']) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name)
  const state = { opened: 0, closed: 0, heard: 0, hold: false, release: null }
  const define = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  define('navigator', {
    mediaDevices: {
      getUserMedia: () => {
        state.opened += 1
        const stream = { getTracks: () => [{ stop() { state.closed += 1 } }] }
        // Held: the microphone opens when the test says so.
        return state.hold ? new Promise(resolve => { state.release = () => resolve(stream) }) : Promise.resolve(stream)
      },
    },
  })
  define('window', { localStorage: { getItem: () => null } })
  define('document', { baseURI: 'http://127.0.0.1:4000/' })
  define('MediaRecorder', class {
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      setTimeout(() => this.onstop?.(), 0)
    }
  })
  define('AudioContext', class {
    async decodeAudioData() { return { duration: 1 } }
    close() { return Promise.resolve() }
  })
  define('OfflineAudioContext', class {
    constructor(channels, frames) { this.frames = frames }
    destination = {}
    createBufferSource() { return { connect() {}, start() {} } }
    async startRendering() { return { getChannelData: () => new Float32Array(this.frames) } }
  })
  define('fetch', async () => {
    state.heard += 1
    return { status: 200, json: async () => ({ ok: true, value: { text: said[state.heard - 1] } }) }
  })
  return {
    state,
    restore() {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    },
  }
}

// Let the recorder's promises and timers run.
const settle = () => act(async () => { for (let round = 0; round < 6; round += 1) await new Promise(resolve => setTimeout(resolve, 0)) })

function renderMic({ status = { state: 'ready', maxSeconds: 120 }, disabled = false } = {}) {
  const started = []
  const texts = []
  const api = { call: async endpoint => (endpoint === 'speech/status' ? status : null) }
  const mic = createRef()
  let renderer
  act(() => {
    renderer = TestRenderer.create(h(bundle.AppContext.Provider, { value: { api, t, language: 'zh' } },
      h(bundle.VoiceButton, { ref: mic, disabled, keyHint: t('talkKeyHint'), onStart: () => started.push(true), onText: text => texts.push(text) })))
  })
  const button = () => renderer.root.find(node => node.type === 'button' && String(node.props.className).includes('aha-micBtn'))
  return { renderer, mic, started, texts, button }
}

test('holding V records while it is down; a tap records until the next press', async () => {
  const browser = fakeBrowser(['为什么要平方？', '这一步再讲一遍', '还有一个问题'])
  try {
    const { renderer, mic, started, texts, button } = renderMic()
    await settle()
    assert.equal(button().props.title, `${zh.voiceAsk}\n${zh.talkKeyHint}`, 'the tooltip names the key')

    // Held: the lesson pauses, the microphone records, and letting go sends it.
    act(() => mic.current.press(1000))
    await settle()
    assert.deepEqual([started.length, button().props['data-state'], browser.state.opened], [1, 'recording', 1])
    act(() => mic.current.release(1000 + HOLD_MS + 600))
    await settle()
    assert.deepEqual(texts, ['为什么要平方？'])
    assert.equal(button().props['data-state'], 'idle')
    assert.equal(browser.state.closed, 1, 'the microphone is closed')

    // Tapped: still recording after the key comes up, until it is pressed again.
    act(() => mic.current.press(5000))
    await settle()
    act(() => mic.current.release(5000 + 90))
    await settle()
    assert.equal(button().props['data-state'], 'recording')
    act(() => mic.current.press(9000))
    act(() => mic.current.release(9000 + 600))
    await settle()
    assert.deepEqual(texts, ['为什么要平方？', '这一步再讲一遍'], 'one recording, sent once')

    // Let go while the microphone is still opening: it stops as soon as it is open.
    browser.state.hold = true
    act(() => mic.current.press(12000))
    await settle()
    assert.equal(button().props['data-state'], 'starting')
    act(() => mic.current.release(12000 + HOLD_MS + 10))
    await act(async () => browser.state.release())
    await settle()
    assert.deepEqual([texts.length, button().props['data-state'], browser.state.opened, browser.state.closed], [3, 'idle', 3, 3])
    act(() => renderer.unmount())
  } finally {
    browser.restore()
  }
})

test('V does nothing on a disabled microphone, and says how to set up Voice input when it is off', async () => {
  const browser = fakeBrowser(['?'])
  try {
    const disabled = renderMic({ disabled: true })
    await settle()
    act(() => disabled.mic.current.press(1000))
    await settle()
    assert.deepEqual([disabled.started.length, browser.state.opened], [0, 0])
    act(() => disabled.renderer.unmount())

    const off = renderMic({ status: { state: 'off', maxSeconds: 120 } })
    await settle()
    act(() => off.mic.current.press(1000))
    await settle()
    assert.deepEqual([off.started.length, browser.state.opened, off.button().props['data-state']], [0, 0, 'idle'], 'the lesson goes on')
    const note = off.renderer.root.find(node => node.props?.className === 'aha-micNote')
    assert.match(note.children.join(''), /语音输入/u)
    act(() => off.mic.current.release(1000 + HOLD_MS + 100))
    await settle()
    assert.equal(off.button().props['data-state'], 'idle')
    act(() => off.renderer.unmount())
  } finally {
    browser.restore()
  }
})
