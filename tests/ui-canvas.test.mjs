import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanPrefs, PREF_DEFAULTS } from '../src/host/settings.js'
import { clampZoom, fitRect, followShift, keepInView, MAX_ZOOM, MIN_ZOOM, wheelPixels, wheelZoomFactor, zoomAt, ZOOM_STEP } from '../src/ui/board/camera.js'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('zooming keeps the point under the pointer where it is, within 5–300 %', () => {
  const camera = { x: 16, y: 16, k: 1 }
  const worldPoint = { x: (200 - camera.x) / camera.k, y: (100 - camera.y) / camera.k }
  const zoomed = zoomAt(camera, 200, 100, 2)
  assert.equal(zoomed.k, 2)
  close(zoomed.x + worldPoint.x * zoomed.k, 200)
  close(zoomed.y + worldPoint.y * zoomed.k, 100)
  // Back out by the same step returns to the start.
  const back = zoomAt(zoomed, 200, 100, 1 / 2)
  close(back.x, camera.x)
  close(back.y, camera.y)
  assert.equal(zoomAt(camera, 0, 0, 100).k, MAX_ZOOM)
  assert.equal(zoomAt(camera, 0, 0, 0.001).k, MIN_ZOOM)
  assert.equal(clampZoom('nonsense'), 1)
  assert.equal(ZOOM_STEP, 1.25)
})

test('showing everything fits the pages whole and centred, never above 100 %', () => {
  const view = { width: 800, height: 600 }
  const tall = fitRect(view, { x: 0, y: 0, width: 1000, height: 3000 }, { margin: 24, maxZoom: 1 })
  close(tall.k, (600 - 48) / 3000)
  close(tall.y, 24)
  close(tall.x, (800 - 1000 * tall.k) / 2)
  // One short page is shown at 100 % rather than blown up.
  assert.equal(fitRect(view, { x: 0, y: 0, width: 300, height: 200 }, { maxZoom: 1 }).k, 1)
  // A double-clicked page fills the board, centred, even above 100 %.
  const page = fitRect(view, { x: 0, y: 700, width: 400, height: 300 }, { margin: 0 })
  assert.equal(page.k, 2)
  close(page.y + 700 * page.k, 0)
})

test('following moves the world just enough to keep the writing in view', () => {
  const view = { width: 800, height: 600 }
  assert.equal(followShift(view, { top: 100, height: 40 }), 0, 'already in view')
  assert.equal(followShift(view, { top: 560, height: 40 }), 600 - 56 - 600, 'below: the world moves up')
  assert.equal(followShift(view, { top: -50, height: 40 }), 74, 'above: the world moves down')
  assert.equal(followShift(view, { top: 300, height: 900 }), -276, 'taller than the board: shown from its top')
})

test('dragging never loses the pages, and wheels pan by pixels', () => {
  const view = { width: 800, height: 600 }
  const world = { width: 768, height: 4000 }
  assert.deepEqual(keepInView({ x: 5000, y: 5000, k: 1 }, view, world), { x: 720, y: 520, k: 1 })
  assert.deepEqual(keepInView({ x: -5000, y: -9000, k: 0.5 }, view, world), { x: 80 - 384, y: 80 - 2000, k: 0.5 })
  assert.deepEqual(keepInView({ x: 16, y: -300, k: 1 }, view, world), { x: 16, y: -300, k: 1 })

  assert.deepEqual(wheelPixels({ deltaMode: 0, deltaX: 3, deltaY: 40 }, 600), { x: 3, y: 40 })
  assert.deepEqual(wheelPixels({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 600), { x: 0, y: 48 })
  assert.deepEqual(wheelPixels({ deltaMode: 2, deltaX: 0, deltaY: 1 }, 600), { x: 0, y: 600 })
  assert.ok(wheelZoomFactor(-10) > 1, 'a pinch outwards zooms in')
  assert.ok(wheelZoomFactor(10) < 1)
  assert.equal(wheelZoomFactor(10000), wheelZoomFactor(120), 'a large mouse step is capped')
})

test('the board view is a setting that defaults to the canvas', () => {
  assert.equal(PREF_DEFAULTS.boardView, 'canvas')
  assert.equal(cleanPrefs({ boardView: 'pages' }).boardView, 'pages')
  assert.equal(cleanPrefs({ boardView: 'scroll' }).boardView, 'canvas')
})
