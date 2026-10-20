import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const bundlePath = join(root, 'lib', 'client.js')
// The modules DSH's web frontend shares with plugins (its module registry
// lists react, react/jsx-runtime and react-dom with the platform packages).
const ALLOWED = new Set(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'])

function stubRequire(id) {
  if (!ALLOWED.has(id)) throw new Error(`client bundle required an undeclared module: ${id}`)
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : () => ({})) })
}

test('the client bundle loads through DSH\'s module loader and registers its surfaces', { skip: existsSync(bundlePath) ? false : 'lib/client.js is not built yet' }, () => {
  const source = readFileSync(bundlePath, 'utf8')
  const loads = []
  const sandbox = { window: { __ModuleLoader__: { load: spec => loads.push(spec) } }, console, setTimeout, clearTimeout }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(loads.length, 1)
  assert.equal(loads[0].id, 'dsh-aha-tutor')
  const exports = loads[0].factory(stubRequire)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'connection'])

  const registered = []
  const effects = []
  const injected = []
  const ctx = {
    effect: (fn, label) => effects.push({ label, dispose: fn() }),
    locale: { register: () => () => undefined, bind: () => key => key, getLocale: () => ({ active: 'zh' }) },
    get: name => (name === 'connection' ? { rpc: { call: async () => ({ ok: true, value: null }) } } : undefined),
    slots: {
      inject: (name, factory) => factory(),
      register: (spec, component) => {
        registered.push({ ...spec, component })
        return () => undefined
      },
    },
    inject: (names, callback) => injected.push({ names, callback }),
  }
  sandbox.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } }
  vm.runInContext('this.document = document', sandbox)
  exports.apply(ctx)
  const byName = name => registered.filter(entry => entry.name === name)
  assert.equal(byName('main')[0].key, 'aha-tutor')
  assert.equal(byName('sidebar.panellist')[0].id, 'aha-tutor')
  assert.equal(byName('sidebar.right.pane.tab')[0].key, 'dsh-aha-tutor/board')
  assert.deepEqual(byName('tool.call.toolview').map(entry => entry.key).sort(), ['aha_cheatsheet', 'aha_course', 'aha_learner', 'aha_quiz', 'aha_whiteboard'])
  assert.deepEqual(JSON.parse(JSON.stringify(injected.map(entry => entry.names))), [['sidebarRightTabs']])
  assert.ok(effects.some(effect => effect.label === 'aha-tutor: style'))
})

test('the About page carries the author links and both tip codes inside the bundle', { skip: existsSync(bundlePath) ? false : 'lib/client.js is not built yet' }, () => {
  const bundle = readFileSync(bundlePath, 'utf8')
  // The codes are data URLs, so the page needs neither a host route nor the network.
  for (const name of ['sponsor-wechat.png', 'sponsor-alipay.png']) {
    const png = readFileSync(join(root, 'src', 'ui', 'assets', name))
    assert.ok(png.length < 100 * 1024, `${name} stays small (${png.length} bytes)`)
    assert.ok(bundle.includes(`data:image/png;base64,${png.toString('base64').slice(0, 120)}`), `${name} is bundled as a data URL`)
  }
  assert.ok(bundle.includes('https://github.com/BaronCyrus/dsh-aha-tutor'))
  assert.ok(bundle.includes('BaronCyrus'))
})
