// Turn uploaded study material into text chunks that remember where they
// came from (page, slide, section), so lessons and cheatsheets can cite them.
// Supported: PDF, DOCX, PPTX, plain text / Markdown, web pages and images
// (images are kept for vision-capable models; they produce no text here).

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { assertPublicHostname, createGuardedFetch } from './web-fetch.js'

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 2_000_000
const CHUNK_CHARS = 1600
const FETCH_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 6 * 1024 * 1024

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

function finish(kind, title, chunks, extra = {}) {
  let total = 0
  const kept = []
  for (const chunk of chunks) {
    if (total + chunk.text.length > MAX_TEXT_CHARS) break
    total += chunk.text.length
    kept.push({ id: `c${kept.length + 1}`, ...chunk })
  }
  return { kind, title, chunks: kept, chars: total, truncated: kept.length < chunks.length, ...extra }
}

let pdfjsModule
async function loadPdfjs() {
  pdfjsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsModule
}

// pdf.js insists both factory URLs end in "/" on every system and reads them
// with fs, which on Windows accepts the mixed separators that gives.
export function pdfjsAssetUrls(root, { join: joinPath = join } = {}) {
  return { cMapUrl: `${joinPath(root, 'cmaps')}/`, standardFontDataUrl: `${joinPath(root, 'standard_fonts')}/` }
}

function pdfjsAssets() {
  const require = createRequire(import.meta.url)
  return pdfjsAssetUrls(dirname(require.resolve('pdfjs-dist/package.json')))
}

export async function extractPdf(bytes, { signal } = {}) {
  const pdfjs = await loadPdfjs()
  const { cMapUrl, standardFontDataUrl } = pdfjsAssets()
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
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
    const chunks = []
    let title = ''
    try {
      const meta = await doc.getMetadata()
      title = String(meta?.info?.Title ?? '').trim()
    } catch {
      // metadata is optional
    }
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      signal?.throwIfAborted()
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        pageText += item.str
        pageText += item.hasEOL ? '\n' : ''
      }
      page.cleanup()
      chunks.push(...chunkText(pageText, { page: pageNumber }))
    }
    if (!chunks.length) throw new MaterialError('no-text', 'No text found in this PDF (it may be a scan)')
    return { title, pages: doc.numPages, chunks }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => undefined)
  }
}

export async function extractDocx(bytes) {
  const mammoth = await import('mammoth')
  const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText
  let result
  try {
    result = await extract({ buffer: Buffer.from(bytes) })
  } catch {
    throw new MaterialError('unreadable', 'This Word document could not be read')
  }
  const sections = String(result?.value ?? '').split(/\n{2,}/u)
  const chunks = []
  let buffer = ''
  let section = 1
  for (const paragraph of sections) {
    if ((buffer + paragraph).length > CHUNK_CHARS && buffer) {
      chunks.push(...chunkText(buffer, { section: `§${section}` }))
      section += 1
      buffer = ''
    }
    buffer += `${paragraph}\n\n`
  }
  if (buffer.trim()) chunks.push(...chunkText(buffer, { section: `§${section}` }))
  if (!chunks.length) throw new MaterialError('no-text', 'No text found in this document')
  return { chunks }
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

export async function extractPptx(bytes) {
  const JSZip = (await import('jszip')).default
  let zip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new MaterialError('unreadable', 'This PowerPoint file could not be read')
  }
  const slideNumber = name => Number(/(\d+)\.xml$/u.exec(name)?.[1] ?? 0)
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b))
  const chunks = []
  for (const name of slides) {
    const number = slideNumber(name)
    const body = slideText(await zip.file(name).async('string'))
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${number}.xml`)
    const notes = notesFile ? slideText(await notesFile.async('string')) : ''
    const combined = notes ? `${body}\n[notes] ${notes}` : body
    chunks.push(...chunkText(combined, { slide: number }))
  }
  if (!chunks.length) throw new MaterialError('no-text', 'No text found in these slides')
  return { slides: slides.length, chunks }
}

export function extractPlain(bytes, kind) {
  const value = decodeText(bytes)
  const chunks = []
  if (kind === 'markdown') {
    const parts = value.split(/\n(?=#{1,3}\s)/u)
    for (const part of parts) {
      const heading = /^#{1,3}\s+(.+)/u.exec(part)?.[1]?.trim()
      chunks.push(...chunkText(part, heading ? { section: heading.slice(0, 80) } : {}))
    }
  } else {
    chunks.push(...chunkText(value, {}))
  }
  if (!chunks.length) throw new MaterialError('empty', 'This file is empty')
  const title = kind === 'markdown' ? /^#\s+(.+)$/mu.exec(value)?.[1]?.trim() ?? '' : ''
  return { title, chunks }
}

export async function ingestFile({ name, bytes, signal }) {
  if (!bytes?.length) throw new MaterialError('empty', 'The file is empty')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new MaterialError('too-large', 'The file is larger than 60 MB')
  const kind = detectKind(name, bytes)
  const baseTitle = String(name ?? '').replace(/\.[^.]+$/u, '').slice(0, 120) || 'Untitled'
  if (kind === 'image') {
    if (bytes.length > MAX_IMAGE_BYTES) throw new MaterialError('image-too-large', 'Images must be smaller than 10 MB')
    return { kind, title: baseTitle, chunks: [], chars: 0, truncated: false, mime: imageMime(name, bytes) }
  }
  if (kind === 'pdf') {
    const result = await extractPdf(bytes, { signal })
    return finish(kind, result.title || baseTitle, result.chunks, { pages: result.pages })
  }
  if (kind === 'docx') return finish(kind, baseTitle, (await extractDocx(bytes)).chunks)
  if (kind === 'pptx') {
    const result = await extractPptx(bytes)
    return finish(kind, baseTitle, result.chunks, { slides: result.slides })
  }
  const result = extractPlain(bytes, kind)
  return finish(kind, result.title || baseTitle, result.chunks)
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

export async function ingestUrl(address, { fetchImpl = pageFetch, signal } = {}) {
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
    const result = await ingestFile({ name: `${url.pathname.split('/').pop() || 'page'}.pdf`, bytes, signal })
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
  const body = article?.textContent || document.body?.textContent || ''
  const chunks = chunkText(body, { section: url.hostname })
  if (!chunks.length) throw new MaterialError('page-no-text', 'No readable text on this page')
  return finish('url', title, chunks, { url: url.href })
}
