import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import katex from 'katex'

import { parseInline } from '../src/ui/board/inline.js'

const DIR = new URL('../samples/', import.meta.url)
const packs = readdirSync(DIR)
  .filter(name => name.endsWith('.aha-course.json'))
  .map(name => ({ name, pack: JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) }))

// Everything the classroom renders through parseInline: captions come from
// the narration, the rest is written on the board.
function inlineTexts(board) {
  const texts = []
  for (const step of board.steps) {
    texts.push(step.say)
    for (const op of step.ops) {
      if (['title', 'h', 'p', 'note'].includes(op.t)) texts.push(op.text)
      if (op.t === 'page') texts.push(op.title)
      if (op.t === 'list') texts.push(...op.items)
      if (op.t === 'table') texts.push(...op.head, ...op.rows.flat())
    }
  }
  return texts.filter(text => typeof text === 'string')
}

// The client's KaTeX settings, except that a formula it cannot parse fails.
function render(tex, displayMode = false) {
  katex.renderToString(tex, { displayMode, throwOnError: true, strict: 'ignore', trust: false, maxSize: 20, maxExpand: 500 })
}

test('sample boards keep TeX inside formulas, and every formula renders', () => {
  assert.ok(packs.length >= 2)
  for (const { name, pack } of packs) {
    for (const board of Object.values(pack.boards)) {
      for (const text of inlineTexts(board)) {
        for (const segment of parseInline(text)) {
          if (segment.kind === 'math') assert.doesNotThrow(() => render(segment.tex), `${name}: $${segment.tex}$`)
          else assert.doesNotMatch(segment.text, /\\/u, `${name}: raw TeX in "${text}"`)
        }
      }
      for (const op of board.steps.flatMap(step => step.ops)) {
        if (op.t === 'math') assert.doesNotThrow(() => render(op.tex, true), `${name}: ${op.tex}`)
      }
    }
  }
})
