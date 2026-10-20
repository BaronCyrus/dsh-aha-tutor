import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { BOARD_FONT_FILES } from '../src/core/board-fonts.js'
import { FONT_PATH, fontRoute } from '../src/host/http.js'
import { createJobs } from '../src/host/jobs.js'
import { createLlmPort, outputBudget, pickEffort } from '../src/host/llm.js'
import { blueprintPrompt, correctionPrompt, gradePrompt, lessonPrompt, STEP_SPEC } from '../src/host/prompts.js'
import { generateSteps, streamCounter, writingHint } from '../src/host/generate.js'
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
    api.preview({ units: ['第一单元'] })
    await gate
    return { ok: true }
  }, { key: 'lesson:x' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(jobs.start('lesson', async () => 'again', { key: 'lesson:x' }).id, started.id)
  const mid = jobs.get(started.id)
  assert.equal(mid.progress.label, 'writing')
  assert.deepEqual(mid.partial, [{ step: 1 }])
  assert.deepEqual(mid.preview, { units: ['第一单元'] }, 'a preview replaces the previous one')
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

  // A job says how long it has run, by the host's clock, and stops counting when done.
  let clock = 10_000
  const timed = createJobs({ now: () => clock })
  let finish
  const timedJob = timed.start('lesson', () => new Promise(resolve => { finish = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  clock += 2500
  assert.equal(timed.get(timedJob.id).elapsedMs, 2500)
  finish('ok')
  await new Promise(resolve => setTimeout(resolve, 5))
  clock += 9000
  assert.equal(timed.get(timedJob.id).elapsedMs, 2500)

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

test('the font route serves only the bundled board fonts, cacheably', async () => {
  const route = fontRoute()
  assert.equal(route.path, FONT_PATH)
  assert.deepEqual(route.methods, ['GET'])
  const font = BOARD_FONT_FILES[1]
  const response = await route.fetch(new Request(`http://dsh.local${FONT_PATH}?f=${font.file}`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'font/woff2')
  assert.match(response.headers.get('cache-control'), /immutable/u)
  assert.equal((await response.arrayBuffer()).byteLength, font.bytes)
  for (const name of ['../../package.json', 'OFL-Caveat.txt', '', 'wenkai-gb-0.woff2']) {
    assert.equal((await route.fetch(new Request(`http://dsh.local${FONT_PATH}?f=${encodeURIComponent(name)}`))).status, 404, name)
  }
})

test('lesson prompts ask for sentence-timed ops and goal tags', () => {
  assert.match(STEP_SPEC, /"at"/u)
  const prompt = lessonPrompt({
    course: { title: '勾股定理', summary: '' },
    unit: { title: '单元' },
    lecture: { title: '讲' },
    lesson: { title: '面积', objectives: ['会用补全法', '会归纳规律'], concepts: [], estMinutes: 15 },
    language: 'zh-CN',
    learner: {},
  })
  assert.match(prompt.user, /"goal"/u)
  assert.match(prompt.user, /0 = 会用补全法; 1 = 会归纳规律/u)
})

// A stand-in for DSH's LLM service: records the controls each call ends up
// with and streams what `script` returns for the nth call.
function fakeDshLlm(model, script) {
  const calls = []
  return {
    calls,
    async resolveModelInfo() { return model },
    async prepareCall(target, signal, adjust) {
      const controls = adjust ? adjust({ maxTokens: target.maxTokens }, model) : { maxTokens: target.maxTokens }
      calls.push(controls)
      const chunks = script(calls.length)
      return { config: { ...target, ...controls }, inputModalities: ['text'], async *stream() { yield* chunks } }
    },
  }
}

test('writing a board reports thinking, then each step being written and what it is about', async () => {
  const model = { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }], defaultEffort: 'low' }, defaultMaxTokens: 64_000 }
  const step1 = '{"say":"先看一道陷阱题。很多人会丢根。","ops":[{"t":"h","text":"零积性质","at":0},{"t":"p","text":"$ab=0$","at":1}]}'
  const step2 = '{"say":"再试一个例子。","ops":[{"t":"p","text":"例：$x^2=5x$","at":0}]}'
  const chunks = [
    { type: 'reasoning-delta', text: '先想想' },
    { type: 'reasoning-delta', text: '怎么讲。' },
    { type: 'text-delta', text: step1.slice(0, 22) },
    { type: 'text-delta', text: step1.slice(22, 60) },
    { type: 'text-delta', text: `${step1.slice(60)}\n` },
    { type: 'text-delta', text: `${step2}\n` },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const dsh = fakeDshLlm(model, () => chunks)
  const llm = createLlmPort({ getLlm: () => dsh, getDefault: () => ({ provider: 'deepseek', model: 'flash' }), getAttachments: () => null, prefs: { read: () => ({}) } })
  const reports = []
  const board = await generateSteps(llm, { prompt: { system: 's', user: 'u' }, effort: 'low', onProgress: info => reports.push(info), progressEveryMs: 0 })
  assert.equal(board.steps.length, 2)
  assert.deepEqual(reports[0], { phase: 'starting', thinking: 0, chars: 0, steps: 0, current: '' })
  assert.deepEqual(reports.filter(report => report.phase === 'thinking').map(report => report.thinking), [3, 7])
  const writing = reports.filter(report => report.phase === 'writing')
  assert.deepEqual(writing.map(report => report.current).filter(Boolean), ['先看一道陷阱题。', '零积性质'], 'the first sentence until the heading arrives')
  assert.equal(writing.at(-1).steps, 2)
  assert.equal(writing.at(-1).chars, step1.length + step2.length + 2)
  assert.equal(writing.at(-1).thinking, 7, 'thinking stops counting once writing starts')

  // Only the length of the reasoning is used, and complete() never streams it.
  const seen = []
  await llm.stream({ purpose: 'teach', system: 's', user: 'u', maxTokens: 100, onText: () => {}, onReasoning: delta => seen.push(delta) })
  assert.deepEqual(seen, ['先想想', '怎么讲。'])

  assert.equal(writingHint('{"say":"好","ops":[{"t":"title","at":0,"text":"ab=0 的秘密"}'), 'ab=0 的秘密')
  assert.equal(writingHint('{"say":"line \\u4e2'), 'line', 'a cut-off escape is dropped')
  assert.equal(writingHint('[{"say":"one"},{"say":"two, and more'), 'two, and more', 'the last step, when a model sends one document')
  assert.equal(writingHint(`{"say":"${'很长'.repeat(30)}`), `${'很长'.repeat(20)}…`)
  // A formula cut off by the stream or the length limit is left out, not shown with a lone "$".
  assert.equal(writingHint('{"say":"补上 9，就变成 $(x+3'), '补上 9，就变成…')
  assert.equal(writingHint('{"say":"上节课我们用补全正方形看懂了配方的样子：$x^2+6x$ 再补上 9，就变成 $(x+3)^2$。"'), '上节课我们用补全正方形看懂了配方的样子：$x^2+6x$ 再补上 9，就变成…')
  assert.equal(writingHint('{"say":"先看 $x^2=4$ 的两个根。"'), '先看 $x^2=4$ 的两个根。')
  assert.equal(writingHint('no step yet'), '')
})

test('model calls leave room for reasoning, skip it for boards where they can and grow after an empty answer', async () => {
  const model = { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }], defaultEffort: 'high' }, defaultMaxTokens: 256_000 }
  const answer = [{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }]
  const port = dsh => createLlmPort({ getLlm: () => dsh, getDefault: () => ({ provider: 'deepseek', model: 'flash' }), getAttachments: () => null, prefs: { read: () => ({}) } })
  const request = { system: 's', user: 'u', maxTokens: 8000, onText: () => {} }

  const dsh = fakeDshLlm(model, () => answer)
  await port(dsh).stream({ ...request, purpose: 'teach', effort: 'lowest' })
  await port(dsh).stream({ ...request, purpose: 'teach', effort: 'low' })
  await port(dsh).stream({ ...request, purpose: 'teach' })
  await port(dsh).complete({ ...request, purpose: 'quick', maxTokens: 1200 })
  assert.deepEqual(dsh.calls, [{ maxTokens: 8000, reasoningEffort: 'off' }, { maxTokens: 24_000, reasoningEffort: 'low' }, { maxTokens: 32_000 }, { maxTokens: 1200, reasoningEffort: 'off' }])

  // A model that cannot stop reasoning writes boards at its lightest effort,
  // with room for that reasoning.
  const claudeLike = fakeDshLlm({ reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'max' }], defaultEffort: 'high' }, defaultMaxTokens: 128_000 }, () => answer)
  await port(claudeLike).stream({ ...request, purpose: 'teach', effort: 'lowest' })
  assert.deepEqual(claudeLike.calls, [{ maxTokens: 24_000, reasoningEffort: 'low' }])

  // Thinking that used up the limit leaves no answer: the next try gets more room.
  const thinker = fakeDshLlm(model, n => (n === 1 ? [{ type: 'reasoning-delta', text: '…' }, { type: 'finish', reason: { kind: 'max-tokens' } }] : answer))
  assert.equal(await port(thinker).stream({ ...request, purpose: 'teach', effort: 'low' }), 'ok')
  assert.deepEqual(thinker.calls.map(controls => controls.maxTokens), [24_000, 32_000])
  // Still nothing after the retries is reported in its own words.
  const silent = fakeDshLlm(model, () => [{ type: 'finish', reason: { kind: 'max-tokens' } }])
  await assert.rejects(port(silent).complete({ ...request, purpose: 'quick' }), error => error.code === 'llm-empty')
  assert.deepEqual(silent.calls.map(controls => controls.maxTokens), [8000, 16_000, 32_000])

  assert.equal(outputBudget(8000, undefined, {}), 8000, 'a model without reasoning or a known limit gets what the call needs')
  assert.equal(outputBudget(8000, 'high', { reasoning: {}, defaultMaxTokens: 10_000 }), 10_000, 'never above the model limit')
  assert.equal(pickEffort([{ id: 'low' }, { id: 'high' }], 'lowest'), 'low')
  assert.equal(pickEffort([{ id: 'minimal' }, { id: 'low' }, { id: 'medium' }, { id: 'high' }], 'lowest'), 'minimal')
  assert.equal(pickEffort([{ id: 'high' }, { id: 'none' }, { id: 'low' }], 'lowest'), 'none', 'listed in another order')
  assert.equal(pickEffort([{ id: 'fast' }, { id: 'deep' }], 'lowest'), 'fast', 'unknown ids keep their order')
  assert.equal(pickEffort([{ id: 'off' }, { id: 'high' }], 'low'), 'high', 'the lightest effort that still reasons')
  assert.equal(pickEffort([], 'low'), undefined)
})

test('a chosen course size is a hard range; otherwise the pace bounds a broad subject', () => {
  const base = { goal: '配方法', language: 'zh-CN', intake: '', materialsSummary: '', profile: null, timeline: 'balanced', weeklyMinutes: 120 }
  const sized = blueprintPrompt({ ...base, size: 'short' }).user
  assert.match(sized, /3–8 lessons in the whole course/u)
  assert.doesNotMatch(sized, /Balanced pace/u)
  assert.match(blueprintPrompt({ ...base, size: 'auto' }).user, /Balanced pace: for a broad subject/u)
})

test('a written working is asked for once per lesson, graded line by line and corrected at the board', () => {
  assert.match(STEP_SPEC, /"work"/u)
  const lesson = lessonPrompt({
    course: { title: '配方法', summary: '' },
    unit: { title: '单元' },
    lecture: { title: '讲' },
    lesson: { title: '配方', objectives: ['会配方'], concepts: [], estMinutes: 15 },
    language: 'zh-CN',
    learner: {},
  })
  assert.match(lesson.user, /exactly one check a "work" check/u)
  const graded = gradePrompt({ item: { kind: 'work', prompt: 'Q', answer: 'A', rubric: ['r'] }, response: 'R', language: 'zh-CN' })
  assert.match(graded.user, /<learner_working>/u)
  assert.match(graded.user, /"wrongStep"/u)
  assert.doesNotMatch(gradePrompt({ item: { prompt: 'Q', answer: 'A' }, response: 'R', language: 'zh-CN' }).user, /wrongStep/u)
  const fix = correctionPrompt({ course: { title: '配方法' }, lesson: { title: '配方', objectives: [] }, language: 'zh-CN', boardSoFar: '', item: { prompt: 'Q', answer: 'A' }, response: '我的过程', grade: { wrongStep: '$x+3=4$', why: '漏了负根', fix: '$x+3=\\pm 4$' } })
  assert.match(fix.user, /我的过程/u)
  assert.match(fix.user, /First wrong line: \$x\+3=4\$/u)
  assert.match(fix.user, /"style":"box"/u)
})
