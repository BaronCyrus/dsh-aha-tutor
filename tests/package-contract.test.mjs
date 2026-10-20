import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import { BOARD_FONT_FILES } from '../src/core/board-fonts.js'
import { en, zh } from '../src/ui/i18n.js'
import { STYLE } from '../src/ui/styles.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function walk(dir, pattern, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, pattern, out)
    else if (pattern.test(name)) out.push(full)
  }
  return out
}

test('manifest declares the DSH bundle, client entry and sub-entry for the preset tools', () => {
  assert.equal(manifest.name, 'dsh-aha-tutor')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.exports['./agent'], './lib/agent.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(range, '>=0.2.1-rc.1 <0.3.0-0', `${name} peer range`)
  }
  for (const entry of manifest.files.filter(entry => !entry.includes('*') && !entry.startsWith('lib/'))) {
    assert.ok(existsSync(join(root, entry)), `${entry} is listed in files but missing`)
  }
  const compatibility = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8'))
  assert.equal(compatibility.acceptedRuntimeRange, '>=0.2.1-rc.1 <0.3.0-0')
})

test('the plugin page can read the icon and the display text in both languages', () => {
  // DSH reads metadata without running the plugin: an icon over 256 KiB is
  // dropped with an error, and locale files are matched by language id the
  // way DSH's own packages name them (en.json, zh.json).
  const icon = readFileSync(join(root, manifest.icon))
  assert.ok(icon.length <= 256 * 1024, `icon is ${icon.length} bytes, over DSH's 256 KiB limit`)
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'icon is a PNG')
  assert.deepEqual(readdirSync(join(root, 'locale')).sort(), ['en.json', 'zh.json'])
  for (const name of ['en.json', 'zh.json']) {
    const { meta } = JSON.parse(readFileSync(join(root, 'locale', name), 'utf8'))
    assert.ok(meta.title.trim() && meta.description.trim(), `${name} has meta.title and meta.description`)
  }
  assert.ok(manifest.files.includes('locale/*.json') && manifest.exports['./locale/*.json'] === './locale/*.json')
})

test('every runtime-imported @deepseek-ai package is a peer, never a bundled copy', () => {
  const sources = walk(join(root, 'src'), /\.(js|jsx)$/u).map(file => readFileSync(file, 'utf8')).join('\n')
  const imported = new Set([...sources.matchAll(/from '(@deepseek-ai\/[^'/]+)/gu)].map(match => match[1]))
  for (const name of imported) assert.ok(manifest.peerDependencies[name], `${name} must be a peer dependency`)
  const config = readFileSync(join(root, 'tsdown.config.mjs'), 'utf8')
  for (const name of imported) assert.ok(config.includes(`'${name}'`), `${name} must be external in tsdown.config.mjs`)
})

test('the patch inserts the host row and a teacher preset that keeps compaction and stays read-only', () => {
  const patch = parse(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
  const rows = patch.flatMap(entry => entry.insert ?? [])
  assert.ok(rows.some(row => row.id === 'aha-tutor' && row.name === 'dsh-aha-tutor'))
  const preset = rows.find(row => row.id === 'preset-aha-tutor')
  assert.equal(preset.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(preset.config.id, 'aha-tutor')
  const plugins = preset.config.plugins
  assert.ok(plugins.some(plugin => plugin.name === 'dsh-aha-tutor/agent'), 'teaching tools are mounted')
  assert.ok(plugins.some(plugin => plugin.id === 'compaction' && plugin.group === true), 'compaction keeps long sessions alive')
  const fs = plugins.find(plugin => plugin.name === '@deepseek-ai/dsh-tool-fs')
  assert.equal(fs.config.write, false)
  assert.equal(fs.config.edit, false)
  assert.ok(!plugins.some(plugin => /tool-bash|tool-pwsh/u.test(plugin.name)), 'no shell in the tutor preset')
  const persona = plugins.find(plugin => plugin.id === 'persona').config.prefix
  // Unknown {{variables}} make DSH's prompt rendering fail.
  assert.deepEqual([...persona.matchAll(/\{\{(\w+)\}\}/gu)].map(match => match[1]), ['model'])
})

test('every UI string key exists in both languages', () => {
  const sources = walk(join(root, 'src'), /\.(js|jsx)$/u).map(file => readFileSync(file, 'utf8')).join('\n')
  const used = new Set([...sources.matchAll(/\bt\('([A-Za-z0-9_-]+)'/gu)].map(match => match[1]))
  const missingZh = [...used].filter(key => !(key in zh))
  const missingEn = [...used].filter(key => !(key in en))
  assert.deepEqual(missingZh, [], 'missing in zh')
  assert.deepEqual(missingEn, [], 'missing in en')
  assert.deepEqual(Object.keys(zh).filter(key => !(key in en)), [], 'zh keys missing in en')
})

// The string literals the first argument of each matching call can take: the
// codes an error is made with, even behind a condition.
function firstArgumentLiterals(source, pattern) {
  const codes = []
  for (const match of source.matchAll(pattern)) {
    let depth = 0
    let quote = null
    let argument = ''
    for (let index = match.index + match[0].length; index < source.length; index += 1) {
      const char = source[index]
      if (quote) {
        if (char === quote && source[index - 1] !== '\\') quote = null
      } else if (char === '\'' || char === '"' || char === '`') {
        quote = char
      } else if ('([{'.includes(char)) {
        depth += 1
      } else if (')]}'.includes(char) || char === ',') {
        if (depth === 0) break
        if (char !== ',') depth -= 1
      }
      argument += char
    }
    codes.push(...[...argument.matchAll(/'([a-z-]+)'/gu)].map(found => found[1]))
  }
  return codes
}

test('every error the browser can show has a message in both languages', () => {
  const host = walk(join(root, 'src', 'host'), /\.js$/u).map(file => readFileSync(file, 'utf8')).join('\n')
  const ui = walk(join(root, 'src', 'ui'), /\.(js|jsx)$/u).map(file => readFileSync(file, 'utf8')).join('\n')
  const llm = readFileSync(join(root, 'src', 'host', 'llm.js'), 'utf8')
  const pack = readFileSync(join(root, 'src', 'core', 'coursepack.js'), 'utf8')
  const codes = new Set([
    ...firstArgumentLiterals(host, /new (?:TutorError|MaterialError)\(/gu),
    // The course pack reader's codes, passed on by courses.importPack().
    ...firstArgumentLiterals(pack, /\bpackError\(/gu),
    // publicCode() keeps speech errors apart.
    ...firstArgumentLiterals(host, /new TtsError\(/gu).map(code => `tts-${code}`),
    ...firstArgumentLiterals(host, /\bfailure\(/gu),
    ...[...llm.matchAll(/^ {2}[A-Z_]+: \['([a-z-]+)'/gmu)].map(match => match[1]),
    ...firstArgumentLiterals(ui, /new ApiError\(/gu),
    ...[...ui.matchAll(/\bcode: '([a-z-]+)'/gu)].map(match => match[1]),
    // publicCode()'s fallback, and a cancelled job.
    'failed',
    'cancelled',
  ])
  for (const code of ['no-board', 'bad-pack', 'pack-too-new', 'llm-auth', 'llm-missing', 'tts-auth', 'tts-network', 'tts-failed', 'connection', 'playback', 'forbidden']) assert.ok(codes.has(code), `found ${code}`)
  const missing = [...codes].filter(code => !(`err_${code}` in zh) || !(`err_${code}` in en))
  assert.deepEqual(missing, [])
})

test('every endpoint the browser calls is routed on the host', async () => {
  const sources = walk(join(root, 'src', 'ui'), /\.(js|jsx)$/u).map(file => readFileSync(file, 'utf8')).join('\n')
  const called = new Set([...sources.matchAll(/api\.(?:call|run)\('([a-z/-]+)'/gu)].map(match => match[1]))
  const { createRoutes } = await import('../src/host/rpc.js')
  const routes = createRoutes({})
  const extra = ['app/info', 'samples/list', 'samples/import']
  const missing = [...called].filter(endpoint => !(endpoint in routes) && !extra.includes(endpoint))
  assert.deepEqual(missing, [])
  assert.ok(called.size > 40)
})

test('the bundled KaTeX matches the stylesheet DSH loads', async () => {
  // DSH 0.2.1 styles formulas with KaTeX 0.18.7's stylesheet; markup from
  // another KaTeX version uses class names that stylesheet does not know.
  assert.equal(manifest.devDependencies.katex, '0.18.7')
  const { default: katex } = await import('katex')
  assert.equal(katex.version, '0.18.7')
  const html = katex.renderToString('a^2 \\neq 0', { throwOnError: false, strict: 'ignore', trust: false, output: 'html' })
  for (const name of ['katex-base', 'katex-strut', 'katex-sizing', 'katex-thinbox', 'katex-inner']) assert.ok(html.includes(name), name)
})

test('the board fonts ship with their licenses, stay small and are all declared', () => {
  assert.ok(manifest.files.includes('assets/fonts/*'))
  let total = 0
  for (const entry of BOARD_FONT_FILES) {
    const path = join(root, 'assets', 'fonts', entry.file)
    assert.ok(existsSync(path), `${entry.file} is missing`)
    assert.equal(statSync(path).size, entry.bytes, `${entry.file} differs from the manifest`)
    total += entry.bytes
    assert.ok(STYLE.includes(`api/aha-tutor/font?f=${entry.file}`), `${entry.file} has an @font-face rule`)
  }
  for (const license of ['OFL-LXGWWenKaiGB.txt', 'OFL-Caveat.txt']) assert.ok(existsSync(join(root, 'assets', 'fonts', license)), `${license} ships with the fonts`)
  assert.ok(total < 2.5 * 1024 * 1024, `the fonts add ${total} bytes`)
  assert.deepEqual([...new Set(BOARD_FONT_FILES.map(entry => entry.family))], ['Aha Hand Latin', 'Aha Hand'])
  assert.equal(readdirSync(join(root, 'assets', 'fonts')).filter(name => name.endsWith('.woff2')).length, BOARD_FONT_FILES.length, 'no stray font files')
})
