import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { createElement as h, useEffect } from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import { CrashNotice, ErrorBoundary } from '../src/ui/boundary.js'
import { forgetRoute, ROUTE_KEY, useRoute } from '../src/ui/context.js'
import { zh } from '../src/ui/i18n.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const t = key => zh[key] ?? key
const realConsoleError = console.error

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
  // React reports every error a boundary catches; the tests expect them.
  console.error = () => undefined
})

afterEach(() => {
  delete globalThis.window
  console.error = realConsoleError
})

function render(element) {
  let renderer
  act(() => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

function text(renderer) {
  const parts = []
  const walk = node => {
    if (typeof node === 'string') parts.push(node)
    else if (Array.isArray(node)) node.forEach(walk)
    else if (node) walk(node.children)
  }
  walk(renderer.toJSON())
  return parts.join(' ')
}

function labels(renderer) {
  return renderer.root.findAllByType('button').map(node => node.props.children)
}

function click(renderer, label) {
  const button = renderer.root.findAllByType('button').find(node => node.props.children === label)
  assert.ok(button, `a ${label} button`)
  act(() => button.props.onClick())
}

test('a crash while rendering shows the notice in place of that part only, and retry renders it again', () => {
  let broken = true
  function Card() {
    if (broken) throw new TypeError('Cannot read properties of undefined (reading \'items\')')
    return h('p', null, 'quiz card')
  }
  const errors = []
  const renderer = render(h('div', null,
    h(ErrorBoundary, { onError: error => errors.push(error), fallback: ({ error, retry }) => h(CrashNotice, { t, error, place: 'card', onRetry: retry }) }, h(Card)),
    h('p', null, 'another card')))
  assert.equal(text(renderer), `${zh.crashPart} ${zh.retry} another card`)
  assert.equal(errors.length, 1)
  assert.equal(renderer.root.findByType('span').props.title, 'Cannot read properties of undefined (reading \'items\')', 'the raw error is on hover')
  broken = false
  click(renderer, zh.retry)
  assert.equal(text(renderer), 'quiz card another card')
  assert.equal(errors.length, 1)
})

test('a crash in an effect is caught as well', () => {
  function Lesson() {
    useEffect(() => {
      throw new ReferenceError('cancel is not defined')
    }, [])
    return h('p', null, 'lesson')
  }
  const errors = []
  const renderer = render(h(ErrorBoundary, { onError: error => errors.push(error), fallback: ({ error }) => h(CrashNotice, { t, error, place: 'tab', onRetry() {} }) }, h(Lesson)))
  assert.equal(text(renderer), `${zh.crashPart} ${zh.retry}`)
  assert.deepEqual(errors.map(error => error.message), ['cancel is not defined'])
})

test('a new reset key renders the children again', () => {
  let broken = true
  function Screen() {
    if (broken) throw new Error('broken')
    return h('p', null, 'screen')
  }
  const tree = resetKey => h(ErrorBoundary, { resetKey, fallback: () => h('p', null, 'notice') }, h(Screen))
  const renderer = render(tree(1))
  assert.equal(text(renderer), 'notice')
  act(() => renderer.update(tree(1)))
  assert.equal(text(renderer), 'notice', 'the same key keeps the notice')
  broken = false
  act(() => renderer.update(tree(2)))
  assert.equal(text(renderer), 'screen')
})

test('each notice offers only its own ways out, with the raw error on hover', () => {
  const error = new Error(`long ${'x'.repeat(500)}`)
  const page = render(h(CrashNotice, { t, error, onRetry() {}, onHome() {} }))
  assert.deepEqual(labels(page), [zh.retry, zh.backHome])
  assert.equal(text(page), `${zh.crashPage} ${zh.crashPageHint} ${zh.retry} ${zh.backHome}`)
  assert.equal(page.root.findByProps({ className: 'aha-cardTitle' }).props.title.length, 300)
  // The whole-page fallback: retrying would only start from the home page too.
  const whole = render(h(CrashNotice, { t, error, onHome() {} }))
  assert.deepEqual(labels(whole), [zh.backHome])
  assert.equal(text(whole), `${zh.crashPage} ${zh.backHome}`)
  assert.deepEqual(labels(render(h(CrashNotice, { t, error, place: 'tab', onRetry() {} }))), [zh.retry])
  assert.deepEqual(labels(render(h(CrashNotice, { t, error, place: 'card', onRetry() {} }))), [zh.retry])
  for (const node of [page, whole]) assert.equal(node.root.findAllByProps({ role: 'alert' }).length, 1)
})

// The full page's wiring (App.jsx): the screen is keyed by the route, so any
// new route gets a fresh try, and its crash marks the route.
function screenPage(screens, probe) {
  return function Page() {
    const { route, setRoute, crashed } = useRoute()
    probe.setRoute = setRoute
    return h(ErrorBoundary, { resetKey: route, onError: crashed, fallback: () => h('p', null, 'notice') }, h(screens[route.screen], route.params))
  }
}

test('a screen that crashed is forgotten, and screens opened later are remembered', () => {
  const broken = new Set(['lesson'])
  const screens = {
    home: () => h('p', null, 'home'),
    settings: () => h('p', null, 'settings'),
    lesson: () => {
      if (broken.has('lesson')) throw new Error('lesson crashed')
      return h('p', null, 'lesson')
    },
  }
  const stored = () => JSON.parse(window.localStorage.getItem(ROUTE_KEY))
  const probe = {}
  const renderer = render(h(screenPage(screens, probe)))
  assert.equal(text(renderer), 'home')
  act(() => probe.setRoute({ screen: 'settings', params: {} }))
  assert.deepEqual(stored(), { screen: 'settings', params: {} })

  act(() => probe.setRoute({ screen: 'lesson', params: { lessonId: 'l1' } }))
  assert.equal(text(renderer), 'notice')
  assert.equal(stored(), null, 'a reload opens the home page, not the crash')

  act(() => probe.setRoute({ screen: 'settings', params: {} }))
  assert.equal(text(renderer), 'settings')
  assert.deepEqual(stored(), { screen: 'settings', params: {} })

  act(() => probe.setRoute({ screen: 'lesson', params: { lessonId: 'l1' } }))
  assert.equal(stored(), null)
  // Retry: a copy of the same route. The screen works now, so it is remembered.
  broken.delete('lesson')
  act(() => probe.setRoute(current => ({ ...current })))
  assert.equal(text(renderer), 'lesson')
  assert.deepEqual(stored(), { screen: 'lesson', params: { lessonId: 'l1' } })
  act(() => renderer.unmount())
})

test('a remembered screen that crashes when the page opens is forgotten, so the next visit starts at home', () => {
  const screens = {
    home: () => h('p', null, 'home'),
    lesson: () => {
      throw new Error('lesson crashed')
    },
  }
  window.localStorage.setItem(ROUTE_KEY, JSON.stringify({ screen: 'lesson', params: {} }))
  const first = render(h(screenPage(screens, {})))
  assert.equal(text(first), 'notice')
  assert.equal(window.localStorage.getItem(ROUTE_KEY), null)
  act(() => first.unmount())
  const next = render(h(screenPage(screens, {})))
  assert.equal(text(next), 'home')
})

test('a crash outside the screens forgets the route as well', () => {
  window.localStorage.setItem(ROUTE_KEY, JSON.stringify({ screen: 'settings', params: {} }))
  function Navigation() {
    throw new Error('navigation crashed')
  }
  const renderer = render(h(ErrorBoundary, { onError: forgetRoute, fallback: ({ error }) => h(CrashNotice, { t, error, onHome() {} }) }, h(Navigation)))
  assert.deepEqual(labels(renderer), [zh.backHome])
  assert.equal(window.localStorage.getItem(ROUTE_KEY), null)
})
