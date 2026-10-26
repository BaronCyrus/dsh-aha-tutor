// A PDF page as one grayscale picture, so a model that sees images can read
// a scanned page. Only what scans are made of is drawn: images and image
// masks, placed by the page's transforms (forms and groups included). Text
// and vector paths are left out: a page that has them has a text layer. No
// canvas or native module is needed: pdf.js decodes the pixels, they are
// composited here and written as a PNG.

import { deflateSync } from 'node:zlib'

// About what DSH sends a model at most (2048 × 2048 pixels), and never more
// detail than the scan itself has.
const MAX_PIXELS = 4_000_000
const MAX_EDGE = 2400
// An image pdf.js never finishes decoding is left out.
const OBJECT_WAIT_MS = 20_000

const IDENTITY = [1, 0, 0, 1, 0, 0]

// pdf.js's Util.transform: m applied after n.
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return null
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

// "#rrggbb" (how pdf.js passes fill colors) as a gray level.
function grayOf(color) {
  const hex = /^#([0-9a-f]{6})$/iu.exec(String(color ?? ''))?.[1]
  if (!hex) return 0
  const value = Number.parseInt(hex, 16)
  return Math.round(((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000)
}

// Every image the page paints, with the matrix that maps its unit square to
// the page, in painting order.
export function placements(OPS, operatorList) {
  const draws = []
  let ctm = IDENTITY
  let fill = 0
  const stack = []
  const push = () => stack.push({ ctm, fill })
  const pop = () => {
    const saved = stack.pop()
    if (saved) ({ ctm, fill } = saved)
  }
  const { fnArray, argsArray } = operatorList
  for (let index = 0; index < fnArray.length; index += 1) {
    const args = argsArray[index] ?? []
    switch (fnArray[index]) {
      case OPS.save:
        push()
        break
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
      case OPS.endGroup:
        pop()
        break
      case OPS.transform:
        ctm = multiply(ctm, args)
        break
      case OPS.paintFormXObjectBegin:
        push()
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0])
        break
      case OPS.beginGroup:
        push()
        if (Array.isArray(args[0]?.matrix)) ctm = multiply(ctm, args[0].matrix)
        break
      case OPS.setFillRGBColor:
        fill = grayOf(args[0])
        break
      case OPS.paintImageXObject:
        draws.push({ matrix: ctm, image: args[0] })
        break
      case OPS.paintInlineImageXObject:
        draws.push({ matrix: ctm, image: args[0] })
        break
      case OPS.paintImageXObjectRepeat: {
        const [image, scaleX, scaleY, positions = []] = args
        for (let at = 0; at + 1 < positions.length; at += 2) draws.push({ matrix: multiply(ctm, [scaleX, 0, 0, scaleY, positions[at], positions[at + 1]]), image })
        break
      }
      case OPS.paintInlineImageXObjectGroup: {
        const [image, map = []] = args
        for (const entry of map) draws.push({ matrix: multiply(ctm, entry.transform), image, region: { x: entry.x, y: entry.y, w: entry.w, h: entry.h } })
        break
      }
      case OPS.paintImageMaskXObject:
        draws.push({ matrix: ctm, mask: args[0], fill })
        break
      case OPS.paintImageMaskXObjectGroup:
        for (const mask of args[0] ?? []) draws.push({ matrix: multiply(ctm, mask.transform), mask, fill })
        break
      case OPS.paintImageMaskXObjectRepeat: {
        const [mask, scaleX, skewX = 0, skewY = 0, scaleY, positions = []] = args
        for (let at = 0; at + 1 < positions.length; at += 2) draws.push({ matrix: multiply(ctm, [scaleX, skewX, skewY, scaleY, positions[at], positions[at + 1]]), mask, fill })
        break
      }
      case OPS.paintSolidColorImageMask:
        draws.push({ matrix: ctm, solid: fill })
        break
      default:
        break
    }
  }
  return draws
}

// A decoded image object; images too big to send inline are kept by id.
async function resolve(page, value) {
  if (typeof value !== 'string') return value ?? null
  const objects = value.startsWith('g_') ? page.commonObjs : page.objs
  let timer
  try {
    return await Promise.race([
      new Promise(done => { objects.get(value, done) }),
      new Promise(done => { timer = setTimeout(() => done(null), OBJECT_WAIT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// The decoded pixels as gray (0 black … 255 white) and coverage (255 =
// opaque), averaged over factor × factor blocks. pdf.js gives 1-bit rows
// padded to whole bytes, where 0 is black (or, in a mask, painted).
export function shrink(image, { factor = 1, mask = false, region } = {}) {
  const { width, height, kind, data } = image
  const x0 = region?.x ?? 0
  const y0 = region?.y ?? 0
  const w = Math.max(1, Math.min(region?.w ?? width, width - x0))
  const h = Math.max(1, Math.min(region?.h ?? height, height - y0))
  const outW = Math.max(1, Math.ceil(w / factor))
  const outH = Math.max(1, Math.ceil(h / factor))
  const gray = new Uint8Array(outW * outH)
  const alpha = new Uint8Array(outW * outH)
  let opaque = true
  const bits = mask || kind === 1
  const stride = bits ? (width + 7) >> 3 : width * (kind === 3 ? 4 : 3)
  for (let oy = 0; oy < outH; oy += 1) {
    const yStart = y0 + oy * factor
    const yEnd = Math.min(y0 + h, yStart + factor)
    for (let ox = 0; ox < outW; ox += 1) {
      const xStart = x0 + ox * factor
      const xEnd = Math.min(x0 + w, xStart + factor)
      let level = 0
      let cover = 0
      let count = 0
      for (let y = yStart; y < yEnd; y += 1) {
        const row = y * stride
        for (let x = xStart; x < xEnd; x += 1) {
          count += 1
          if (bits) {
            const set = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1
            if (mask) cover += set ? 0 : 255
            else {
              level += set ? 255 : 0
              cover += 255
            }
          } else {
            const at = row + x * (kind === 3 ? 4 : 3)
            const value = (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1000
            const opacity = kind === 3 ? data[at + 3] : 255
            level += value * opacity
            cover += opacity
          }
        }
      }
      const at = oy * outW + ox
      alpha[at] = count ? Math.round(cover / count) : 0
      if (alpha[at] < 255) opaque = false
      // Gray is kept apart from coverage (premultiplied while summing).
      gray[at] = bits ? (mask ? 0 : Math.round(level / count)) : cover ? Math.round(level / cover) : 255
    }
  }
  return { width: outW, height: outH, gray, alpha, opaque }
}

// Paint one placed picture onto the page bitmap. full maps the unit square
// to page pixels; the picture's top row is at the square's top (y = 1). A
// picture is sampled linearly; a mask paints `fill` where it covers, and no
// picture at all fills the square.
function paint(page, full, picture, { fill = null } = {}) {
  const inverse = invert(full)
  if (!inverse) return
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(full, x, y))
  const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0]))))
  const right = Math.min(page.width, Math.ceil(Math.max(...corners.map(point => point[0]))))
  const top = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1]))))
  const bottom = Math.min(page.height, Math.ceil(Math.max(...corners.map(point => point[1]))))
  const [ia, ib, ic, id, ie, iff] = inverse
  if (picture && Math.abs(ib) < 1e-9 && Math.abs(ic) < 1e-9) {
    paintAligned(page, picture, { left, right, top, bottom, ia, id, ie, iff, fill })
    return
  }
  const { width, height, gray, alpha } = picture ?? { width: 1, height: 1 }
  for (let y = top; y < bottom; y += 1) {
    const py = y + 0.5
    for (let x = left; x < right; x += 1) {
      const px = x + 0.5
      const u = ia * px + ic * py + ie
      const v = ib * px + id * py + iff
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
      const at = y * page.width + x
      if (!picture) {
        page.gray[at] = fill
        continue
      }
      // The four nearest picture pixels around (u, 1 - v), blended.
      const fx = Math.min(width - 1, Math.max(0, u * width - 0.5))
      const fy = Math.min(height - 1, Math.max(0, (1 - v) * height - 0.5))
      const x1 = Math.floor(fx)
      const y1 = Math.floor(fy)
      const x2 = Math.min(width - 1, x1 + 1)
      const y2 = Math.min(height - 1, y1 + 1)
      const tx = fx - x1
      const ty = fy - y1
      const w1 = (1 - tx) * (1 - ty)
      const w2 = tx * (1 - ty)
      const w3 = (1 - tx) * ty
      const w4 = tx * ty
      const p1 = y1 * width + x1
      const p2 = y1 * width + x2
      const p3 = y2 * width + x1
      const p4 = y2 * width + x2
      const cover = alpha[p1] * w1 + alpha[p2] * w2 + alpha[p3] * w3 + alpha[p4] * w4
      if (!cover) continue
      // The gray of the covered pixels only.
      const ink = fill ?? (gray[p1] * alpha[p1] * w1 + gray[p2] * alpha[p2] * w2 + gray[p3] * alpha[p3] * w3 + gray[p4] * alpha[p4] * w4) / cover
      const share = cover / 255
      page.gray[at] = Math.round(page.gray[at] * (1 - share) + ink * share)
    }
  }
}

// Where along one axis each output pixel samples the picture: the two
// neighbouring picture pixels and the weight of the second, or -1 outside.
function axisSamples(from, to, scale, offset, size, flip) {
  const first = new Int32Array(to - from)
  const second = new Int32Array(to - from)
  const weight = new Float32Array(to - from)
  for (let index = 0; index < to - from; index += 1) {
    const unit = scale * (from + index + 0.5) + offset
    if (unit < 0 || unit >= 1) {
      first[index] = -1
      continue
    }
    const position = Math.min(size - 1, Math.max(0, (flip ? 1 - unit : unit) * size - 0.5))
    first[index] = Math.floor(position)
    second[index] = Math.min(size - 1, first[index] + 1)
    weight[index] = position - first[index]
  }
  return { first, second, weight }
}

// paint() for a picture that is neither rotated nor skewed, as scans are:
// every row, and every column, samples the same picture positions.
function paintAligned(page, picture, { left, right, top, bottom, ia, id, ie, iff, fill }) {
  const { width, height, gray, alpha, opaque } = picture
  const columns = axisSamples(left, right, ia, ie, width, false)
  const rows = axisSamples(top, bottom, id, iff, height, true)
  for (let y = top; y < bottom; y += 1) {
    const row = y - top
    if (rows.first[row] < 0) continue
    const r1 = rows.first[row] * width
    const r2 = rows.second[row] * width
    const ty = rows.weight[row]
    const out = y * page.width
    for (let x = left; x < right; x += 1) {
      const column = x - left
      const c1 = columns.first[column]
      if (c1 < 0) continue
      const c2 = columns.second[column]
      const tx = columns.weight[column]
      const p1 = r1 + c1
      const p2 = r1 + c2
      const p3 = r2 + c1
      const p4 = r2 + c2
      if (opaque && fill === null) {
        const above = gray[p1] + (gray[p2] - gray[p1]) * tx
        const below = gray[p3] + (gray[p4] - gray[p3]) * tx
        page.gray[out + x] = Math.round(above + (below - above) * ty)
        continue
      }
      const w1 = (1 - tx) * (1 - ty)
      const w2 = tx * (1 - ty)
      const w3 = (1 - tx) * ty
      const w4 = tx * ty
      const cover = alpha[p1] * w1 + alpha[p2] * w2 + alpha[p3] * w3 + alpha[p4] * w4
      if (!cover) continue
      const ink = fill ?? (gray[p1] * alpha[p1] * w1 + gray[p2] * alpha[p2] * w2 + gray[p3] * alpha[p3] * w3 + gray[p4] * alpha[p4] * w4) / cover
      const share = cover / 255
      page.gray[out + x] = Math.round(page.gray[out + x] * (1 - share) + ink * share)
    }
  }
}

// How far a matrix stretches the unit square, in page pixels per side.
function extent(full) {
  const [x0, y0] = apply(full, 0, 0)
  const [x1, y1] = apply(full, 1, 0)
  const [x2, y2] = apply(full, 0, 1)
  return { across: Math.hypot(x1 - x0, y1 - y0), down: Math.hypot(x2 - x0, y2 - y0) }
}

// The page as { mime, data } (a grayscale PNG), or null when it paints no
// image at all.
export async function pageImage(pdfjs, page) {
  const operatorList = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode?.DISABLE })
  const draws = placements(pdfjs.OPS, operatorList)
  if (!draws.length) return null
  const base = page.getViewport({ scale: 1 })
  const pictures = await Promise.all(draws.map(draw => (draw.solid !== undefined ? null : resolve(page, draw.image ?? (typeof draw.mask?.data === 'string' ? draw.mask.data : draw.mask)))))
  // As much detail as the sharpest picture holds, within the limits.
  let density = 1
  for (const [index, draw] of draws.entries()) {
    const decoded = pictures[index]
    if (!decoded?.width) continue
    const size = extent(multiply(base.transform, draw.matrix))
    if (size.across * size.down < base.width * base.height * 0.05) continue
    density = Math.max(density, Math.min((draw.region?.w ?? decoded.width) / Math.max(1, size.across), (draw.region?.h ?? decoded.height) / Math.max(1, size.down)))
  }
  const scale = Math.min(density, Math.sqrt(MAX_PIXELS / (base.width * base.height)), MAX_EDGE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const bitmap = { width: Math.max(1, Math.ceil(viewport.width)), height: Math.max(1, Math.ceil(viewport.height)) }
  bitmap.gray = new Uint8Array(bitmap.width * bitmap.height).fill(255)
  let painted = false
  for (const [index, draw] of draws.entries()) {
    const full = multiply(viewport.transform, draw.matrix)
    if (draw.solid !== undefined) {
      paint(bitmap, full, null, { fill: draw.solid })
      painted = true
      continue
    }
    const decoded = pictures[index]
    const mask = Boolean(draw.mask)
    const image = mask ? { ...draw.mask, ...(decoded ?? {}), kind: 1 } : decoded
    if (!image?.data || !image.width || !image.height) continue
    if (!mask && ![1, 2, 3].includes(image.kind)) continue
    const size = extent(full)
    const factor = Math.max(1, Math.floor(Math.min((draw.region?.w ?? image.width) / Math.max(1, size.across), (draw.region?.h ?? image.height) / Math.max(1, size.down))))
    paint(bitmap, full, shrink(image, { factor, mask, region: draw.region }), { fill: mask ? draw.fill : null })
    painted = true
  }
  if (!painted) return null
  return { mime: 'image/png', data: encodeGrayPng(bitmap.width, bitmap.height, bitmap.gray), width: bitmap.width, height: bitmap.height }
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
}

// An 8-bit grayscale PNG; each row is filtered by the row above, which suits
// pages of text.
export function encodeGrayPng(width, height, gray) {
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const out = y * (width + 1)
    raw[out] = 2
    for (let x = 0; x < width; x += 1) raw[out + 1 + x] = (gray[y * width + x] - (y ? gray[(y - 1) * width + x] : 0)) & 255
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
