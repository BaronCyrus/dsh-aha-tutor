import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'

import { parseReleaseNotes, readReleaseNotes } from '../scripts/release-notes.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url))
const NOT_ON_DISPATCH = "github.event_name != 'workflow_dispatch'"
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const workflow = name => parse(read(`.github/workflows/${name}`))
const NOTES = '# v1.0.1：修复导入课程包\n\n修复说明。\n\n在 DSH 插件管理中更新至 **1.0.1**，然后重新打开 DSH 加载新版。\n'

test('every release notes file names its own version and tells readers to update to it', () => {
  const files = readdirSync(new URL('../docs/releases/', import.meta.url)).filter(name => name.endsWith('.md'))
  assert.ok(files.length > 0)
  for (const name of files) {
    const version = /^v(\d+\.\d+\.\d+)\.md$/u.exec(name)?.[1]
    assert.ok(version, `${name}: notes are named v<version>.md`)
    const { title, body } = readReleaseNotes(version)
    assert.match(title, new RegExp(`^v${version.replaceAll('.', '\\.')}：\\S`, 'u'), name)
    assert.ok(body.includes(`**${version}**`), name)
  }
})

test('the version in package.json has its notes and a changelog entry before it can be tagged', () => {
  const { version } = JSON.parse(read('package.json'))
  assert.doesNotThrow(() => readReleaseNotes(version), `write docs/releases/v${version}.md`)
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`, 'mu'), `add ## ${version} to CHANGELOG.md`)
})

test('notes split into the release title and body', () => {
  assert.deepEqual(parseReleaseNotes(NOTES, '1.0.1'), {
    title: 'v1.0.1：修复导入课程包',
    body: '修复说明。\n\n在 DSH 插件管理中更新至 **1.0.1**，然后重新打开 DSH 加载新版。\n',
  })
  assert.equal(parseReleaseNotes(NOTES.replaceAll('\n', '\r\n'), '1.0.1').title, 'v1.0.1：修复导入课程包')
})

test('malformed or mismatched notes are refused with the reason', () => {
  const cases = [
    [NOTES.replace('# v1.0.1：', '# v1.0.1: '), /must start with "# v1\.0\.1：<title>"/u],
    [NOTES.replace('# v1.0.1：修复导入课程包', '# v1.0.1：'), /must start with/u],
    [NOTES.replace('# v1.0.1：', '# v1.0.0：'), /titled v1\.0\.0, not v1\.0\.1/u],
    ['# v1.0.1：标题\n\n   \n', /have no body/u],
    [NOTES.replace('**1.0.1**', '**1.0.0**'), /update to \*\*1\.0\.1\*\*/u],
    ['修复说明。', /must start with/u],
  ]
  for (const [text, reason] of cases) assert.throws(() => parseReleaseNotes(text, '1.0.1'), reason)
  assert.throws(() => parseReleaseNotes(NOTES, 'v1.0.1'), /plain version/u)
  assert.throws(() => readReleaseNotes('0.0.0'), /docs\/releases\/v0\.0\.0\.md is missing/u)
})

test('the script prints the title, writes the body, and exits 1 on missing notes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aha-release-notes-'))
  try {
    const bodyFile = join(directory, 'body.md')
    const { version } = JSON.parse(read('package.json'))
    const title = execFileSync(process.execPath, [SCRIPT, version, '--body-file', bodyFile], { encoding: 'utf8' })
    const notes = readReleaseNotes(version)
    assert.equal(title, `${notes.title}\n`)
    assert.equal(readFileSync(bodyFile, 'utf8'), notes.body)
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, '0.0.0'], { stdio: 'pipe' }), error => error.status === 1 && /is missing/u.test(String(error.stderr)))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a tag checks its notes before npm publishes, then hands the published tarball on', () => {
  const steps = workflow('publish.yml').jobs.publish.steps
  const at = name => {
    const index = steps.findIndex(step => step.name === name)
    assert.ok(index >= 0, `the publish job has "${name}"`)
    return index
  }
  const notes = steps[at('Refuse a tag without its GitHub Release notes')]
  assert.equal(notes.if, NOT_ON_DISPATCH)
  assert.match(notes.run, /node scripts\/release-notes\.mjs "\$\{GITHUB_REF_NAME#v\}"/u)
  assert.ok(at('Refuse a tag without its GitHub Release notes') < at('Publish'), 'notes are checked before npm publishes')
  assert.ok(at('Test') < at('Publish') && at('Verify committed lib/ matches a fresh build of src/') < at('Publish'))

  // A version npm already serves (the first one, published by hand) is
  // released from npm's own tarball instead of being published again.
  const registry = steps[at('Find out whether npm already serves this version')]
  assert.equal(registry.id, 'registry')
  assert.ok(at('Find out whether npm already serves this version') < at('Publish'))
  assert.equal(steps[at('Publish')].if, `${NOT_ON_DISPATCH} && steps.registry.outputs.published != 'true'`)
  const reuse = steps[at('Use the tarball npm already serves')]
  assert.equal(reuse.if, `${NOT_ON_DISPATCH} && steps.registry.outputs.published == 'true'`)
  assert.match(reuse.run, /npm pack "dsh-aha-tutor@\$\{version:\?\}" --pack-destination \.artifacts/u)

  const handOff = steps[at('Hand the published tarball to the release job')]
  assert.ok(at('Publish') < at('Hand the published tarball to the release job') && at('Use the tarball npm already serves') < at('Hand the published tarball to the release job'))
  assert.equal(handOff.if, NOT_ON_DISPATCH)
  assert.equal(handOff.uses, 'actions/upload-artifact@v4')
  assert.equal(handOff.with.path, '.artifacts/dsh-aha-tutor-*.tgz')
  // The action skips files under a dot directory such as .artifacts by default.
  assert.equal(handOff.with['include-hidden-files'], true)
  assert.equal(handOff.with['if-no-files-found'], 'error')
})

test('only the release job may write, and it runs no dependency code', () => {
  const { permissions, jobs } = workflow('publish.yml')
  assert.deepEqual(permissions, { 'id-token': 'write', contents: 'read' }, 'the publish job keeps read-only contents')
  assert.equal(jobs.publish.permissions, undefined)
  const release = jobs.release
  assert.equal(release.needs, 'publish')
  assert.equal(release.if, "github.event_name == 'push'", 'only a tag push creates a release')
  assert.deepEqual(release.permissions, { contents: 'write' })
  assert.deepEqual(release.steps.filter(step => step.uses).map(step => step.uses), ['actions/checkout@v4', 'actions/setup-node@v4', 'actions/download-artifact@v4'])
  assert.equal(release.steps[0].with['persist-credentials'], false)
  assert.equal(release.steps[2].with.name, jobs.publish.steps.find(step => step.name === 'Hand the published tarball to the release job').with.name)
  for (const step of release.steps.filter(step => step.run)) {
    assert.doesNotMatch(step.run, /\bpnpm\b|\bnpm (?:install|ci|exec)\b|\bnpx\b/u, `${step.name}: no dependency code runs with a write token`)
  }
  const create = release.steps.find(step => step.name === 'Create the release with the tarball npm published')
  assert.equal(create.env.GH_TOKEN, '${{ github.token }}')
  assert.match(create.run, /artifact="\.artifacts\/dsh-aha-tutor-\$\{version:\?\}\.tgz"/u)
  assert.match(create.run, /title="\$\(node scripts\/release-notes\.mjs "\$version" --body-file "\$notes"\)"/u)
  assert.match(create.run, /gh release create "\$GITHUB_REF_NAME" "\$artifact" --verify-tag --latest --title "\$title" --notes-file "\$notes"/u)
  assert.match(create.run, /if gh release view "\$GITHUB_REF_NAME"/u, 'a release made by hand is left unchanged')
  const writers = Object.entries(jobs).filter(([, job]) => job.permissions?.contents === 'write').map(([name]) => name)
  assert.deepEqual(writers, ['release'])
})

test('nothing in the workflows switches npm from OIDC to token auth', () => {
  for (const name of ['publish.yml', 'ci.yml']) {
    const text = read(`.github/workflows/${name}`)
    for (const job of Object.values(workflow(name).jobs)) {
      for (const step of job.steps) {
        assert.equal(step.with?.['registry-url'], undefined, `${name}: ${step.name ?? step.uses}: setup-node registry-url means token auth`)
        assert.equal(step.env?.NODE_AUTH_TOKEN, undefined)
      }
    }
    assert.doesNotMatch(text, /NODE_AUTH_TOKEN:|secrets\./u, name)
  }
})

test('CI tests on every system the plugin runs on', () => {
  const { jobs } = workflow('ci.yml')
  assert.deepEqual(jobs.test.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest'])
  assert.equal(jobs.test.strategy['fail-fast'], false)
  assert.ok(jobs.test.steps.some(step => step.run === 'pnpm run test'))
})

test('no source file overrides the pnpm release-age policy', () => {
  const files = []
  const walk = url => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url)
      if (entry.isDirectory()) walk(child)
      else if (/\.(?:m?js|jsx)$/u.test(entry.name)) files.push(child)
    }
  }
  walk(new URL('../src/', import.meta.url))
  assert.ok(files.length > 10)
  for (const file of files) {
    // Comments may say what the update never does; code may not do it.
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
    assert.doesNotMatch(code, /minimumReleaseAgeExclude|--config\.minimumReleaseAge|['"`]--force['"`]/u, fileURLToPath(file))
  }
})
