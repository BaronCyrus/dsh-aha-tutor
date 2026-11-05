// Turn uploaded study material into text chunks that remember where they
// came from (page, slide, section), so lessons and cheatsheets can cite them.
// Supported: PDF, DOCX, PPTX, plain text / Markdown, web pages and images.
// Text that is only in pictures (scanned pages, slides or documents made of
// pictures, photos) is read by the learner's model when it can see images:
// see `recognize` in ingestFile and recognize.js. Images are also kept for
// vision-capable models.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { declaredLabels, finishOutline, flattenBookmarks, headingOutline, placeOutline, readPageNumbers, sectionOutline } from '../core/outline.js'
import { pageImage } from './page-image.js'
import { assertPublicHostname, createGuardedFetch } from './web-fetch.js'

// DSH's own budget for attachments; its buffered RPC bodies leave room for
// this much after base64, so the RPC fallback of uploads carries it too.
export const MAX_UPLOAD_MB = 200
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 2_000_000
const CHUNK_CHARS = 1600
const FETCH_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 6 * 1024 * 1024
// At most this many pages, slides or pictures of one file are read by the model.
export const MAX_RECOGNIZED = 200
// A page or slide with fewer characters of its own than this is read as a
// picture: a scan, a photo, a full-page figure.
const MIN_PAGE_TEXT = 30
// A Word document with less text than this per picture is mostly pictures
// (pasted scans, screenshots of questions), so its pictures are read too.
const TEXT_PER_PICTURE = 150
// Smaller pictures are bullets, icons and lines, not text.
const MIN_PICTURE_BYTES = 2048
const PICTURE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })

// Web pages and linked PDFs are read through a fetch that only connects to
// public addresses.
const pageFetch = createGuardedFetch({ maxBytes: MAX_UPLOAD_BYTES })

export class MaterialError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MaterialError'
    this.code = code
  }
}

const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })

export function detectKind(name, bytes) {
  const lower = String(name ?? '').toLowerCase()
  const head = bytes?.subarray?.(0, 8) ?? Buffer.alloc(0)
  if (head.subarray(0, 5).toString('latin1') === '%PDF-' || lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.pptx')) return 'pptx'
  if (/\.(md|markdown)$/u.test(lower)) return 'markdown'
  if (/\.(txt|text|csv|tsv|json|tex|py|js|ts|java|c|cpp|rs|go|rb|sql|html?)$/u.test(lower)) return 'text'
  const extension = lower.split('.').pop()
  if (IMAGE_TYPES[extension]) return 'image'
  if (head[0] === 0x89 && head[1] === 0x50) return 'image'
  if (head[0] === 0xff && head[1] === 0xd8) return 'image'
  if (head.subarray(0, 2).toString('latin1') === 'PK') {
    if (lower.endsWith('.doc') || lower.endsWith('.ppt')) throw new MaterialError('old-office', 'Old .doc/.ppt files are not supported; save as .docx/.pptx')
  }
  throw new MaterialError('unsupported', 'This file type is not supported')
}

export function imageMime(name, bytes) {
  const extension = String(name ?? '').toLowerCase().split('.').pop()
  if (IMAGE_TYPES[extension]) return IMAGE_TYPES[extension]
  if (bytes?.[0] === 0x89) return 'image/png'
  if (bytes?.[0] === 0xff) return 'image/jpeg'
  return 'image/png'
}

// UTF-8 first; text files saved by Chinese Windows tools are often GB18030.
export function decodeText(bytes) {
  let textValue = new TextDecoder('utf-8').decode(bytes)
  const broken = (textValue.match(/�/gu) ?? []).length
  if (broken > Math.max(4, textValue.length / 200)) {
    try {
      textValue = new TextDecoder('gb18030').decode(bytes)
    } catch {
      // keep the UTF-8 reading
    }
  }
  return textValue.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n')
}

// Some CJK fonts map common ideographs to look-alike radical code points
// (⼒ for 力, ⻆ for 角). Kangxi radicals carry a compatibility mapping;
// the simplified radicals supplement needs a table. Only these characters are
// touched, so full-width punctuation stays as written.
const RADICAL_SUPPLEMENT = Object.freeze({
  '⺌': '小', '⺍': '小', '⺕': '彐', '⺟': '母', '⺠': '民', '⺮': '竹', '⺶': '羊', '⻁': '虎',
  '⻄': '西', '⻅': '见', '⻆': '角', '⻈': '讠', '⻉': '贝', '⻊': '足', '⻋': '车', '⻓': '长',
  '⻔': '门', '⻗': '雨', '⻘': '青', '⻙': '韦', '⻚': '页', '⻛': '风', '⻜': '飞', '⻝': '食',
  '⻠': '饣', '⻢': '马', '⻣': '骨', '⻤': '鬼', '⻥': '鱼', '⻦': '鸟', '⻧': '卤', '⻨': '麦',
  '⻩': '黄', '⻪': '黾', '⻫': '齐', '⻬': '齐', '⻭': '齿', '⻮': '齿', '⻯': '龙', '⻰': '龙',
  '⻲': '龟', '⻳': '龟',
})

export function fixCjkRadicals(value) {
  return String(value ?? '')
    .replace(/[⼀-⿟]/gu, char => char.normalize('NFKC'))
    .replace(/[⺀-⻿]/gu, char => RADICAL_SUPPLEMENT[char] ?? char)
}

function cleanText(value) {
  return fixCjkRadicals(value)
    .replace(/\u0000/gu, '')
    .replace(/[ \t ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

// Split one location's text into chunks near CHUNK_CHARS, preferring
// paragraph and sentence boundaries.
export function chunkText(value, where = {}) {
  const textValue = cleanText(value)
  if (!textValue) return []
  const chunks = []
  let rest = textValue
  let part = 1
  while (rest.length) {
    let cut = rest.length
    if (rest.length > CHUNK_CHARS) {
      const window = rest.slice(0, CHUNK_CHARS)
      const paragraph = window.lastIndexOf('\n\n')
      const sentence = Math.max(window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('！'), window.lastIndexOf('？'))
      cut = paragraph > CHUNK_CHARS * 0.5 ? paragraph : sentence > CHUNK_CHARS * 0.5 ? sentence + 1 : CHUNK_CHARS
    }
    chunks.push({ ...where, part, text: rest.slice(0, cut).trim() })
    rest = rest.slice(cut).trim()
    part += 1
  }
  return chunks.filter(chunk => chunk.text)
}

// outline: { source, entries } over pages (entries with page and end) or
// over chunk positions (first and last); labels: the printed number of each
// page. A material keeps an outline of two entries or more.
function finish(kind, title, chunks, { outline, labels, ...extra } = {}) {
  let total = 0
  const kept = []
  for (const chunk of chunks) {
    if (total + chunk.text.length > MAX_TEXT_CHARS) break
    total += chunk.text.length
    kept.push({ id: `c${kept.length + 1}`, ...chunk })
  }
  const placed = outlineOf(outline, kept, labels)
  return { kind, title, chunks: kept, chars: total, truncated: kept.length < chunks.length, ...extra, ...(placed ? { outline: placed } : {}) }
}

function outlineOf(outline, chunks, labels) {
  if (!outline?.entries?.length) return null
  const paged = outline.entries.every(entry => entry.page)
  const entries = (paged ? placeOutline(outline.entries, chunks, labels) : outline.entries)
    .filter(entry => paged || entry.first <= chunks.length)
    .map(entry => (entry.last > chunks.length ? { ...entry, last: chunks.length } : entry))
  return entries.length >= 2 ? { source: outline.source, entries } : null
}

// ── documents made of headings and paragraphs (Word, Markdown, web pages) ──

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'FORM', 'HEAD'])
const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'DEL', 'INS', 'FONT', 'LABEL'])
const squash = value => String(value ?? '').replace(/[ \t\u00a0]+/gu, ' ').replace(/ *\n */gu, '\n').trim()

// The blocks of an HTML document or fragment in reading order: headings
// ({ heading, level }) and paragraphs ({ text }). A table row is one
// paragraph with its cells joined by " | ", so a table stays readable.
export function htmlBlocks(root) {
  const blocks = []
  let inline = ''
  const flush = () => {
    const value = squash(inline)
    if (value) blocks.push({ text: value })
    inline = ''
  }
  const walk = node => {
    for (const child of node?.childNodes ?? []) {
      if (child.nodeType === 3) {
        inline += child.textContent
        continue
      }
      if (child.nodeType !== 1) continue
      const tag = String(child.tagName).toUpperCase()
      if (SKIP_TAGS.has(tag)) continue
      if (tag === 'BR') {
        inline += '\n'
      } else if (INLINE_TAGS.has(tag)) {
        walk(child)
      } else if (/^H[1-6]$/u.test(tag)) {
        flush()
        const heading = squash(child.textContent).replace(/\n/gu, ' ')
        if (heading) blocks.push({ heading, level: Number(tag[1]) })
      } else if (tag === 'TABLE') {
        flush()
        for (const row of child.querySelectorAll('tr')) {
          const cells = [...row.children].filter(cell => /^T[DH]$/u.test(String(cell.tagName).toUpperCase())).map(cell => squash(cell.textContent).replace(/\n/gu, ' '))
          if (cells.some(Boolean)) blocks.push({ text: cells.join(' | ') })
        }
      } else {
        flush()
        walk(child)
        flush()
      }
    }
  }
  walk(root)
  flush()
  return blocks
}

// Blocks under their headings, levels 1 to 3 (deeper headings stay in the
// text). Text before the first heading is a section without a title.
function blockSections(blocks) {
  const sections = []
  let current = { title: '', level: 0, parts: [] }
  for (const block of blocks) {
    if (block.heading && block.level <= 3) {
      if (current.title || current.parts.length) sections.push(current)
      current = { title: block.heading, level: block.level, parts: [block.heading] }
    } else {
      current.parts.push(block.heading ?? block.text)
    }
  }
  if (current.title || current.parts.length) sections.push(current)
  return sections.map(section => ({ title: section.title, level: section.level, text: section.parts.join('\n\n') }))
}

// Sections as chunks labelled with their heading, and the headings as an
// outline over the chunks. untitled: where text outside any section is.
function sectionChunks(sections, untitled = {}) {
  const chunks = []
  const heads = []
  for (const section of sections) {
    const start = chunks.length
    chunks.push(...chunkText(section.text, section.title ? { section: section.title.slice(0, 80) } : untitled))
    if (section.title && chunks.length > start) heads.push({ title: section.title, level: section.level, start })
  }
  return { chunks, outline: { source: 'headings', entries: sectionOutline(heads, chunks.length) } }
}

// Markdown in sections under its headings (#, ## and ###), leaving headings
// inside fenced code alone: a "# comment" in code is not a chapter.
export function markdownSections(value) {
  const sections = []
  let current = { title: '', level: 0, lines: [] }
  let fence = null
  for (const line of String(value ?? '').split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker
      current.lines.push(line)
      continue
    }
    const heading = fence ? null : /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading) {
      if (current.title || current.lines.some(text => text.trim())) sections.push(current)
      current = { title: heading[2].trim(), level: heading[1].length, lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.title || current.lines.some(text => text.trim())) sections.push(current)
  return sections.map(section => ({ title: section.title, level: section.level, text: section.lines.join('\n') }))
}

const visibleLength = value => String(value ?? '').replace(/\s+/gu, '').length

// Read the text in pictures. sources: [{ where, image() }] in reading order,
// where image() resolves to { mime, data } or null (nothing to read).
// recognize(sources) answers [{ text } | { error }] in the same order, or
// null when no model the learner chose can see images. Returns the texts and
// a note for the material: { read, failed: [where], reason, left } once
// pictures were read, { unread } when they could not be.
async function readPictures(recognize, sources) {
  if (!sources.length) return { texts: [], note: null, available: true, error: null }
  const tried = sources.slice(0, MAX_RECOGNIZED)
  const results = recognize ? await recognize(tried) : null
  if (!results) return { texts: [], note: { unread: sources.length }, available: false, error: null }
  const error = results.find(result => result?.error)?.error ?? null
  const failed = tried.filter((source, index) => results[index]?.error).map(source => source.where)
  return {
    texts: tried.map((source, index) => results[index]?.text ?? ''),
    note: { read: results.filter(result => result && !result.error).length, failed, reason: error?.code ?? null, left: sources.length - tried.length },
    available: true,
    error,
  }
}

// Zip parts are named with "/" on every system, so these are not file paths.
function resolvePart(base, target) {
  const parts = target.startsWith('/') ? [] : base.split('/').filter(Boolean)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece && piece !== '.') parts.push(piece)
  }
  return parts.join('/')
}

// The pictures an Office part shows, in the order it shows them, each once.
async function partPictures(zip, part) {
  const slash = part.lastIndexOf('/')
  const folder = part.slice(0, slash)
  const xml = (await zip.file(part)?.async('string')) ?? ''
  const rels = (await zip.file(`${folder}/_rels/${part.slice(slash + 1)}.rels`)?.async('string')) ?? ''
  const targets = new Map()
  for (const [, attributes] of rels.matchAll(/<Relationship\b([^>]*)>/gu)) {
    const id = /\bId="([^"]+)"/u.exec(attributes)?.[1]
    const target = /\bTarget="([^"]+)"/u.exec(attributes)?.[1]
    if (!id || !target || !/\bType="[^"]*\/image"/u.test(attributes) || /\bTargetMode="External"/u.test(attributes)) continue
    targets.set(id, resolvePart(folder, decodeXml(target)))
  }
  const seen = new Set()
  const pictures = []
  for (const [, id] of xml.matchAll(/\br:(?:embed|id)="([^"]+)"/gu)) {
    const path = targets.get(id)
    if (!path || seen.has(path)) continue
    seen.add(path)
    const mime = PICTURE_TYPES[path.split('.').pop().toLowerCase()]
    const file = zip.file(path)
    if (!mime || !file) continue
    const data = await file.async('nodebuffer')
    if (data.length >= MIN_PICTURE_BYTES && data.length <= MAX_IMAGE_BYTES) pictures.push({ mime, data })
  }
  return pictures
}

let pdfjsModule
async function loadPdfjs() {
  pdfjsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsModule
}

// pdf.js insists the asset URLs end in "/" on every system and reads them
// with fs, which on Windows accepts the mixed separators that gives. Its
// WebAssembly decoders read the CCITT and JBIG2 images black-and-white scans
// are made of; without them those pages decode to nothing.
export function pdfjsAssetUrls(root, { join: joinPath = join } = {}) {
  return { cMapUrl: `${joinPath(root, 'cmaps')}/`, standardFontDataUrl: `${joinPath(root, 'standard_fonts')}/`, wasmUrl: `${joinPath(root, 'wasm')}/` }
}

function pdfjsAssets() {
  const require = createRequire(import.meta.url)
  return pdfjsAssetUrls(dirname(require.resolve('pdfjs-dist/package.json')))
}

// A page's text as lines, from pdf.js text items: { text, y, size }, y from
// 0 at the bottom of the page to 1 at the top. A line ends where pdf.js marks
// it or where the baseline moves by more than half a line.
export function pageLines(items, view = [0, 0, 1, 1]) {
  const bottom = Number(view?.[1]) || 0
  const height = (Number(view?.[3]) || 1) - bottom || 1
  const lines = []
  let current = null
  const close = () => {
    if (current?.text.trim()) lines.push({ text: current.text.trim(), y: Math.min(1, Math.max(0, (current.baseline - bottom) / height)), size: Math.round(current.size * 10) / 10 })
    current = null
  }
  for (const item of items ?? []) {
    if (typeof item?.str !== 'string') continue
    const baseline = Number(item.transform?.[5]) || 0
    const size = Math.abs(Number(item.height)) || Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0)
    if (current && item.str.trim() && Math.abs(baseline - current.baseline) > Math.max(2, (current.size || size) * 0.6)) close()
    if (item.str) {
      current ??= { text: '', baseline, size: 0 }
      current.text += item.str
      if (item.str.trim()) current.size = Math.max(current.size, size)
    }
    if (item.hasEOL) close()
  }
  close()
  return lines
}

// The page a bookmark points at (1-based), or null.
async function bookmarkPage(doc, dest) {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    const target = Array.isArray(explicit) ? explicit[0] : null
    if (Number.isInteger(target)) return target + 1
    if (target && typeof target === 'object') return (await doc.getPageIndex(target)) + 1
  } catch {
    // a broken bookmark is left out
  }
  return null
}

// The PDF's outline: its bookmarks, or else the chapter and section titles
// found on its pages (see headingOutline). { source, entries } or null.
async function pdfOutline(doc, pages, running) {
  let bookmarks = []
  try {
    bookmarks = flattenBookmarks(await doc.getOutline())
  } catch {
    bookmarks = []
  }
  const marked = []
  for (const entry of bookmarks) marked.push({ ...entry, page: await bookmarkPage(doc, entry.dest) })
  const fromBookmarks = finishOutline(marked, doc.numPages)
  if (fromBookmarks.length >= 2) return { source: 'bookmarks', entries: fromBookmarks }
  const fromHeadings = finishOutline(headingOutline(pages, { running }), doc.numPages)
  return fromHeadings.length >= 2 ? { source: 'headings', entries: fromHeadings } : null
}

// Pages without text of their own (scans, photos, full-page figures) are
// read as pictures with recognize (see readPictures). Each page keeps its
// printed page number (`label`) when the PDF declares page labels or its
// pages show their numbers, and running heads, feet and page numbers are
// left out of the text. The outline comes from the bookmarks, or from the
// headings on the pages.
export async function extractPdf(bytes, { signal, recognize } = {}) {
  const pdfjs = await loadPdfjs()
  const { cMapUrl, standardFontDataUrl, wasmUrl } = pdfjsAssets()
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    wasmUrl,
    // A page picture over 100 megapixels (a 600 dpi A4 scan is 35) is left
    // out rather than decoded into gigabytes.
    maxImageSize: 100_000_000,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  let doc
  try {
    doc = await task.promise
  } catch (error) {
    if (error?.name === 'PasswordException') throw new MaterialError('encrypted', 'This PDF is password protected')
    throw new MaterialError('unreadable', 'This PDF could not be read')
  }
  try {
    let title = ''
    try {
      const meta = await doc.getMetadata()
      title = String(meta?.info?.Title ?? '').trim()
    } catch {
      // metadata is optional
    }
    const pages = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      signal?.throwIfAborted()
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push({ lines: pageLines(content.items, page.view) })
      page.cleanup()
    }
    const numbers = readPageNumbers(pages)
    let declared = null
    try {
      declared = declaredLabels(await doc.getPageLabels(), doc.numPages)
    } catch {
      declared = null
    }
    const labels = declared ?? (numbers.labels.some(Boolean) ? numbers.labels : null)
    const texts = pages.map((page, index) => {
      const drop = new Set(numbers.furniture[index])
      return page.lines.filter((line, lineIndex) => !drop.has(lineIndex)).map(line => line.text).join('\n')
    })
    const outline = await pdfOutline(doc, pages, numbers.running)
    const pictured = texts.flatMap((pageText, index) => (visibleLength(pageText) < MIN_PAGE_TEXT ? [index + 1] : []))
    const read = await readPictures(recognize, pictured.map(pageNumber => ({
      where: { page: pageNumber },
      image: async () => {
        signal?.throwIfAborted()
        const page = await doc.getPage(pageNumber)
        try {
          return await pageImage(pdfjs, page)
        } finally {
          page.cleanup()
        }
      },
    })))
    // A scan whose pages could not be read at all is reported, not kept
    // with nothing in it but the odd page number.
    if (pictured.length === doc.numPages && !read.note?.read) {
      if (!read.available) throw new MaterialError('scan-needs-vision', 'This PDF is a scan; reading it needs a model that can see images')
      throw read.error ?? new MaterialError('no-text', 'No text found in this PDF')
    }
    const recognized = new Map(pictured.slice(0, read.texts.length).map((pageNumber, index) => [pageNumber, read.texts[index]]))
    const chunks = texts.flatMap((pageText, index) => chunkText([pageText, recognized.get(index + 1)].filter(Boolean).join('\n\n'), { page: index + 1, ...(labels?.[index] ? { label: labels[index] } : {}) }))
    if (!chunks.length) throw read.error ?? new MaterialError('no-text', 'No text found in this PDF')
    return { title, pages: doc.numPages, chunks, ocr: read.note, labels, printed: labels ? (declared ? 'pdf' : 'pages') : null, outline }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => undefined)
  }
}

// A document that is mostly pictures (pasted scans, screenshots of
// questions) also has its pictures read with recognize, after its own text;
// the diagrams of a written document are left alone.
// Word headings made with localized style names (WPS, older Office).
const DOCX_STYLES = ["p[style-name='标题 1'] => h1:fresh", "p[style-name='标题 2'] => h2:fresh", "p[style-name='标题 3'] => h3:fresh"]

// The text is read as HTML, so headings make sections and an outline, and
// tables keep their rows; pictures are not converted (they are read below
// when the document is mostly pictures). A document without headings is
// cut into numbered sections (§1, §2…) of about a chunk each.
export async function extractDocx(bytes, { recognize } = {}) {
  const mammoth = await import('mammoth')
  const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml
  const images = mammoth.images ?? mammoth.default?.images
  let result
  try {
    result = await convert({ buffer: Buffer.from(bytes) }, { styleMap: DOCX_STYLES, convertImage: images.imgElement(() => ({ src: '' })) })
  } catch {
    throw new MaterialError('unreadable', 'This Word document could not be read')
  }
  const { parseHTML } = await import('linkedom')
  const { document } = parseHTML(`<!doctype html><html><body>${String(result?.value ?? '')}</body></html>`)
  const blocks = htmlBlocks(document.body)
  const own = blocks.map(block => block.heading ?? block.text).join('\n\n')
  const sections = blockSections(blocks)
  let chunks = []
  let outline = null
  let section = 1
  if (sections.some(entry => entry.title)) {
    ({ chunks, outline } = sectionChunks(sections))
  } else {
    let buffer = ''
    for (const paragraph of own.split(/\n{2,}/u)) {
      if ((buffer + paragraph).length > CHUNK_CHARS && buffer) {
        chunks.push(...chunkText(buffer, { section: `§${section}` }))
        section += 1
        buffer = ''
      }
      buffer += `${paragraph}\n\n`
    }
    if (buffer.trim()) {
      chunks.push(...chunkText(buffer, { section: `§${section}` }))
      section += 1
    }
  }
  const JSZip = (await import('jszip')).default
  const pictures = await partPictures(await JSZip.loadAsync(bytes), 'word/document.xml')
  let note = null
  if (pictures.length && visibleLength(own) < TEXT_PER_PICTURE * pictures.length) {
    const read = await readPictures(recognize, pictures.map((picture, index) => ({ where: { picture: index + 1 }, image: async () => picture })))
    // Hardly any text of its own and no picture read: reported, not kept
    // with nothing in it.
    if (!read.note?.read && visibleLength(own) < MIN_PAGE_TEXT) {
      if (!read.available) throw new MaterialError('pictures-need-vision', 'This document is pictures; reading them needs a model that can see images')
      throw read.error ?? new MaterialError('no-text', 'No text found in this document')
    }
    for (const [index, pictureText] of read.texts.entries()) chunks.push(...chunkText(pictureText, outline ? { picture: index + 1 } : { section: `§${section + index}` }))
    if (!chunks.length) throw read.error ?? new MaterialError('no-text', 'No text found in this document')
    note = read.note
  }
  if (!chunks.length) throw new MaterialError('no-text', 'No text found in this document')
  return { chunks, ocr: note, outline }
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
    return XML_ENTITIES[entity.toLowerCase()] ?? ''
  })
}

function slideText(xml) {
  return xml.split(/<\/a:p>/u).map(paragraph => {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu)].map(match => decodeXml(match[1]))
    return runs.join('')
  }).filter(line => line.trim()).join('\n')
}

// A slide with hardly any text of its own has its pictures read with
// recognize, after its text.
export async function extractPptx(bytes, { recognize } = {}) {
  const JSZip = (await import('jszip')).default
  let zip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new MaterialError('unreadable', 'This PowerPoint file could not be read')
  }
  const slideNumber = name => Number(/(\d+)\.xml$/u.exec(name)?.[1] ?? 0)
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b))
  const texts = []
  const sources = []
  let written = 0
  for (const name of slides) {
    const number = slideNumber(name)
    const body = slideText(await zip.file(name).async('string'))
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${number}.xml`)
    const notes = notesFile ? slideText(await notesFile.async('string')) : ''
    texts.push({ number, text: notes ? `${body}\n[notes] ${notes}` : body })
    if (visibleLength(body) < MIN_PAGE_TEXT) for (const picture of await partPictures(zip, name)) sources.push({ where: { slide: number }, image: async () => picture })
    else written += 1
  }
  const read = await readPictures(recognize, sources)
  // Slides that are all pictures, none of them read: reported, not kept
  // with only their titles.
  if (sources.length && !written && !read.note?.read) {
    if (!read.available) throw new MaterialError('pictures-need-vision', 'These slides are pictures; reading them needs a model that can see images')
    throw read.error ?? new MaterialError('no-text', 'No text found in these slides')
  }
  const pictured = new Map()
  for (const [index, pictureText] of read.texts.entries()) {
    const { slide } = sources[index].where
    pictured.set(slide, [pictured.get(slide), pictureText].filter(Boolean).join('\n\n'))
  }
  const chunks = texts.flatMap(({ number, text }) => chunkText([text, pictured.get(number)].filter(Boolean).join('\n\n'), { slide: number }))
  if (!chunks.length) throw read.error ?? new MaterialError('no-text', 'No text found in these slides')
  return { slides: slides.length, chunks, ocr: read.note }
}

export function extractPlain(bytes, kind) {
  const value = decodeText(bytes)
  if (kind !== 'markdown') {
    const chunks = chunkText(value, {})
    if (!chunks.length) throw new MaterialError('empty', 'This file is empty')
    return { title: '', chunks }
  }
  const sections = markdownSections(value)
  const { chunks, outline } = sectionChunks(sections)
  if (!chunks.length) throw new MaterialError('empty', 'This file is empty')
  return { title: sections.find(section => section.level === 1)?.title ?? '', chunks, outline }
}

// recognize(sources), when given, reads the text in pictures (see
// readPictures). A material made from pictures carries `ocr`: what was
// read, what failed and why, and what was left unread.
export async function ingestFile({ name, bytes, signal, recognize }) {
  if (!bytes?.length) throw new MaterialError('empty', 'The file is empty')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new MaterialError('too-large', `The file is larger than ${MAX_UPLOAD_MB} MB`)
  const kind = detectKind(name, bytes)
  const baseTitle = String(name ?? '').replace(/\.[^.]+$/u, '').slice(0, 120) || 'Untitled'
  if (kind === 'image') {
    if (bytes.length > MAX_IMAGE_BYTES) throw new MaterialError('image-too-large', 'Images must be smaller than 10 MB')
    const mime = imageMime(name, bytes)
    // A photo is kept even when its text could not be read: models that see
    // images still get the picture.
    const read = await readPictures(recognize, [{ where: { picture: 1 }, image: async () => ({ mime, data: Buffer.from(bytes) }) }])
    return finish(kind, baseTitle, chunkText(read.texts[0] ?? '', {}), { mime, ...(read.available ? { ocr: read.note } : {}) })
  }
  if (kind === 'pdf') {
    const result = await extractPdf(bytes, { signal, recognize })
    return finish(kind, result.title || baseTitle, result.chunks, { pages: result.pages, ocr: result.ocr, outline: result.outline, labels: result.labels, printed: result.printed })
  }
  if (kind === 'docx') {
    const result = await extractDocx(bytes, { recognize })
    return finish(kind, baseTitle, result.chunks, { ocr: result.ocr, outline: result.outline })
  }
  if (kind === 'pptx') {
    const result = await extractPptx(bytes, { recognize })
    return finish(kind, baseTitle, result.chunks, { slides: result.slides, ocr: result.ocr })
  }
  const result = extractPlain(bytes, kind)
  return finish(kind, result.title || baseTitle, result.chunks, { outline: result.outline })
}

// ── web pages ───────────────────────────────────────────────────────────────

// Literal addresses and local names are refused here; names are resolved and
// checked again when guardedFetch connects (see web-fetch.js).
export function checkPublicUrl(value) {
  let url
  try {
    url = new URL(String(value).trim())
  } catch {
    throw new MaterialError('bad-url', 'This is not a valid web address')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new MaterialError('bad-url', 'Only http and https addresses are supported')
  if (url.username || url.password) throw new MaterialError('bad-url', 'Addresses with credentials are not supported')
  try {
    assertPublicHostname(url.hostname)
  } catch (error) {
    throw new MaterialError('bad-url', error.message)
  }
  return url
}

export async function ingestUrl(address, { fetchImpl = pageFetch, signal, recognize } = {}) {
  let url = checkPublicUrl(address)
  let response
  // Follow up to five redirects by hand so every hop is checked.
  for (let hop = 0; hop < 6; hop += 1) {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    try {
      response = await fetchImpl(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (dsh-aha-tutor)', Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (error?.name === 'AddressError') throw new MaterialError('bad-url', error.message)
      if (error?.code === 'ETOOLARGE') throw new MaterialError('page-too-large', 'The page is too large')
      throw new MaterialError('network', timeout.aborted ? 'The page took too long to load' : 'The page could not be loaded')
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = checkPublicUrl(new URL(response.headers.get('location'), url).href)
      continue
    }
    break
  }
  if (!response?.ok) throw new MaterialError('http', `The page returned an error (${response?.status ?? 'redirect loop'})`)
  const type = String(response.headers.get('content-type') ?? '').toLowerCase()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_PAGE_BYTES && !type.includes('pdf')) throw new MaterialError('page-too-large', 'The page is too large')
  if (type.includes('application/pdf') || bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    const result = await ingestFile({ name: `${url.pathname.split('/').pop() || 'page'}.pdf`, bytes, signal, recognize })
    return { ...result, kind: 'url', url: url.href }
  }
  if (type.startsWith('text/plain')) {
    const result = extractPlain(bytes, 'text')
    return finish('url', url.hostname, result.chunks, { url: url.href })
  }
  const html = decodeText(bytes)
  const { parseHTML } = await import('linkedom')
  const { Readability } = await import('@mozilla/readability')
  const { document } = parseHTML(html)
  let article = null
  try {
    article = new Readability(document, { charThreshold: 200 }).parse()
  } catch {
    article = null
  }
  const title = String(article?.title || document.querySelector('title')?.textContent || url.hostname).trim().slice(0, 160)
  // The article's headings make sections; without any, the page is one.
  const blocks = article?.content ? htmlBlocks(parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body) : []
  const sections = blockSections(blocks)
  const { chunks, outline } = sections.some(section => section.title)
    ? sectionChunks(sections, { section: url.hostname })
    : { chunks: chunkText(article?.textContent || document.body?.textContent || '', { section: url.hostname }), outline: null }
  if (!chunks.length) throw new MaterialError('page-no-text', 'No readable text on this page')
  return finish('url', title, chunks, { url: url.href, outline })
}
