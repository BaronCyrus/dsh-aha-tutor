// A small PDF writer for tests: pages of text at given places and sizes, in
// Helvetica or a standard Chinese font (not embedded; readers use their
// own), with bookmarks, page labels and a title. The file is plain ASCII, so
// byte offsets are string lengths.

const ascii = value => /^[\x20-\x7e]*$/u.test(value)
const literal = value => `(${value.replace(/[\\()]/gu, match => `\\${match}`)})`
// Text in the Chinese font is UCS-2, big-endian (UniGB-UCS2-H).
const ucs2 = value => `<${[...value].map(char => char.codePointAt(0).toString(16).padStart(4, '0')).join('')}>`
// Bookmark titles and the document title: PDFDocEncoding or UTF-16BE.
const pdfText = value => (ascii(value) ? literal(value) : `<feff${[...value].map(char => char.codePointAt(0).toString(16).padStart(4, '0')).join('')}>`)

// pages: [{ lines: [{ text, x = 72, y, size = 12 }] }] with y from the bottom
// of an A4 page (842 high); outline: [{ title, page (1-based), children }];
// labels: [[pageIndex, { style: 'D' | 'r' | 'R' | 'a' | 'A', start, prefix }]].
export function buildPdf({ pages, outline = [], labels = [], title = '' }) {
  const objects = []
  const add = body => {
    objects.push(body)
    return objects.length
  }
  const reserve = () => add(null)
  const catalog = reserve()
  const pagesRoot = reserve()
  const latin = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const descriptor = add('<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>')
  const cid = add(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor ${descriptor} 0 R /DW 1000 >>`)
  const chinese = add(`<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cid} 0 R] >>`)
  const pageIds = pages.map(page => {
    const content = (page.lines ?? []).map(line => {
      const [font, shown] = ascii(line.text) ? ['F1', literal(line.text)] : ['F2', ucs2(line.text)]
      return `BT /${font} ${line.size ?? 12} Tf ${line.x ?? 72} ${line.y} Td ${shown} Tj ET`
    }).join('\n')
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    return add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${latin} 0 R /F2 ${chinese} 0 R >> >> /Contents ${stream} 0 R >>`)
  })
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  // Bookmarks: each level a linked list under its parent.
  let outlineRoot = null
  if (outline.length) {
    outlineRoot = reserve()
    const count = items => items.reduce((sum, item) => sum + 1 + count(item.children ?? []), 0)
    const write = (items, parent) => {
      const ids = items.map(() => reserve())
      items.forEach((item, index) => {
        const children = item.children?.length ? write(item.children, ids[index]) : null
        const links = [
          `/Parent ${parent} 0 R`,
          index > 0 ? `/Prev ${ids[index - 1]} 0 R` : '',
          index < ids.length - 1 ? `/Next ${ids[index + 1]} 0 R` : '',
          children ? `/First ${children[0]} 0 R /Last ${children.at(-1)} 0 R /Count ${count(item.children)}` : '',
        ].filter(Boolean).join(' ')
        objects[ids[index] - 1] = `<< /Title ${pdfText(item.title)} ${links} /Dest [${pageIds[item.page - 1]} 0 R /XYZ null null null] >>`
      })
      return ids
    }
    const top = write(outline, outlineRoot)
    objects[outlineRoot - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top.at(-1)} 0 R /Count ${count(outline)} >>`
  }
  const nums = labels.map(([index, label]) => `${index} << ${label.style ? `/S /${label.style}` : ''}${label.start ? ` /St ${label.start}` : ''}${label.prefix ? ` /P ${pdfText(label.prefix)}` : ''} >>`).join(' ')
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlineRoot ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''}${nums ? ` /PageLabels << /Nums [${nums}] >>` : ''} >>`
  const info = title ? add(`<< /Title ${pdfText(title)} >>`) : null

  let body = '%PDF-1.7\n'
  const offsets = objects.map((object, index) => {
    const at = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return at
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
