import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { deflateSync, inflateSync } from 'node:zlib'

import JSZip from 'jszip'

import { TutorError } from '../src/host/generate.js'
import { createLlmPort } from '../src/host/llm.js'
import { ingestFile, MAX_RECOGNIZED } from '../src/host/materials.js'
import { encodeGrayPng, pageImage } from '../src/host/page-image.js'
import { cleanTranscript, createRecognizer } from '../src/host/recognize.js'
import { RECOGNIZE_EMPTY } from '../src/host/prompts.js'

// ── documents built by hand ─────────────────────────────────────────────────

// Pages of 200 × 100 pt. A page has text (Helvetica) and/or pictures: 8-bit
// gray images, or 1-bit masks painted black, each placed by a cm matrix.
// The same picture object is stored once, however many pages show it.
function makePdf(pages) {
  const bodies = [null, null]
  const add = body => bodies.push(body)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const stored = new Map()
  const kids = []
  for (const page of pages) {
    const names = []
    let content = page.text ? `BT /F1 5 Tf 4 50 Td (${page.text}) Tj ET` : ''
    for (const [index, picture] of (page.pictures ?? []).entries()) {
      if (!stored.has(picture)) {
        const data = deflateSync(Buffer.from(picture.pixels))
        const kind = picture.mask ? '/ImageMask true /BitsPerComponent 1' : '/ColorSpace /DeviceGray /BitsPerComponent 8'
        stored.set(picture, add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} ${kind} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')])))
      }
      names.push(`/Im${index} ${stored.get(picture)} 0 R`)
      content += ` q ${picture.mask ? '0 g ' : ''}${picture.at.join(' ')} cm /Im${index} Do Q`
    }
    const stream = Buffer.from(content)
    const contents = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]))
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${names.join(' ')} >> >> /Contents ${contents} 0 R >>`))
  }
  bodies[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  bodies[1] = `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const parts = [Buffer.from('%PDF-1.4\n')]
  const offsets = []
  let length = parts[0].length
  for (const [index, body] of bodies.entries()) {
    offsets.push(length)
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body), Buffer.from('\nendobj\n')])
    parts.push(part)
    length += part.length
  }
  parts.push(Buffer.from(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}

const WHOLE_PAGE = [200, 0, 0, 100, 0, 0]
// A gray picture whose rows take their level from row(y).
const picture = (width, height, row, at = WHOLE_PAGE) => ({ width, height, at, pixels: Uint8Array.from({ length: width * height }, (_, index) => row(Math.floor(index / width))) })
// Top half black, bottom half white: shows which way up the page came out.
const scan = picture(400, 200, y => (y < 100 ? 0 : 255))
const TEXT = 'The derivative measures how fast a quantity changes at an instant.'

// A PNG of noise, too big to pass for an icon.
let seed = 7
const photo = encodeGrayPng(64, 64, Uint8Array.from({ length: 64 * 64 }, () => ((seed = (seed * 1103515245 + 12345) % 2147483648) >> 16) & 255))

function readPng(png) {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const data = []
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at)
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') data.push(png.subarray(at + 8, at + 8 + size))
    at += 12 + size
  }
  const raw = inflateSync(Buffer.concat(data))
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (width + 1)]
    for (let x = 0; x < width; x += 1) {
      const value = raw[y * (width + 1) + 1 + x]
      gray[y * width + x] = filter === 2 ? (value + (y ? gray[(y - 1) * width + x] : 0)) & 255 : value
    }
  }
  return { width, height, at: (x, y) => gray[Math.floor(y) * width + Math.floor(x)] }
}

// drawn: which pictures the document shows, in order (one may show twice).
async function makeDocx(paragraphs, pictures = [], drawn = pictures.map((_, index) => index)) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const text = paragraphs.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')
  const shown = drawn.map(index => `<w:p><w:r><w:drawing><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdP${index}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${text}${shown}<w:p><w:hyperlink r:id="rIdL"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pictures.map((_, index) => `<Relationship Id="rIdP${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index + 1}.png"/>`).join('')}<Relationship Id="rIdL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`)
  pictures.forEach((data, index) => zip.file(`word/media/image${index + 1}.png`, data))
  return zip.generateAsync({ type: 'nodebuffer' })
}

// slides: [{ lines, picture }]; a picture is shown through the slide's rels.
async function makePptx(slides) {
  const zip = new JSZip()
  slides.forEach((slide, index) => {
    const number = index + 1
    const text = (slide.lines ?? []).map(line => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')
    const pic = slide.picture ? '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>' : ''
    zip.file(`ppt/slides/slide${number}.xml`, `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody>${text}</p:txBody></p:sp>${pic}</p:spTree></p:cSld></p:sld>`)
    if (slide.picture) {
      zip.file(`ppt/slides/_rels/slide${number}.xml.rels`, `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${number}.png"/></Relationships>`)
      zip.file(`ppt/media/image${number}.png`, slide.picture)
    }
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ── a model that reads pictures ─────────────────────────────────────────────

// fail(n) may return an error for the nth call.
function fakeModel({ vision = true, fail = () => null, answer = n => `识别的文字 ${n}` } = {}) {
  const calls = []
  return {
    calls,
    async refreshCapabilities() {},
    supportsImages: purpose => vision && purpose === 'teach',
    async complete(options) {
      calls.push(options)
      const error = fail(calls.length)
      if (error) throw error
      return answer(calls.length)
    },
  }
}

const reader = (llm, progress = []) => createRecognizer({ llm, onProgress: (done, total) => progress.push(`${done}/${total}`) })

// ── tests ───────────────────────────────────────────────────────────────────

test('a scanned page becomes one upright grayscale picture: images, strips and masks', async () => {
  const require = createRequire(import.meta.url)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const mask = { width: 16, height: 8, mask: true, at: WHOLE_PAGE, pixels: Uint8Array.from({ length: 16 }, (_, index) => (index % 2 ? 0xff : 0x00)) }
  const pdf = makePdf([
    { pictures: [scan] },
    { pictures: [picture(40, 10, () => 0, [200, 0, 0, 50, 0, 50]), picture(40, 10, () => 128, [200, 0, 0, 50, 0, 0])] },
    { pictures: [mask] },
    { text: TEXT },
  ])
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: `${join(root, 'standard_fonts')}/`, wasmUrl: `${join(root, 'wasm')}/`, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  try {
    const doc = await task.promise
    const shot = async number => {
      const image = await pageImage(pdfjs, await doc.getPage(number))
      return image && { ...image, ...readPng(image.data) }
    }
    const whole = await shot(1)
    assert.equal(whole.mime, 'image/png')
    assert.deepEqual([whole.width, whole.height], [400, 200], 'as sharp as the scan, no sharper')
    assert.ok(whole.at(200, 40) < 30 && whole.at(200, 160) > 225, 'the top of the scan is the top of the page')
    const strips = await shot(2)
    assert.ok(strips.at(100, 20) < 30, 'upper strip')
    assert.ok(Math.abs(strips.at(100, 80) - 128) < 8, 'lower strip')
    const masked = await shot(3)
    assert.ok(masked.at(50, 50) < 30 && masked.at(150, 50) > 225, 'a mask paints where its bits are clear')
    assert.equal(await shot(4), null, 'a page of text has no picture to read')
  } finally {
    await task.destroy()
  }
})

test('pages without text are read by the learner\'s model; the others keep their own text', async () => {
  const llm = fakeModel()
  const progress = []
  const result = await ingestFile({ name: 'unit.pdf', bytes: makePdf([{ text: TEXT }, { pictures: [scan] }]), recognize: reader(llm, progress) })
  assert.equal(llm.calls.length, 1)
  const call = llm.calls[0]
  assert.equal(call.purpose, 'teach', 'the route that sees images')
  assert.equal(call.requireImages, true)
  assert.equal(call.images[0].mime, 'image/png')
  assert.deepEqual([...Buffer.from(call.images[0].base64, 'base64').subarray(1, 4)], [0x50, 0x4e, 0x47])
  assert.deepEqual(result.chunks.map(chunk => [chunk.page, chunk.text]), [[1, TEXT], [2, '识别的文字 1']])
  assert.deepEqual(result.ocr, { read: 1, failed: [], reason: null, left: 0 })
  assert.deepEqual(progress, ['0/1', '1/1'])

  // A text PDF costs no model call at all.
  const plain = fakeModel()
  const text = await ingestFile({ name: 'notes.pdf', bytes: makePdf([{ text: TEXT }]), recognize: reader(plain) })
  assert.equal(plain.calls.length, 0)
  assert.equal(text.ocr, null)
})

test('a scan needs a model that sees images, and the model\'s own failures are kept apart', async () => {
  const twoPages = makePdf([{ pictures: [scan] }, { pictures: [scan] }])
  await assert.rejects(ingestFile({ name: 'scan.pdf', bytes: twoPages, recognize: reader(fakeModel({ vision: false })) }), { code: 'scan-needs-vision' })
  await assert.rejects(ingestFile({ name: 'scan.pdf', bytes: twoPages }), { code: 'scan-needs-vision' })

  // Out of quota: every page would fail, so reading stops and says why.
  const broke = fakeModel({ fail: () => new TutorError('llm-quota', 'quota') })
  await assert.rejects(ingestFile({ name: 'scan.pdf', bytes: makePdf(Array.from({ length: 6 }, () => ({ pictures: [scan] }))), recognize: reader(broke) }), { code: 'llm-quota' })
  assert.ok(broke.calls.length <= 3, `stopped after the pages already asked (${broke.calls.length})`)

  // One page that fails is named with the material; the rest is kept.
  const flaky = fakeModel({ fail: n => (n === 2 ? new TutorError('llm-failed', 'oops') : null), answer: n => `第 ${n} 次` })
  const result = await ingestFile({ name: 'scan.pdf', bytes: makePdf([{ pictures: [scan] }, { pictures: [scan] }, { pictures: [scan] }]), recognize: createRecognizer({ llm: flaky, atOnce: 1 }) })
  assert.deepEqual(result.chunks.map(chunk => chunk.page), [1, 3])
  assert.deepEqual(result.ocr, { read: 2, failed: [{ page: 2 }], reason: 'llm-failed', left: 0 })

  // Without vision, the text pages of a partly scanned PDF are kept and the rest counted.
  const partly = await ingestFile({ name: 'mixed.pdf', bytes: makePdf([{ text: TEXT }, { pictures: [scan] }]), recognize: reader(fakeModel({ vision: false })) })
  assert.deepEqual(partly.chunks.map(chunk => chunk.page), [1])
  assert.deepEqual(partly.ocr, { unread: 1 })
})

test(`at most ${MAX_RECOGNIZED} pages of a file are read, and the rest are counted`, async () => {
  const llm = fakeModel()
  const result = await ingestFile({ name: 'long.pdf', bytes: makePdf(Array.from({ length: MAX_RECOGNIZED + 2 }, () => ({ pictures: [scan] }))), recognize: reader(llm) })
  assert.equal(llm.calls.length, MAX_RECOGNIZED)
  assert.equal(result.ocr.left, 2)
  assert.equal(result.chunks.at(-1).page, MAX_RECOGNIZED)
})

test('Word documents and slides made of pictures are read; a written document keeps its diagrams to itself', async () => {
  const llm = fakeModel()
  const scanned = await ingestFile({ name: '一单元.docx', bytes: await makeDocx(['第一单元'], [photo], [0, 0]), recognize: reader(llm) })
  assert.equal(llm.calls.length, 1, 'a picture shown twice is read once; a link is not a picture')
  assert.deepEqual(scanned.chunks.map(chunk => [chunk.section, chunk.text]), [['§1', '第一单元\n\nlink'], ['§2', '识别的文字 1']])
  assert.deepEqual(scanned.ocr, { read: 1, failed: [], reason: null, left: 0 })

  const written = fakeModel()
  const essay = await ingestFile({ name: 'essay.docx', bytes: await makeDocx([TEXT.repeat(4)], [photo]), recognize: reader(written) })
  assert.equal(written.calls.length, 0)
  assert.equal(essay.ocr, null)

  await assert.rejects(ingestFile({ name: 'pictures.docx', bytes: await makeDocx([], [photo]), recognize: reader(fakeModel({ vision: false })) }), { code: 'pictures-need-vision' })
  await assert.rejects(ingestFile({ name: 'pictures.pptx', bytes: await makePptx([{ lines: ['第一页'], picture: photo }]), recognize: reader(fakeModel({ vision: false })) }), { code: 'pictures-need-vision' })

  const slides = fakeModel()
  const deck = await ingestFile({ name: 'deck.pptx', bytes: await makePptx([{ lines: [TEXT], picture: photo }, { lines: ['例题'], picture: photo }]), recognize: reader(slides) })
  assert.equal(slides.calls.length, 1, 'only the slide that is a picture')
  assert.deepEqual(deck.chunks.map(chunk => [chunk.slide, chunk.text]), [[1, TEXT], [2, '例题\n\n识别的文字 1']])
})

test('a photo gets its text read and stays a picture for models that see images', async () => {
  const read = await ingestFile({ name: 'page.png', bytes: photo, recognize: reader(fakeModel()) })
  assert.equal(read.kind, 'image')
  assert.equal(read.mime, 'image/png')
  assert.deepEqual(read.chunks.map(chunk => chunk.text), ['识别的文字 1'])
  assert.equal(read.ocr.read, 1)

  const unseen = await ingestFile({ name: 'page.png', bytes: photo, recognize: reader(fakeModel({ vision: false })) })
  assert.deepEqual([unseen.chunks, unseen.ocr], [[], undefined])

  // A failure leaves the photo as it was, with the reason.
  const failed = await ingestFile({ name: 'page.png', bytes: photo, recognize: reader(fakeModel({ fail: () => new TutorError('llm-quota', 'quota') })) })
  assert.deepEqual(failed.chunks, [])
  assert.deepEqual(failed.ocr, { read: 0, failed: [{ picture: 1 }], reason: 'llm-quota', left: 0 })
})

test('a picture is never sent to a model that would drop it', async () => {
  const answer = [{ type: 'text-delta', text: '文字' }, { type: 'finish', reason: { kind: 'stop' } }]
  const sent = []
  const dsh = modalities => ({
    async resolveModelInfo() { return { inputModalities: modalities } },
    async prepareCall(target) {
      return { config: target, inputModalities: modalities, async *stream(request) { sent.push(request.messages[0].content); yield* answer } }
    },
  })
  const port = (modalities, attachments = null) => createLlmPort({ getLlm: () => dsh(modalities), getDefault: () => ({ provider: 'deepseek', model: 'flash' }), getAttachments: () => attachments, prefs: { read: () => ({}) } })
  const request = { purpose: 'quick', system: 's', user: 'u', maxTokens: 100, images: [{ mime: 'image/png', base64: photo.toString('base64') }] }
  await assert.rejects(port(['text']).complete({ ...request, requireImages: true }), { code: 'llm-no-vision' })
  assert.equal(await port(['text']).complete(request), '文字', 'other calls go on without the picture')
  await assert.rejects(port(['text', 'image'], { saveImage: async () => { throw new Error('too big') } }).complete({ ...request, requireImages: true }), { code: 'image-unusable' })
  sent.length = 0
  assert.equal(await port(['text', 'image'], { saveImage: async () => ({ id: 'att_1' }) }).complete({ ...request, requireImages: true }), '文字')
  assert.deepEqual(sent[0].map(block => block.type), ['text', 'image'])
})

test('a transcript loses its fences and the no-text marker', () => {
  assert.equal(cleanTranscript('```markdown\n# 第一单元\n解方程\n```'), '# 第一单元\n解方程')
  assert.equal(cleanTranscript(` ${RECOGNIZE_EMPTY} `), '')
  assert.equal(cleanTranscript('$x^2$'), '$x^2$')
})
