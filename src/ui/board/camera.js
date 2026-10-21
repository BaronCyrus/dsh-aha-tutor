// The board canvas's camera. Pages are laid out at their natural size in a
// world that zoom 1 shows edge to edge (100 % = the board's width), and the
// camera { x, y, k } places that world in the board: a world point (wx, wy)
// shows at (x + wx·k, y + wy·k). Pure geometry over plain numbers.

// Low enough to show a long lesson, asides included, whole.
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 3
export const ZOOM_STEP = 1.25

export function clampZoom(k) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(k) || 1))
}

// Zoom by factor around a point of the board (px, py), which stays put.
export function zoomAt(camera, px, py, factor) {
  const k = clampZoom(camera.k * factor)
  const ratio = k / camera.k
  return { x: px - (px - camera.x) * ratio, y: py - (py - camera.y) * ratio, k }
}

// The camera that shows a world rectangle whole and centred in the board,
// never above maxZoom.
export function fitRect(view, rect, { margin = 24, maxZoom = MAX_ZOOM } = {}) {
  const k = clampZoom(Math.min(maxZoom, (view.width - margin * 2) / Math.max(1, rect.width), (view.height - margin * 2) / Math.max(1, rect.height)))
  return { k, x: (view.width - rect.width * k) / 2 - rect.x * k, y: (view.height - rect.height * k) / 2 - rect.y * k }
}

// How far to move the world down (positive) or up (negative) so a box seen in
// the board ({ top, height }) sits between `top` and `bottom` of room; 0 when
// it already does. A box taller than the room is shown from its top.
export function followShift(view, box, { top = 24, bottom = 56 } = {}) {
  const roomBottom = view.height - bottom
  if (box.height > roomBottom - top) return top - box.top
  if (box.top + box.height > roomBottom) return roomBottom - (box.top + box.height)
  if (box.top < top) return top - box.top
  return 0
}

// However far the world is dragged, `edge` pixels of it stay in the board.
export function keepInView(camera, view, world, edge = 80) {
  const width = world.width * camera.k
  const height = world.height * camera.k
  return {
    ...camera,
    x: Math.min(view.width - edge, Math.max(edge - width, camera.x)),
    y: Math.min(view.height - edge, Math.max(edge - height, camera.y)),
  }
}

// Wheel deltas in pixels, whatever unit the device reports them in.
export function wheelPixels(event, pageHeight) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1
  return { x: event.deltaX * scale, y: event.deltaY * scale }
}

// A trackpad pinch arrives as small ctrl-wheel steps, a mouse wheel as large
// ones; both zoom smoothly by their size.
export function wheelZoomFactor(deltaY) {
  return Math.exp(-Math.max(-120, Math.min(120, deltaY)) * 0.0045)
}
