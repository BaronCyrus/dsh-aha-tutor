import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DOMParser } from 'linkedom'

import { chartSvg, escapeXml, niceTicks } from '../src/ui/charts.js'
import { animationDocument, sanitizeSvg } from '../src/ui/sanitize.js'
import { splitSentences } from '../src/ui/speech.js'
import { themedSvg, wrap } from '../src/ui/video.js'

test('svg sanitizer keeps drawing markup and strips anything active or external', () => {
  const dirty = `<svg viewBox="0 0 100 100" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><div>html</div></foreignObject>
    <circle cx="50" cy="50" r="20" fill="#2f6fde" onclick="steal()" style="stroke:red;background:url(http://x)"/>
    <a href="https://evil.example"><text x="1" y="2">link</text></a>
    <use href="https://evil.example/sprite.svg#a"/>
    <use href="#local"/>
    <rect width="10" height="10" fill="url(https://evil.example/x)"/>
    <path d="M0 0 L10 10" marker-end="url(#arrow)"/>
  </svg>`
  const clean = sanitizeSvg(dirty, { DOMParserImpl: DOMParser })
  assert.ok(clean)
  assert.doesNotMatch(clean, /script|foreignObject|onload|onclick|evil\.example|background/u)
  assert.match(clean, /<circle/u)
  assert.match(clean, /stroke:red/u)
  assert.match(clean, /href="#local"/u)
  assert.match(clean, /marker-end="url\(#arrow\)"/u)
  assert.equal(sanitizeSvg('<div>no</div>', { DOMParserImpl: DOMParser }), null)
  assert.equal(sanitizeSvg(42, { DOMParserImpl: DOMParser }), null)
})

test('animation documents get a no-network CSP in their head', () => {
  assert.match(animationDocument('<canvas></canvas><script>1</script>'), /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/u)
  const withHead = animationDocument('<!doctype html><html><head><title>x</title></head><body></body></html>')
  assert.ok(withHead.indexOf('Content-Security-Policy') < withHead.indexOf('<title>'))
})

test('charts are drawn from data with nice ticks and escaped labels', () => {
  assert.deepEqual(niceTicks(0, 9.3, 5), [0, 2, 4, 6, 8, 10])
  const flat = niceTicks(5, 5)
  assert.ok(flat.includes(5) && flat[0] < 5 && flat[flat.length - 1] > 5)
  const line = chartSvg({ kind: 'line', title: 'a<b', xLabel: 't', yLabel: 'x', series: [{ name: 's1', points: [[0, 0], [1, 1], [2, 4]] }, { name: 's2', points: [[0, 1], [2, 1]] }], data: [] })
  assert.match(line, /^<svg /u)
  assert.match(line, /a&lt;b/u)
  assert.equal((line.match(/<path /gu) ?? []).length, 2)
  const bar = chartSvg({ kind: 'bar', data: [{ label: 'A', value: 3 }, { label: 'B', value: -1 }], series: [] })
  assert.equal((bar.match(/<rect /gu) ?? []).length, 2)
  const pie = chartSvg({ kind: 'pie', data: [{ label: 'x', value: 1 }, { label: 'y', value: 3 }], series: [] })
  assert.match(pie, /75%/u)
  assert.equal(escapeXml(`"'&`), '&quot;&#39;&amp;')
})

test('narration is split into short sentences for every speech engine', () => {
  assert.deepEqual(splitSentences('第一句。第二句！Third one? last'), ['第一句。', '第二句！', 'Third one?', 'last'])
  const long = splitSentences('长'.repeat(400))
  assert.ok(long.length >= 3 && long.every(part => part.length <= 160))
})

test('video captions never start a line with closing punctuation', () => {
  // A fake canvas where every character is 10 px wide.
  const ctx = { measureText: value => ({ width: [...value].length * 10 }) }
  const lines = wrap(ctx, '弹簧越硬，振得越快；物体越重，振得越慢。', 50)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.doesNotMatch(line, /^[，。；]/u, lines.join(' | '))
  assert.equal(lines.join(''), '弹簧越硬，振得越快；物体越重，振得越慢。')
  // An opening bracket moves down with what it opens.
  const bracketed = wrap(ctx, '这是一个（括号）例子', 50)
  for (const line of bracketed) assert.doesNotMatch(line, /（$/u, bracketed.join(' | '))
  assert.equal(bracketed.join(''), '这是一个（括号）例子')
  assert.deepEqual(wrap(ctx, 'two words', 1000), ['two words'])
})

test('SVGs drawn into a video carry the board ink, recolored for the dark theme', () => {
  const palette = { ink: '#ecebe4' }
  const svg = chartSvg({ kind: 'line', title: 'T', xLabel: 't', yLabel: 'x', series: [{ name: 'a', points: [[0, 0], [1, 1]] }], data: [] })
  const dark = themedSvg(svg, palette, 'dark')
  assert.match(dark, /^<svg[^>]*><style>svg\{color:#ecebe4\}/u)
  assert.match(dark, /\[stroke="#2b2b2b"\],\[stroke="#23262f"\]\{stroke:#ecebe4\}/u)
  assert.doesNotMatch(themedSvg(svg, palette, 'light'), /stroke:#ecebe4/u)
  assert.ok(new DOMParser().parseFromString(dark, 'image/svg+xml').querySelector('style'))
  assert.equal(themedSvg('<svg/>', palette, 'dark'), '<svg/>')
  assert.equal(themedSvg(null, palette, 'dark'), null)
})
