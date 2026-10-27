import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { cleanPrefs, PREF_DEFAULTS } from '../src/host/settings.js'
import { en, zh } from '../src/ui/i18n.js'
import { STYLE } from '../src/ui/styles.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const rule = selector => STYLE.split('\n').find(line => line.startsWith(`${selector}{`)) ?? ''

test('the text size is a setting: standard, large or extra large', () => {
  assert.equal(PREF_DEFAULTS.textSize, 'standard')
  assert.equal(cleanPrefs({ textSize: 'larger' }).textSize, 'larger')
  assert.equal(cleanPrefs({ textSize: 'huge' }).textSize, 'standard')
  assert.equal(cleanPrefs({ voiceRate: 1.2 }, { ...PREF_DEFAULTS, textSize: 'large' }).textSize, 'large', 'other saves keep it')
  for (const key of ['textSize', 'textStandard', 'textLarge', 'textLarger', 'textSizeHint']) assert.ok(zh[key] && en[key], key)
})

test('the page\'s text grows with DSH\'s font size and with the plugin\'s text size', () => {
  assert.match(rule('.aha'), /--aha-px:calc\(var\(--dsh-content-font-size,14px\)\/14\*var\(--aha-text-scale\)\)/u)
  assert.match(STYLE, /^ {2}position:relative;display:flex;[^\n]*font-size:calc\(15\*var\(--aha-px\)\);/mu, 'body text is 15px at DSH\'s default 14px')
  assert.equal(rule('.aha[data-text=large]'), '.aha[data-text=large]{--aha-text-scale:1.15}')
  assert.equal(rule('.aha[data-text=larger]'), '.aha[data-text=larger]{--aha-text-scale:1.3}')
  assert.equal(rule('.aha[data-text=dsh]'), '.aha[data-text=dsh]{--aha-text-scale:calc(14/15)}', 'cards in a conversation match DSH\'s text')
  assert.match(rule('.aha-hint'), /font-size:calc\(13\.5\*var\(--aha-px\)\)/u, 'hints were 12.5px')
  assert.match(rule('.aha-itemPrompt'), /font-size:calc\(16\*var\(--aha-px\)\)/u, 'a question\'s prompt was 13px')
})

test('text in the plugin\'s pages has no fixed size; the board, the mind map, exports and printouts keep theirs', () => {
  const ownSizes = /^(?:\.aha-map|\.aha-board|\.aha-op|\.aha-figCaption|\.aha-plotSlider|\.aha-fixed|\.aha-pager|\.aha-canvasBar|\.aha-exportFoot|@media print)/u
  const fixed = STYLE.split('\n').filter(line => /(?:font-size|line-height):[\d.]+px/u.test(line) && !ownSizes.test(line))
  assert.deepEqual(fixed.map(line => line.slice(0, 40)), [])
  assert.match(STYLE, /@media print\{\.aha-handout\{[^}]*font-size:12\.5px;line-height:19px;[^}]*\}\.aha-handout h2\{font-size:22px;line-height:30px\}/u, 'a printed handout looks as before')
})

test('DSH\'s Markdown takes the size and colour of the text around it', () => {
  // Its compact variant (prompts, options, feedback) was a caption-grey 13px.
  assert.match(STYLE, /^\.aha-markdown>div\{font-size:inherit;line-height:inherit;color:inherit\}$/mu)
  assert.match(STYLE, /^\.aha \.aha-markdown>div:not\(\[data-markdown-variant\]\) h2\{font-size:1\.36em\}$/mu, 'headings keep DSH\'s proportions')
  assert.doesNotMatch(rule('.aha-markdown'), /font-size:14px/u)
})

test('a flashcard is set large and is as tall as its longer side', () => {
  assert.match(rule('.aha-flashFace'), /^\.aha-flashFace\{grid-area:1\/1;/u)
  assert.doesNotMatch(rule('.aha-flashFace'), /position:absolute/u, 'a long answer used to spill out of the card')
  assert.match(rule('.aha-flashFace'), /font-size:calc\(22\*var\(--aha-px\)\)/u)
  assert.match(rule('.aha-flashInner'), /display:grid;min-height:calc\(240\*var\(--aha-px\)\)/u)
})

test('the conversation\'s board tab is not dressed as a course tab, and its cards keep DSH\'s size', () => {
  // `.aha-tab` (the course page's tabs) made the whole board tab grey and unwrapped.
  const source = readFileSync(join(root, 'src', 'ui', 'conversation.jsx'), 'utf8')
  assert.doesNotMatch(source, /className="aha aha-tab"/u)
  assert.match(source, /className="aha aha-boardTab" data-text=\{textSize\}/u)
  assert.match(source, /className="aha aha-card" data-text="dsh"/u)
})
