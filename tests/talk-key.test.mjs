import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTalkKey, HOLD_MS, isTalkKey, typingInto } from '../src/ui/talk-key.js'
import { en, zh } from '../src/ui/i18n.js'

test('V held while speaking ends the recording when it comes up; a tap leaves it on until the next press', () => {
  const key = createTalkKey()
  // Held: down starts, up after the hold time stops.
  assert.equal(key.down('idle', 1000), 'start')
  assert.equal(key.up('recording', 1000 + HOLD_MS + 400), 'stop')
  // Tapped: up right away does nothing; the next press stops.
  assert.equal(key.down('idle', 5000), 'start')
  assert.equal(key.up('recording', 5000 + 120), null)
  assert.equal(key.down('recording', 9000), 'stop')
  assert.equal(key.up('working', 9080), null, 'the release of a stopping press is nothing')
  // Held while the microphone is still opening: stopped once it is open.
  assert.equal(key.down('idle', 12000), 'start')
  assert.equal(key.up('starting', 12000 + HOLD_MS), 'stop')
  // Nothing while the words are being recognized.
  assert.equal(key.down('working', 15000), null)
  assert.equal(key.up('working', 16000), null)
  // A release without a press (the press went elsewhere) is nothing.
  assert.equal(createTalkKey().up('recording', 100), null)
})

test('the key is V alone, and never while typing', () => {
  assert.ok(isTalkKey({ key: 'v' }))
  assert.ok(isTalkKey({ key: 'V', shiftKey: true }))
  for (const event of [{ key: 'v', metaKey: true }, { key: 'v', ctrlKey: true }, { key: 'v', altKey: true }, { key: 'b' }, { key: ' ' }, null]) assert.equal(isTalkKey(event), false, JSON.stringify(event))
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'textarea']) assert.ok(typingInto({ tagName }), tagName)
  assert.ok(typingInto({ tagName: 'DIV', isContentEditable: true }), 'a rich text box, such as a conversation\'s')
  for (const target of [{ tagName: 'BUTTON' }, { tagName: 'DIV' }, { tagName: 'BODY' }, {}, null]) assert.equal(typingInto(target), false)
  for (const key of ['talkKeyHint', 'raiseHandKey']) assert.match(`${zh[key]} ${en[key]}`, /V.*V/u, `${key} names the key in both languages`)
  assert.match(zh.tourRaise, /按住 V/u)
  assert.match(en.tourRaise, /hold V/u)
})
