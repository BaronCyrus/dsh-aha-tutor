import assert from 'node:assert/strict'
import { test } from 'node:test'

import { en, zh } from '../src/ui/i18n.js'
import { CLASS_SCREENS, foldNav, NAV_NARROW, navState, tipPlace } from '../src/ui/nav.js'
import { STYLE } from '../src/ui/styles.js'

test('the navigation shows its names until the learner folds it; a narrow page shows icons', () => {
  assert.equal(navState({ choice: 'open', narrow: false, peek: false }), 'open')
  assert.equal(navState({ choice: undefined, narrow: false, peek: false }), 'open', 'a first visit shows the names, whatever the width')
  assert.equal(navState({ choice: 'folded', narrow: false, peek: false }), 'folded')
  assert.equal(navState({ choice: 'open', narrow: true, peek: false }), 'folded', 'a narrow page has no room for the names')
  assert.equal(navState({ choice: 'folded', narrow: true, peek: true }), 'peek')
  assert.equal(navState({ choice: 'folded', narrow: false, peek: true }), 'folded', 'only a narrow page opens it over itself')
  assert.equal(NAV_NARROW, 640)
})

test('the fold button flips the learner\'s choice, or opens a narrow page\'s navigation over it for once', () => {
  assert.deepEqual(foldNav({ choice: 'open', narrow: false, peek: false }), { choice: 'folded', peek: false })
  assert.deepEqual(foldNav({ choice: 'folded', narrow: false, peek: false }), { choice: 'open', peek: false })
  assert.deepEqual(foldNav({ choice: 'open', narrow: true, peek: false }), { choice: 'open', peek: true }, 'the choice for wider pages stays')
  assert.deepEqual(foldNav({ choice: 'folded', narrow: true, peek: true }), { choice: 'folded', peek: false })
})

test('a class folds the navigation to leave the board room, and the pages after it show the learner\'s choice', () => {
  assert.deepEqual(CLASS_SCREENS, ['lesson', 'assist', 'shorts'])
  assert.equal(navState({ choice: 'open', narrow: false, inClass: true, peek: false }), 'folded')
  assert.equal(navState({ choice: 'open', narrow: false, inClass: false, peek: false }), 'open', 'back to the choice once the class is left')
  assert.equal(navState({ choice: 'folded', narrow: false, inClass: false, peek: false }), 'folded')
  // In class, » opens the navigation over the board and leaves the choice alone.
  assert.deepEqual(foldNav({ choice: 'open', narrow: false, inClass: true, peek: false }), { choice: 'open', peek: true })
  assert.equal(navState({ choice: 'open', narrow: false, inClass: true, peek: true }), 'peek')
  assert.deepEqual(foldNav({ choice: 'folded', narrow: false, inClass: true, peek: true }), { choice: 'folded', peek: false })
})

test('a folded icon\'s name sits beside the icon, centred on it, in the page\'s coordinates', () => {
  assert.deepEqual(tipPlace({ top: 158, height: 32, right: 336 }, { top: 100, left: 280 }), { top: 74, left: 64 })
})

test('the page width no longer folds the navigation; data-nav does', () => {
  assert.doesNotMatch(STYLE, /@container aha[^\n]*\.aha-nav/u, 'a window of medium width used to hide the names')
  assert.match(STYLE, /^\.aha-nav\{flex:0 0 auto;width:max-content;min-width:188px;/mu, 'the navigation is as wide as its longest name')
  assert.match(STYLE, /^\.aha\[data-nav=folded\] :is\(\.aha-navItem span,\.aha-brand small,\.aha-brand span\)\{display:none\}$/mu)
  assert.match(STYLE, /^\.aha\[data-nav=peek\] \.aha-nav\{position:absolute;/mu, 'opened over a narrow page')
  assert.match(STYLE, /^\.aha\[data-nav=peek\]\{padding-left:56px\}$/mu, 'the page stays where the icon column left it')
  assert.match(STYLE, /^\.aha-navFold\{margin-top:auto;/mu, 'the fold button sits at the foot')
  for (const key of ['navFold', 'navUnfold']) assert.ok(zh[key] && en[key], key)
})
