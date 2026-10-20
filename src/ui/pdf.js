// A PDF made of full-page pictures, one per board page: enough for board
// exports without a PDF library. Page sizes come from CSS pixels at 0.75 pt
// each, so a 1200 × 675 board page is a 900 × 506.25 pt slide.

const PT_PER_PX = 0.75

// Text outside ASCII (a Chinese title) as a UTF-16BE hex string.
export function pdfText(value) {
  let hex = 'FEFF'
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0)
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code]
    for (const unit of units) hex += unit.toString(16).toUpperCase().padStart(4, '0')
  }
  return `<${hex}>`
}

function pdfDate(date) {
  const pad = value => String(value).padStart(2, '0')
  return `(D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z)`
}

const points = value => String(Math.round(value * PT_PER_PX * 100) / 100)

// pages: [{ width, height (CSS px), image: { width, height (pixels), filter:
// 'FlateDecode' (zlib RGB) | 'DCTDecode' (JPEG), data: Uint8Array } }]
export function buildPdf(pages, { title = '', creator = '', date = new Date() } = {}) {
  const encoder = new TextEncoder()
  const chunks = []
  const offsets = []
  let length = 0
  const push = part => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id, ...parts) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    for (const part of parts) push(part)
    push('\nendobj\n')
  }
  // The binary comment tells tools the file holds binary streams.
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  const pageId = index => 4 + index * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  object(3, `<< /Title ${pdfText(title)} /Creator ${pdfText(creator)} /Producer ${pdfText(creator)} /CreationDate ${pdfDate(date)} >>`)
  pages.forEach((page, index) => {
    const id = pageId(index)
    const width = points(page.width)
    const height = points(page.height)
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /P${index} ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`)
    const content = `q ${width} 0 0 ${height} 0 0 cm /P${index} Do Q`
    object(id + 1, `<< /Length ${content.length} >>\nstream\n`, content, '\nendstream')
    const { image } = page
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`, image.data, '\nendstream')
  })

  const size = 4 + pages.length * 3
  const xref = length
  push(`xref\n0 ${size}\n0000000000 65535 f \n`)
  for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// A canvas as a PDF image: lossless zlib-compressed RGB where the browser
// can compress, JPEG elsewhere.
export async function canvasToPdfImage(canvas) {
  const { width, height } = canvas
  if (typeof CompressionStream === 'function') {
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
    const rgb = new Uint8Array(width * height * 3)
    for (let source = 0, target = 0; source < data.length; source += 4, target += 3) {
      rgb[target] = data[source]
      rgb[target + 1] = data[source + 1]
      rgb[target + 2] = data[source + 2]
    }
    return { width, height, filter: 'FlateDecode', data: await deflate(rgb) }
  }
  const blob = await new Promise(resolve => { canvas.toBlob(resolve, 'image/jpeg', 0.92) })
  if (!blob) throw new Error('image encoding failed')
  return { width, height, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) }
}
