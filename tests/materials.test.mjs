import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { posix, win32 } from 'node:path'
import { test } from 'node:test'

import JSZip from 'jszip'

import { documentParts, formatPassages, passageRange, search, buildIndex, selectPassages, spreadPassages, tokenize } from '../src/core/retrieval.js'
import { checkPublicUrl, chunkText, decodeText, detectKind, ingestFile, ingestUrl, MaterialError, pdfjsAssetUrls } from '../src/host/materials.js'
import { createGuardedFetch, createGuardedLookup, isPublicAddress } from '../src/host/web-fetch.js'

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url))

async function makeDocx(paragraphs) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makePptx(slides) {
  const zip = new JSZip()
  slides.forEach((lines, index) => {
    const paragraphs = lines.map(line => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  })
  zip.file('ppt/notesSlides/notesSlide2.xml', '<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>讲者备注 &amp; 提示</a:t></a:r></a:p></p:notes>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('pdf.js asset folders end in a slash on Windows and POSIX', () => {
  // pdf.js rejects a factory URL without a trailing "/", even on Windows.
  // Node reads them with fs, which takes the mixed separators.
  assert.deepEqual(pdfjsAssetUrls('D:\\a\\node_modules\\pdfjs-dist', win32), {
    cMapUrl: 'D:\\a\\node_modules\\pdfjs-dist\\cmaps/',
    standardFontDataUrl: 'D:\\a\\node_modules\\pdfjs-dist\\standard_fonts/',
    wasmUrl: 'D:\\a\\node_modules\\pdfjs-dist\\wasm/',
  })
  assert.deepEqual(pdfjsAssetUrls('/opt/pdfjs-dist', posix), { cMapUrl: '/opt/pdfjs-dist/cmaps/', standardFontDataUrl: '/opt/pdfjs-dist/standard_fonts/', wasmUrl: '/opt/pdfjs-dist/wasm/' })
})

test('PDF text keeps page numbers and CJK characters', async () => {
  const result = await ingestFile({ name: 'lecture.pdf', bytes: await fixture('sample-zh.pdf') })
  assert.equal(result.kind, 'pdf')
  assert.equal(result.pages, 2)
  const all = result.chunks.map(chunk => chunk.text).join('\n')
  assert.match(all, /回复力总是指向平衡位置/)
  assert.match(all, /Restoring force/)
  assert.ok(result.chunks.some(chunk => chunk.page === 2 && /单摆/.test(chunk.text)))
  assert.equal(result.title, '简谐运动讲义')
})

test('DOCX and PPTX text is extracted with locations', async () => {
  const docx = await ingestFile({ name: 'notes.docx', bytes: await makeDocx(['导数的定义', 'The derivative measures change.']) })
  assert.equal(docx.kind, 'docx')
  assert.match(docx.chunks[0].text, /导数的定义/)
  const pptx = await ingestFile({ name: 'deck.pptx', bytes: await makePptx([['第一页 标题'], ['第二页', '要点 &lt;A&gt;']]) })
  assert.equal(pptx.slides, 2)
  assert.equal(pptx.chunks[1].slide, 2)
  assert.match(pptx.chunks[1].text, /要点 <A>/)
  assert.match(pptx.chunks[1].text, /讲者备注 & 提示/)
})

test('plain text detection, GB18030 fallback and markdown sections', async () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7, 0xa3, 0xac, 0xd5, 0xe2, 0xca, 0xc7, 0xb2, 0xe2, 0xca, 0xd4, 0xce, 0xc4, 0xb1, 0xbe, 0xa1, 0xa3])
  assert.equal(decodeText(gbk), '你好世界，这是测试文本。')
  const md = await ingestFile({ name: 'a.md', bytes: Buffer.from('# 线性代数\n\n## 向量\n向量有方向。\n\n## 矩阵\n矩阵是表格。') })
  assert.equal(md.title, '线性代数')
  assert.ok(md.chunks.some(chunk => chunk.section === '矩阵'))
  assert.equal(detectKind('photo.JPG', Buffer.from([0xff, 0xd8])), 'image')
  const image = await ingestFile({ name: 'board.png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
  assert.equal(image.mime, 'image/png')
  assert.throws(() => detectKind('old.doc', Buffer.from('PK')), MaterialError)
  await assert.rejects(ingestFile({ name: 'x.txt', bytes: Buffer.alloc(0) }), /empty/)
})

test('chunking prefers paragraph and sentence boundaries', () => {
  const long = `${'第一段。'.repeat(300)}\n\n${'第二段内容。'.repeat(100)}`
  const chunks = chunkText(long, { page: 3 })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every(chunk => chunk.page === 3 && chunk.text.length <= 1600))
  assert.ok(chunks[0].text.endsWith('。'))
})

test('web ingestion rejects private addresses and extracts article text', async () => {
  assert.throws(() => checkPublicUrl('http://127.0.0.1/x'), /Local network/)
  assert.throws(() => checkPublicUrl('http://192.168.1.2/x'), /Local network/)
  assert.throws(() => checkPublicUrl('file:///etc/passwd'), /http and https/)
  const pages = {
    'https://example.org/start': { status: 301, headers: { location: '/article' } },
    'https://example.org/article': { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<html><head><title>光合作用</title></head><body><nav>menu</nav><article><h1>光合作用</h1>${'<p>植物利用光能把二氧化碳和水转化为有机物，并释放氧气。这个过程发生在叶绿体中。</p>'.repeat(8)}</article></body></html>` },
    'https://example.org/evil': { status: 302, headers: { location: 'http://10.0.0.1/admin' } },
  }
  const fetchImpl = async url => {
    const page = pages[String(url)]
    return new Response(page.body ?? null, { status: page.status, headers: page.headers })
  }
  const result = await ingestUrl('https://example.org/start', { fetchImpl })
  assert.equal(result.kind, 'url')
  assert.equal(result.url, 'https://example.org/article')
  assert.match(result.chunks[0].text, /叶绿体/)
  await assert.rejects(ingestUrl('https://example.org/evil', { fetchImpl }), /Local network/)
})

test('web import refuses local addresses in every spelling', () => {
  const local = ['127.0.0.1', '10.1.2.3', '100.64.0.1', '0.1.2.3', '169.254.169.254', '172.16.5.4', '192.168.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'fe80::1', 'fe80::1%en0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', '2001::1']
  for (const address of local) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '64:ff9b::808:808', '2002:808:808::1']) assert.equal(isPublicAddress(address), true, address)
  for (const url of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://localhost./', 'http://[fe80::1]/', 'http://[::]/', 'http://0.1.2.3/', 'http://100.64.0.1/', 'http://metadata.google.internal/', 'http://printer.local/', 'http://app.localhost/', 'http://intranet/']) {
    assert.throws(() => checkPublicUrl(url), /Local network/, url)
  }
  assert.equal(checkPublicUrl('https://example.org/a').hostname, 'example.org')
})

test('web import checks every resolved address when it connects', async () => {
  const resolve = (host, options, callback) => callback(null, host === 'rebind.example'
    ? [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }])
  const lookup = createGuardedLookup({ resolve })
  const ask = (host, options) => new Promise((done, fail) => lookup(host, options, (error, ...rest) => (error ? fail(error) : done(rest))))
  await assert.rejects(ask('rebind.example', {}), /Local network/)
  assert.deepEqual(await ask('site.example', { family: 6 }), ['2606:2800:220:1::1', 6])
  assert.deepEqual(await ask('site.example', { all: true }), [[{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }]])

  const { gzipSync } = await import('node:zlib')
  const server = createServer((request, response) => {
    if (request.url === '/moved') {
      response.writeHead(302, { location: 'https://example.org/next' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' })
    response.end(gzipSync(Buffer.from('<p>勾股定理</p>'.repeat(40))))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  try {
    // A public-looking name that resolves to this machine is refused…
    const toLoopback = (host, options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }])
    await assert.rejects(createGuardedFetch({ resolve: toLoopback })(`http://public.example:${port}/`), /Local network/)
    await assert.rejects(createGuardedFetch()(`http://127.0.0.1:${port}/`), /Local network/)
    // …while the same request through an allowed address works, decoded, without following redirects.
    const open = createGuardedFetch({ resolve: toLoopback, allowed: () => true })
    const page = await open(`http://public.example:${port}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /^<p>勾股定理<\/p>/u)
    const moved = await open(`http://public.example:${port}/moved`)
    assert.equal(moved.status, 302)
    assert.equal(moved.headers.get('location'), 'https://example.org/next')
    await assert.rejects(createGuardedFetch({ resolve: toLoopback, allowed: () => true, maxBytes: 100 })(`http://public.example:${port}/`), error => error.code === 'ETOOLARGE')
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('retrieval ranks the passage that matches the query', () => {
  const chunks = [
    { id: 'c1', page: 1, text: '回复力总是指向平衡位置，大小与位移成正比。' },
    { id: 'c2', page: 2, text: '单摆的周期与摆长有关，与质量无关。' },
    { id: 'c3', page: 3, text: 'Photosynthesis converts light into chemical energy.' },
  ]
  assert.ok(tokenize('单摆周期').includes('单摆'))
  assert.equal(search(buildIndex(chunks), '单摆的周期')[0].chunk.id, 'c2')
  assert.equal(search(buildIndex(chunks), 'photosynthesis light')[0].chunk.id, 'c3')
  const picked = selectPassages(chunks, '回复力', { maxChars: 100 })
  assert.equal(picked[0].id, 'c1')
  assert.match(formatPassages(picked, '讲义'), /<<讲义 · p\.1>>/)
})

test('long materials are sampled and split across the whole document', () => {
  const chunks = Array.from({ length: 100 }, (_, index) => ({ id: `c${index}`, page: index + 1, text: `第${index + 1}页 ${'内容'.repeat(395)}` }))
  const spread = spreadPassages(chunks, { maxChars: 8000, samples: 10 })
  assert.equal(spread.length, 10)
  assert.equal(spread[0].page, 1)
  assert.equal(spread.at(-1).page, 100)
  assert.ok(spread.some(chunk => chunk.page > 40 && chunk.page < 60))
  assert.ok(spread.reduce((sum, chunk) => sum + chunk.text.length, 0) <= 8000 + spread.length)
  assert.equal(spreadPassages(chunks.slice(0, 3), { maxChars: 8000 }).length, 3)

  const parts = documentParts(chunks, { partChars: 20000 })
  assert.equal(parts.length, 4)
  assert.deepEqual(parts.flat().map(chunk => chunk.page), chunks.map(chunk => chunk.page))
  assert.match(passageRange(parts[0]), /^p\.1–p\.2[4-6]$/u)
  assert.ok(parts.every(part => part.length >= 24 && part.length <= 26))
  const capped = documentParts(chunks, { partChars: 2000, maxParts: 5, maxPartChars: 9000 })
  assert.equal(capped.length, 5)
  assert.ok(capped.every(part => part.reduce((sum, chunk) => sum + chunk.text.length, 0) <= 9000 + part.length))
  assert.equal(capped.at(-1).at(-1).page, 100)
  assert.match(formatPassages([{ page: 7, text: 'x' }], ''), /^<<p\.7>>/u)
})
