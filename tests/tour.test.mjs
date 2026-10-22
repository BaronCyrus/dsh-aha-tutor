import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLASSROOM_TOUR, tourHole, tourPlacement } from '../src/ui/tour.js'

test('the tour points at every part of the classroom it explains', () => {
  assert.deepEqual(CLASSROOM_TOUR.map(step => step.target), ['.aha-stage', '.aha-controls', '[data-tour=raise]', '[data-tour=reexplain]', '[data-tour=challenge]', '.aha-panel'])
})

test('the card sits below what it explains, else above, else inside it, always in the room', () => {
  const room = { width: 1000, height: 800 }
  const card = { width: 320, height: 150 }
  assert.deepEqual(tourPlacement({ x: 100, y: 100, width: 200, height: 40 }, card, room), { x: 100, y: 152, side: 'below' })
  assert.deepEqual(tourPlacement({ x: 100, y: 700, width: 200, height: 40 }, card, room), { x: 100, y: 538, side: 'above' })
  // Near the right edge the card moves left to stay inside.
  assert.equal(tourPlacement({ x: 900, y: 100, width: 60, height: 40 }, card, room).x, 1000 - 320 - 8)
  // The board fills the room: the card goes inside it, bottom right.
  const inside = tourPlacement({ x: 0, y: 0, width: 1000, height: 800 }, card, room)
  assert.equal(inside.side, 'inside')
  assert.ok(inside.x + card.width <= room.width - 8 && inside.y + card.height <= room.height - 8)
  // The lit box is a little larger than the part, but stays in the room.
  assert.deepEqual(tourHole({ x: 2, y: 50, width: 100, height: 20 }, room), { x: 0, y: 44, width: 108, height: 32 })
  assert.deepEqual(tourHole({ x: 0, y: 0, width: 1000, height: 800 }, room), { x: 0, y: 0, width: 1000, height: 800 })
})
