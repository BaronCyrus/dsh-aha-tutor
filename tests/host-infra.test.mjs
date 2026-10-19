import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { createJobs } from '../src/host/jobs.js'
import { streamCounter } from '../src/host/generate.js'
import { compareSemver, createPluginManager, findInstall, releaseAgeRefusal, resolveLauncher } from '../src/host/plugin-version.js'
import { createStore, resolveDshHome } from '../src/host/store.js'
import { checkEndpoint, createTts, splitForTts, TtsError } from '../src/host/tts.js'

const temp = () => mkdtemp(join(tmpdir(), 'aha-tutor-test-'))

test('store writes atomically, serializes updates and rejects unsafe ids', async () => {
  const root = await temp()
  try {
    const store = createStore({ root })
    const path = store.paths.course('crs_abcdef123')
    await store.writeJson(path, { n: 0 })
    await Promise.all(Array.from({ length: 20 }, () => store.updateJson(path, { n: 0 }, value => ({ n: value.n + 1 }))))
    assert.deepEqual(await store.readJson(path), { n: 20 })
    assert.equal(await store.readJson(store.paths.course('crs_missing00'), 'none'), 'none')
    assert.throws(() => store.paths.course('../../etc'), /invalid/)
    assert.throws(() => store.paths.board('crs_abcdef123', 'crs_abcdef123'), /invalid/)
    assert.deepEqual(await store.listIds(store.paths.courses(), 'crs'), ['crs_abcdef123'])
    await store.removeDir(store.paths.courseDir('crs_abcdef123'))
    assert.deepEqual(await store.listIds(store.paths.courses(), 'crs'), [])
    assert.equal(resolveDshHome({ DSH_HOME: 'X:\\dsh' }), 'X:\\dsh')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('jobs report progress and partial results, dedupe by key and cancel', async () => {
  const jobs = createJobs()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const started = jobs.start('lesson', async api => {
    api.progress(1, 3, 'writing')
    api.push({ step: 1 })
    await gate
    return { ok: true }
  }, { key: 'lesson:x' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(jobs.start('lesson', async () => 'again', { key: 'lesson:x' }).id, started.id)
  const mid = jobs.get(started.id)
  assert.equal(mid.progress.label, 'writing')
  assert.deepEqual(mid.partial, [{ step: 1 }])
  assert.deepEqual(jobs.get(started.id, { since: 1 }).partial, [])
  release()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(jobs.get(started.id).result, { ok: true })

  const slow = jobs.start('slow', api => new Promise((_, reject) => api.signal.addEventListener('abort', () => reject(new Error('stop')))))
  jobs.cancel(slow.id)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(jobs.get(slow.id).status, 'cancelled')
  const failing = jobs.start('fail', async () => { throw new Error('secret internal detail') })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(jobs.get(failing.id).error.message, 'Generation failed')

  // Regenerating replaces a running job: a cancelled job is never reused.
  const first = jobs.start('board', api => new Promise((_, reject) => api.signal.addEventListener('abort', () => reject(new Error('stop')))), { key: 'board:y' })
  assert.equal(jobs.running('board:y').id, first.id)
  jobs.cancelKey('board:y')
  assert.equal(jobs.running('board:y'), null)
  const second = jobs.start('board', async () => 'fresh', { key: 'board:y' })
  assert.notEqual(second.id, first.id)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(jobs.get(first.id).status, 'cancelled')
  assert.equal(jobs.get(first.id).error.code, 'cancelled', 'a cancelled job does not read as a failure')
  assert.equal(jobs.get(second.id).result, 'fresh')
})

test('TTS splits long text, calls each provider correctly and caches audio', async () => {
  assert.deepEqual(splitForTts('短句。', 900), ['短句。'])
  const parts = splitForTts('第一句话很长。'.repeat(80), 900)
  assert.ok(parts.length > 1 && parts.every(part => [...part].length * 3 <= 900))
  assert.throws(() => checkEndpoint('http://example.com'), TtsError)
  assert.equal(checkEndpoint('http://localhost:8880/v1').port, '8880')

  const root = await temp()
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const host = new URL(String(url)).hostname
    if (host === 'openspeech.bytedance.com') return Response.json({ code: 3000, data: Buffer.from('VOLC').toString('base64') })
    if (host === 'api.minimaxi.com') return Response.json({ base_resp: { status_code: 0 }, data: { audio: Buffer.from('MINI').toString('hex') } })
    if (host.endsWith('.tts.speech.microsoft.com')) return new Response(Buffer.from('AZURE'), { status: 200 })
    if (String(url).includes('bad-key')) return new Response('', { status: 401 })
    return new Response(Buffer.from('OPENAI'), { status: 200 })
  }
  try {
    const tts = createTts({ cacheDir: root, fetchImpl, getSecret: async () => 'sk-test' })
    const openai = await tts.synthesize({ provider: 'openai', config: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'm', voice: 'v' }, text: '你好', rate: 1.2 })
    assert.equal(openai.audio.toString(), 'OPENAI')
    assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/audio/speech')
    assert.equal(JSON.parse(calls[0].init.body).speed, 1.2)
    assert.equal(calls[0].init.redirect, 'error')
    const again = await tts.synthesize({ provider: 'openai', config: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'm', voice: 'v' }, text: '你好', rate: 1.2 })
    assert.equal(again.cached, true)
    assert.equal(calls.length, 1)

    assert.equal((await tts.synthesize({ provider: 'volcengine', config: { appId: 'app' }, text: '你好' })).audio.toString(), 'VOLC')
    assert.equal(calls[1].init.headers.Authorization, 'Bearer;sk-test')
    assert.equal(JSON.parse(calls[1].init.body).app.appid, 'app')
    assert.equal((await tts.synthesize({ provider: 'minimax', config: { groupId: 'g1' }, text: '你好' })).audio.toString(), 'MINI')
    assert.match(calls[2].url, /GroupId=g1/)
    assert.equal((await tts.synthesize({ provider: 'azure', config: { region: 'eastasia' }, text: '<b>&' })).audio.toString(), 'AZURE')
    assert.match(calls[3].init.body, /&lt;b&gt;&amp;/)
    await assert.rejects(tts.synthesize({ provider: 'openai', config: { baseUrl: 'https://bad-key.example/v1' }, text: 'x' }), error => error.code === 'auth')
    await assert.rejects(tts.synthesize({ provider: 'volcengine', config: {}, text: 'x' }), /App ID/)
    const noKey = createTts({ cacheDir: null, fetchImpl, getSecret: async () => undefined })
    await assert.rejects(noKey.synthesize({ provider: 'azure', text: 'x' }), /No key/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('plugin update follows the cooldown rules', async () => {
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1)
  assert.equal(releaseAgeRefusal('ERR_PNPM_OTHER', Date.now()), undefined)
  const finishedAt = Date.parse('2026-10-18T12:00:00Z')
  const refusal = releaseAgeRefusal('\u001b[31mERR_PNPM_NO_MATURE_MATCHING_VERSION\u001b[0m dsh-aha-tutor@1.0.1 was published at 2026-10-18T10:00:00.000Z, within the minimumReleaseAge cutoff (2026-10-17T12:00:00.000Z)', finishedAt)
  assert.equal(refusal.availableAt, Date.parse('2026-10-19T10:00:00Z'))

  assert.deepEqual(resolveLauncher({ argv: [], execPath: 'node', platform: 'win32' }), { command: 'pnpm.cmd', prefix: [], shell: true })
  assert.equal(resolveLauncher({ argv: [], execPath: 'node', platform: 'darwin' }).command, 'pnpm')

  const home = await temp()
  try {
    const pkgDir = join(home, 'pkg')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'dsh-aha-tutor', version: '1.0.0' }))
    const profileDir = join(home, 'profiles', 'desktop')
    await mkdir(join(profileDir, 'node_modules'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-aha-tutor': '1.0.0' } }))
    await symlink(pkgDir, join(profileDir, 'node_modules', 'dsh-aha-tutor'), process.platform === 'win32' ? 'junction' : 'dir')
    const ownPackageJsonUrl = pathToFileURL(join(pkgDir, 'package.json'))
    assert.deepEqual(await findInstall({ dshHome: home, ownPackageJsonUrl }), { kind: 'npm', profile: 'desktop' })

    const pnpmScript = join(home, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
    await mkdir(join(pnpmScript, '..'), { recursive: true })
    await writeFile(pnpmScript, '')
    const commands = []
    const fetchImpl = async () => Response.json({ version: '1.0.1' })
    const base = { fetchImpl, env: { DSH_HOME: home }, argv: ['node', pnpmScript], execPath: '/usr/bin/node', ownPackageJsonUrl, settleDelayMs: 1, now: () => finishedAt }

    const pendingManager = createPluginManager({ ...base, runCommand: async command => { commands.push(command); return { code: 1, stdout: '', stderr: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION dsh-aha-tutor@1.0.1 was published at 2026-10-18T10:00:00.000Z, within the minimumReleaseAge cutoff (2026-10-17T12:00:00.000Z)' } } })
    const pending = await pendingManager.update()
    assert.equal(pending.pending, true)
    assert.equal(pending.availableAt, Date.parse('2026-10-19T10:00:00Z'))
    assert.deepEqual(commands[0].args, [pnpmScript, 'add', '--save-exact', 'dsh-aha-tutor@1.0.1'])
    assert.equal(commands[0].cwd, profileDir)
    assert.ok(!commands[0].args.some(arg => /minimumReleaseAge|--force/u.test(arg)))

    const lyingManager = createPluginManager({ ...base, runCommand: async () => ({ code: 0, stdout: '', stderr: '' }) })
    await assert.rejects(lyingManager.update(), /did not install/)

    const goodManager = createPluginManager({ ...base, runCommand: async () => {
      await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'dsh-aha-tutor', version: '1.0.1' }))
      return { code: 0, stdout: '', stderr: '' }
    } })
    assert.deepEqual(await goodManager.update(), { version: '1.0.1', profile: 'desktop' })

    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'dsh-aha-tutor': 'link:/somewhere' } }))
    const info = await goodManager.read({ force: true })
    assert.equal(info.install.kind, 'link')
    await assert.rejects(goodManager.update(), /local checkout/)
    assert.equal(JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')).dependencies['dsh-aha-tutor'], 'link:/somewhere')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('streamed progress counts markers even when a delta splits them', () => {
  const counts = []
  const count = streamCounter('"estMinutes"', value => counts.push(value))
  for (const piece of ['{"est', 'Minutes":3}', ',{"estMinutes":4}', 'no marker here']) count(piece)
  assert.deepEqual(counts, [1, 2])
})
