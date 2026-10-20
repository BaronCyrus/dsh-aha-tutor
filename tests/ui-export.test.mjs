import assert from 'node:assert/strict'
import { test } from 'node:test'

import { downloadName } from '../src/ui/api.js'
import { cornerRadius, gradientBands, visibleColor } from '../src/ui/capture.js'
import { buildPdf, pdfText } from '../src/ui/pdf.js'
import { buildZip, crc32 } from '../src/ui/zip.js'

const latin1 = bytes => Buffer.from(bytes).toString('latin1')

test('a board PDF has one picture page per board page, exact offsets and a Unicode title', () => {
  const pages = [
    { width: 1200, height: 675, image: { width: 2, height: 1, filter: 'FlateDecode', data: new Uint8Array([120, 156, 1, 2, 3, 4]) } },
    { width: 1200, height: 900, image: { width: 1, height: 1, filter: 'DCTDecode', data: new Uint8Array([0xff, 0xd8, 0x0a, 0xff, 0xd9]) } },
  ]
  const text = latin1(buildPdf(pages, { title: '勾股定理 · 板书', creator: '开窍', date: new Date(Date.UTC(2026, 9, 20, 8, 0, 0)) }))
  assert.ok(text.startsWith('%PDF-1.4\n%'))
  assert.ok(text.endsWith('%%EOF\n'))

  // The cross-reference table points at every object.
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/u.exec(text)[1])
  assert.equal(text.slice(startxref, startxref + 5), 'xref\n')
  const lines = text.slice(startxref).split('\n')
  assert.equal(lines[1], '0 10')
  assert.equal(lines[2], '0000000000 65535 f ')
  for (let id = 1; id < 10; id += 1) {
    const line = lines[2 + id]
    assert.match(line, /^\d{10} 00000 n $/u)
    const offset = Number(line.slice(0, 10))
    assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`)
  }
  assert.match(text, /\/Size 10 \/Root 1 0 R \/Info 3 0 R/u)

  // Two pages, sized 0.75 pt per CSS pixel, each drawing its own picture.
  assert.match(text, /\/Count 2 >>/u)
  assert.match(text, /\/MediaBox \[0 0 900 506\.25\]/u)
  assert.match(text, /\/MediaBox \[0 0 900 675\]/u)
  assert.match(text, /q 900 0 0 506\.25 0 0 cm \/P0 Do Q/u)
  assert.match(text, /\/Width 2 \/Height 1 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length 6/u)
  assert.match(text, /\/Filter \/DCTDecode \/Length 5/u)
  // Every stream is exactly as long as it says.
  for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/gu)) {
    const start = match.index + match[0].length
    assert.equal(text.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream')
  }

  assert.equal(pdfText('勾'), '<FEFF52FE>')
  assert.equal(pdfText('𝑥'), '<FEFFD835DC65>')
  assert.ok(text.includes(`/Title ${pdfText('勾股定理 · 板书')}`))
  assert.ok(text.includes('/CreationDate (D:20261020080000Z)'))
})

test('a PNG bundle is a stored ZIP with UTF-8 names and correct checksums', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  assert.equal(crc32(new Uint8Array()), 0)
  const name = '勾股定理-01.png'
  const nameBytes = new TextEncoder().encode(name)
  const zip = buildZip([{ name, data: new Uint8Array([1, 2, 3]) }, { name: 'b.png', data: new Uint8Array([9]) }], new Date(2026, 9, 20, 9, 30, 10))
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)

  assert.equal(view.getUint32(0, true), 0x04034b50)
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800, 'names are flagged as UTF-8')
  assert.equal(view.getUint16(8, true), 0, 'stored, not deflated')
  assert.equal(view.getUint16(10, true), (9 << 11) | (30 << 5) | 5)
  assert.equal(view.getUint16(12, true), ((2026 - 1980) << 9) | (10 << 5) | 20)
  assert.equal(view.getUint32(14, true), crc32(new Uint8Array([1, 2, 3])))
  assert.equal(view.getUint32(18, true), 3)
  assert.equal(view.getUint16(26, true), nameBytes.length)
  assert.equal(new TextDecoder().decode(zip.subarray(30, 30 + nameBytes.length)), name)
  assert.deepEqual([...zip.subarray(30 + nameBytes.length, 33 + nameBytes.length)], [1, 2, 3])

  const end = zip.length - 22
  assert.equal(view.getUint32(end, true), 0x06054b50)
  assert.equal(view.getUint16(end + 8, true), 2)
  assert.equal(view.getUint16(end + 10, true), 2)
  const directory = view.getUint32(end + 16, true)
  assert.equal(directory, 30 + nameBytes.length + 3 + 30 + 5 + 1)
  assert.equal(view.getUint32(end + 12, true), end - directory)
  assert.equal(view.getUint32(directory, true), 0x02014b50)
  assert.equal(view.getUint32(directory + 42, true), 0)
  const second = directory + 46 + nameBytes.length
  assert.equal(view.getUint32(second, true), 0x02014b50)
  assert.equal(view.getUint32(second + 42, true), 30 + nameBytes.length + 3, 'the second entry points at its own local header')
  assert.equal(view.getUint32(second + 16, true), crc32(new Uint8Array([9])))
})

test('export names and the page reader\'s CSS helpers', () => {
  assert.equal(downloadName('第 1 课：a/b\\c*d?'), '第 1 课：a b c d', 'only characters a file name cannot hold are replaced')
  assert.equal(downloadName('  \n '), 'aha')
  assert.equal(downloadName('x'.repeat(80)).length, 60)

  // The heading highlighter is a band between two stops of one colour.
  const marker = 'rgba(255, 214, 79, 0.62)'
  assert.deepEqual(gradientBands(`linear-gradient(rgba(0, 0, 0, 0) 60%, ${marker} 60%, ${marker} 92%, rgba(0, 0, 0, 0) 92%)`), [{ color: marker, from: 0.6, to: 0.92 }])
  assert.deepEqual(gradientBands(`linear-gradient(90deg, ${marker} 0%, ${marker} 50%)`), [], 'sideways gradients are not bands')
  assert.deepEqual(gradientBands('radial-gradient(rgba(40, 50, 80, 0.05) 1px, rgba(0, 0, 0, 0) 1.2px)'), [])
  assert.deepEqual(gradientBands('none'), [])

  assert.equal(visibleColor('rgba(0, 0, 0, 0)'), false)
  assert.equal(visibleColor('transparent'), false)
  assert.equal(visibleColor('color(srgb 1 0.8 0.3 / 0)'), false)
  assert.equal(visibleColor('rgb(35, 38, 47)'), true)
  assert.equal(visibleColor('rgba(255, 214, 79, 0.62)'), true)

  assert.deepEqual(cornerRadius('40% 30%', 200, 100), { x: 80, y: 30 })
  assert.deepEqual(cornerRadius('12px', 200, 100), { x: 12, y: 12 })
  assert.deepEqual(cornerRadius('0px', 200, 100), { x: 0, y: 0 })
})
