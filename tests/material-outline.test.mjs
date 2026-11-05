import assert from 'node:assert/strict'
import { test } from 'node:test'

import JSZip from 'jszip'

import { declaredLabels, finishOutline, flattenBookmarks, headingOutline, readPageNumbers, romanValue, sectionOutline, toRoman } from '../src/core/outline.js'
import { formatPassages } from '../src/core/retrieval.js'
import { entryPages, materialPassages, materialsSummary, materialTopics, outlineText } from '../src/host/context.js'
import { ingestFile, ingestUrl, markdownSections, pageLines } from '../src/host/materials.js'
import { buildPdf } from './pdf-builder.mjs'

// Page lines as the PDF reader gives them: y from 0 (bottom) to 1 (top).
const line = (text, y, size = 12) => ({ text, y, size })

// A textbook: a cover, a contents page, then twelve numbered pages with a
// running head; the chapter opener (page 7) shows no number.
function textbookPages() {
  const pages = [{ lines: [line('数学', 0.6, 30)] }, { lines: [line('目录', 0.9, 20), line('1 小数乘法 ...... 1', 0.8), line('2 位置 ...... 5', 0.75)] }]
  for (let number = 1; number <= 12; number += 1) {
    const lines = [line('数学 五年级 上册', 0.96, 9), line(`第${number}页的正文，讲小数乘法的道理。`, 0.7)]
    if (number !== 5) lines.push(line(String(number), 0.03, 9))
    pages.push({ lines })
  }
  return pages
}

test('printed page numbers are read from the pages, and running heads left out', () => {
  const { labels, furniture } = readPageNumbers(textbookPages())
  assert.deepEqual(labels.slice(0, 4), [null, null, '1', '2'], 'the cover and contents have no printed number')
  assert.equal(labels[6], '5', 'an opener without a number gets the one its neighbours imply')
  assert.equal(labels[13], '12')
  // The running head and the number are furniture; the text is not.
  assert.deepEqual(furniture[2], [0, 2])
  assert.deepEqual(furniture[6], [0])
  assert.deepEqual(furniture[0], [])
  // Numbers that only repeat the page order are not printed numbers.
  const plain = Array.from({ length: 6 }, (_, index) => ({ lines: [line('text', 0.5), line(`- ${index + 1} -`, 0.04)] }))
  const read = readPageNumbers(plain)
  assert.ok(read.labels.every(label => label === null))
  assert.deepEqual(read.furniture[3], [1], 'but they are still left out of the text')
  // Roman numerals for the front matter, then arabic.
  const roman = [...['i', 'ii', 'iii'].map(folio => ({ lines: [line('Preface', 0.5), line(folio, 0.05)] })), ...[1, 2, 3, 4].map(folio => ({ lines: [line('Body', 0.5), line(String(folio), 0.05)] }))]
  assert.deepEqual(readPageNumbers(roman).labels, ['i', 'ii', 'iii', '1', '2', '3', '4'])
  // Stray numbers that never agree are not page numbers.
  const stray = Array.from({ length: 8 }, (_, index) => ({ lines: [line('正文', 0.5), line(String([7, 3, 99, 41, 5, 60, 2, 18][index]), 0.05)] }))
  assert.ok(readPageNumbers(stray).labels.every(label => label === null))
  assert.equal(romanValue('xiv'), 14)
  assert.equal(romanValue('iiii'), 0)
  assert.equal(toRoman(49), 'xlix')
})

test('page labels a PDF declares count unless they repeat the page order', () => {
  assert.equal(declaredLabels(['1', '2', '3'], 3), null)
  assert.equal(declaredLabels(null, 3), null)
  assert.equal(declaredLabels(['i', 'ii'], 3), null, 'one label a page')
  assert.deepEqual(declaredLabels(['i', 'ii', '1'], 3), ['i', 'ii', '1'])
})

test('bookmarks become an outline with each entry\'s pages', () => {
  // A book whose one top bookmark holds the chapters.
  const flat = flattenBookmarks([{ title: '数学 五年级上册', items: [
    { title: '1  小数乘法', dest: 'a', items: [{ title: '小数乘整数', dest: 'b', items: [] }, { title: '小数乘小数', dest: 'c', items: [] }] },
    { title: '2 位置', dest: 'd', items: [] },
  ] }])
  assert.deepEqual(flat.map(entry => [entry.title, entry.level]), [['1 小数乘法', 1], ['小数乘整数', 2], ['小数乘小数', 2], ['2 位置', 1]])
  const pages = { a: 3, b: 3, c: 6, d: 9 }
  const outline = finishOutline(flat.map(entry => ({ ...entry, page: pages[entry.dest] })), 12)
  assert.deepEqual(outline.map(entry => [entry.title, entry.page, entry.end]), [['1 小数乘法', 3, 8], ['小数乘整数', 3, 5], ['小数乘小数', 6, 8], ['2 位置', 9, 12]])
  // Entries pointing nowhere are dropped; deep levels fold into the third.
  const messy = finishOutline([{ title: 'A', level: 2, page: 2 }, { title: '', level: 2, page: 3 }, { title: 'B', level: 6, page: 4 }, { title: 'C', level: 2, page: 99 }, { title: 'D', level: 3, page: null }], 10)
  assert.deepEqual(messy.map(entry => [entry.title, entry.level]), [['A', 1], ['B', 3]])
  assert.deepEqual(finishOutline([], 10), [])
})

// A line of ordinary text, long enough to set the text's size.
const TEXT = '这是一行普通的正文，用来说明小数乘法的计算方法和道理'

test('without bookmarks, chapter titles are found on the pages', () => {
  const pages = [
    { lines: [line('目 录', 0.9, 20), line('第一单元 小数乘法 ........ 1', 0.8), line('第二单元 位置 ........ 9', 0.75), line('第三单元 小数除法 ........ 15', 0.7), line('第四单元 可能性 ........ 20', 0.65)] },
    { lines: [line('第一单元 小数乘法', 0.9, 20), line('小数乘整数', 0.8, 16), line('例1 一支铅笔0.5元，买3支多少元？', 0.7), line('第三单元我们还会学到除法，这里先看乘法。', 0.6)] },
    { lines: [line('例2', 0.85, 16), line('小数乘小数', 0.75, 16), line('先按整数乘法算出积，再点小数点。', 0.6)] },
    { lines: [line('第二单元 位置', 0.9, 20), line('用数对确定位置。', 0.7)] },
    { lines: [line('2.1 数对', 0.5, 12), line('Chapter 9 is not here, this is a sentence.', 0.4)] },
  ]
  // Numbered sections are titles, a chapter's running head counts once, and
  // a box title that recurs in two chapters is kept in both.
  const numbered = headingOutline([
    { lines: [line('第一单元 小数乘法', 0.9, 20), line('1. 小数乘整数', 0.8, 16), line(TEXT, 0.6)] },
    { lines: [line('第一单元 小数乘法', 0.9, 20), line('整理和复习', 0.8, 15), line(TEXT, 0.6)] },
    { lines: [line('第二单元 位置', 0.9, 20), line('整理和复习', 0.8, 15), line(TEXT, 0.6)] },
  ])
  assert.deepEqual(numbered.map(entry => [entry.title, entry.level, entry.page]), [['第一单元 小数乘法', 1, 1], ['1. 小数乘整数', 2, 1], ['整理和复习', 2, 2], ['第二单元 位置', 1, 3], ['整理和复习', 2, 3]])
  // A cover's big title is not a chapter once the pages have printed numbers.
  const covered = [{ lines: [line('数学', 0.6, 40), line('示例教材', 0.2)] }, { lines: [line('小数的意义', 0.9, 18), line(TEXT, 0.6)] }, { lines: [line('小数的读法', 0.9, 18), line(TEXT, 0.6)] }]
  assert.deepEqual(headingOutline(covered, { labels: [null, '1', '2'] }).map(entry => entry.title), ['小数的意义', '小数的读法'])
  assert.deepEqual(headingOutline(covered).map(entry => entry.title), ['数学', '小数的意义', '小数的读法'], 'without printed numbers it cannot tell')
  const found = headingOutline(pages)
  assert.deepEqual(found.map(entry => [entry.title, entry.level, entry.page]), [
    ['第一单元 小数乘法', 1, 2],
    ['小数乘整数', 2, 2],
    ['小数乘小数', 2, 3],
    ['第二单元 位置', 1, 4],
  ], 'the contents page, a 例 box, a sentence and a mid-page number are not headings')
  assert.deepEqual(headingOutline([{ lines: [line('只有正文。', 0.5)] }]), [])
})

test('sections of a document without pages form an outline over its chunks', () => {
  const outline = sectionOutline([{ title: '第一章', level: 1, start: 0 }, { title: '1.1', level: 2, start: 2 }, { title: '第二章', level: 1, start: 5 }], 8)
  assert.deepEqual(outline.map(entry => [entry.title, entry.level, entry.first, entry.last]), [['第一章', 1, 1, 5], ['1.1', 2, 3, 5], ['第二章', 1, 6, 8]])
})

test('PDF lines keep their place and size', () => {
  const items = [
    { str: '第一单元', transform: [22, 0, 0, 22, 72, 760], height: 22, hasEOL: false },
    { str: ' ', transform: [22, 0, 0, 22, 160, 760], height: 0, hasEOL: false },
    { str: '小数乘法', transform: [22, 0, 0, 22, 182, 760], height: 22, hasEOL: false },
    { str: '', transform: [12, 0, 0, 12, 72, 700], height: 0, hasEOL: true },
    { str: 'x', transform: [12, 0, 0, 12, 72, 700], height: 12, hasEOL: false },
    { str: '2', transform: [8, 0, 0, 8, 80, 704], height: 8, hasEOL: false },
    { str: '12', transform: [9, 0, 0, 9, 290, 20], height: 9, hasEOL: false },
  ]
  assert.deepEqual(pageLines(items, [0, 0, 595, 842]).map(entry => [entry.text, Math.round(entry.y * 100), entry.size]), [['第一单元 小数乘法', 90, 22], ['x2', 83, 12], ['12', 2, 9]])
})

// A textbook PDF: cover and contents pages without numbers, then numbered
// pages with a running head.
function textbookPdf({ bookmarks = true, labels = true } = {}) {
  const page = (lines, number) => ({ lines: [...lines, ...(number ? [{ text: '数学 五年级 上册', y: 810, size: 9 }, { text: String(number), x: 290, y: 24, size: 9 }] : [])] })
  return buildPdf({
    title: '数学 五年级上册',
    pages: [
      page([{ text: '数学', y: 500, size: 40 }]),
      page([{ text: '目录', y: 760, size: 20 }, { text: '第一单元 小数乘法 ........ 1', y: 700 }, { text: '第二单元 位置 ........ 3', y: 680 }]),
      page([{ text: '第一单元 小数乘法', y: 760, size: 22 }, { text: '小数乘整数', y: 720, size: 16 }, { text: '例1 一支铅笔0.5元，买3支多少元？0.5×3=1.5（元）', y: 680 }], 1),
      page([{ text: '小数乘小数', y: 760, size: 16 }, { text: '例2 小明买了3.5千克苹果，每千克4元，一共多少元？3.5×4=14（元）', y: 700 }], 2),
      page([{ text: '第二单元 位置', y: 760, size: 22 }, { text: '用数对表示位置：先列后行，例如（3，2）。', y: 700 }], 3),
      page([{ text: '练习二', y: 760, size: 16 }, { text: '在方格纸上标出下面各点的位置。', y: 700 }], 4),
    ],
    outline: bookmarks ? [{ title: '第一单元 小数乘法', page: 3, children: [{ title: '小数乘整数', page: 3 }, { title: '小数乘小数', page: 4 }] }, { title: '第二单元 位置', page: 5 }] : [],
    labels: labels ? [[0, { prefix: '封面' }], [1, { style: 'r' }], [2, { style: 'D', start: 1 }]] : [],
  })
}

test('a textbook PDF keeps its bookmarks, printed page numbers and clean text', async () => {
  const result = await ingestFile({ name: 'math.pdf', bytes: textbookPdf() })
  assert.equal(result.title, '数学 五年级上册')
  assert.equal(result.printed, 'pdf')
  assert.equal(result.outline.source, 'bookmarks')
  assert.deepEqual(result.outline.entries.map(entry => [entry.title, entry.level, entry.page, entry.end, entry.label, entry.endLabel]), [
    ['第一单元 小数乘法', 1, 3, 4, '1', '2'],
    ['小数乘整数', 2, 3, 3, '1', '1'],
    ['小数乘小数', 2, 4, 4, '2', '2'],
    ['第二单元 位置', 1, 5, 6, '3', '4'],
  ])
  const example = result.chunks.find(chunk => /例2/u.test(chunk.text))
  assert.equal(example.page, 4)
  assert.equal(example.label, '2', 'the page as printed')
  const unit = result.outline.entries[0]
  assert.deepEqual(result.chunks.slice(unit.first - 1, unit.last).map(chunk => chunk.page), [3, 4], 'an entry knows its chunks')
  assert.ok(result.chunks.every(chunk => !/数学 五年级 上册/u.test(chunk.text)), 'running heads are left out')
  assert.ok(!result.chunks.some(chunk => /^\d+$/mu.test(chunk.text)), 'and so are page numbers')
  assert.match(formatPassages([example], '数学'), /<<数学 · p\.2>>/u, 'passages are labelled with the printed page')
})

test('a PDF without bookmarks or labels gets them from its pages', async () => {
  const result = await ingestFile({ name: 'math.pdf', bytes: textbookPdf({ bookmarks: false, labels: false }) })
  assert.equal(result.printed, 'pages', 'printed numbers read off the pages')
  assert.deepEqual(result.chunks.filter(chunk => chunk.label).map(chunk => [chunk.page, chunk.label]), [[3, '1'], [4, '2'], [5, '3'], [6, '4']])
  assert.equal(result.outline.source, 'headings')
  assert.deepEqual(result.outline.entries.map(entry => [entry.title, entry.level, entry.label]), [
    ['第一单元 小数乘法', 1, '1'],
    ['小数乘整数', 2, '1'],
    ['小数乘小数', 2, '2'],
    ['第二单元 位置', 1, '3'],
  ], 'the contents page and the 练习 box are not chapters')
})

async function headedDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`
  const cell = text => `<w:tc>${p(text)}</w:tc>`
  const body = [
    p('前言：本讲义用于复习。'),
    p('第一章 函数', 'Heading1'),
    p('函数是一种对应关系。'),
    p('1.1 定义', 'Heading2'),
    `<w:tbl><w:tr>${cell('x')}${cell('y')}</w:tr><w:tr>${cell('1')}${cell('2')}</w:tr></w:tbl>`,
    p('第二章 导数', 'Heading1'),
    p('导数描述变化率。'),
  ].join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('Word headings make sections and an outline; tables keep their rows', async () => {
  const result = await ingestFile({ name: 'notes.docx', bytes: await headedDocx() })
  assert.deepEqual(result.outline.entries.map(entry => [entry.title, entry.level, entry.first, entry.last]), [['第一章 函数', 1, 2, 3], ['1.1 定义', 2, 3, 3], ['第二章 导数', 1, 4, 4]])
  assert.deepEqual(result.chunks.map(chunk => chunk.section ?? null), [null, '第一章 函数', '1.1 定义', '第二章 导数'])
  assert.match(result.chunks[2].text, /x \| y\n\n1 \| 2/u)
  assert.match(result.chunks[0].text, /前言/u)
})

test('Markdown headings inside code are not sections', async () => {
  const markdown = '# 讲义\n\n导言。\n\n## 循环\n\n```python\n# 这是注释，不是标题\nfor i in range(3):\n    print(i)\n```\n\n~~~\n## 也不是\n~~~\n\n## 函数\n\n定义函数。\n'
  const sections = markdownSections(markdown)
  assert.deepEqual(sections.map(section => section.title), ['讲义', '循环', '函数'])
  assert.match(sections[1].text, /# 这是注释/u)
  const result = await ingestFile({ name: 'notes.md', bytes: Buffer.from(markdown) })
  assert.equal(result.title, '讲义')
  assert.deepEqual(result.outline.entries.map(entry => [entry.title, entry.level]), [['讲义', 1], ['循环', 2], ['函数', 2]])
})

test('a web page keeps its article headings as sections', async () => {
  const html = `<!doctype html><html><head><title>Limits</title></head><body><nav>Home | About</nav><article><h1>Limits</h1><p>${'A limit describes where a function heads. '.repeat(12)}</p><h2>One-sided limits</h2><p>${'Approach from the left or the right. '.repeat(12)}</p><table><tr><th>x</th><th>f(x)</th></tr><tr><td>0.9</td><td>1.9</td></tr></table><h2>Continuity</h2><p>${'A continuous function has no jumps. '.repeat(12)}</p></article></body></html>`
  const fetchImpl = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  const result = await ingestUrl('https://example.com/limits', { fetchImpl })
  // The article's own title is the material's title, not a section.
  assert.deepEqual(result.outline.entries.map(entry => entry.title), ['One-sided limits', 'Continuity'])
  assert.equal(result.chunks[0].section, 'example.com', 'text before the first heading is where it was')
  assert.ok(result.chunks.some(chunk => chunk.section === 'One-sided limits' && /x \| f\(x\)/u.test(chunk.text)))
  assert.ok(!result.chunks.some(chunk => /Home \| About/u.test(chunk.text)), 'menus are left out')
})

test('prompts list a material\'s contents with its printed pages', () => {
  const meta = { title: '数学', kind: 'pdf', pages: 6, printed: 'pdf', brief: { summary: '小数。', topics: ['旧话题'] }, outline: { source: 'bookmarks', entries: [
    { title: '第一单元 小数乘法', level: 1, page: 3, end: 4, label: '1', endLabel: '2' },
    { title: '小数乘整数', level: 2, page: 3, end: 3, label: '1', endLabel: '1' },
    { title: '第二单元 位置', level: 1, page: 5, end: 6 },
  ] } }
  const summary = materialsSummary([{ meta }])
  assert.match(summary, /Contents \(pages as printed in it\):\n {4}- 第一单元 小数乘法 \(p\.1–2\)\n {6}- 小数乘整数 \(p\.1\)\n {4}- 第二单元 位置 \(p\.5–6\)/u)
  assert.doesNotMatch(summary, /旧话题/u, 'the outline replaces the topics')
  assert.equal(entryPages(meta.outline.entries[2]), 'p.5–6', 'pages without a printed number use the page order')
  assert.equal(materialTopics(meta), '第一单元 小数乘法; 小数乘整数; 第二单元 位置')
  assert.equal(materialTopics({ brief: { topics: ['a', 'b'] } }), 'a; b')
  // A long outline drops its deepest level first.
  const long = { entries: Array.from({ length: 80 }, (_, index) => ({ title: `第${index}节 内容比较长的标题`, level: index % 4 ? 2 : 1, page: index + 1, end: index + 1 })) }
  const text = outlineText(long, { maxChars: 600 })
  assert.ok(text.length <= 602 && !/^ {2}-/mu.test(text), 'sections dropped before chapters')
  // A learner's "page 2" is the printed page 2.
  const book = { meta: { id: 'mat_x', title: '数学' }, chunks: [{ id: 'c1', page: 3, label: '1', text: '例1' }, { id: 'c2', page: 4, label: '2', text: '例2 小明买了苹果' }] }
  assert.equal(materialPassages([book], { query: '这题', pages: ['2'] }).passages[0].page, 4)
})
