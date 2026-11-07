import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { isPictureFile, pictureAsk, pictureMime, QUESTION_PICTURES } from '../src/core/pictures.js'
import { TutorError } from '../src/host/generate.js'
import { pictureRoute, uploadRoute } from '../src/host/http.js'
import { createJobs } from '../src/host/jobs.js'
import { createPictures } from '../src/host/pictures.js'
import { createRoutes } from '../src/host/rpc.js'
import { createStore } from '../src/host/store.js'
import { createStudio } from '../src/host/studio.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)])
const TRANSCRIPT = '已知 $x^2=4$，求 $x$。'

const step = say => JSON.stringify({ say, ops: [{ t: 'p', text: say }] })

// A model whose routes see images as told (teach / quick), and which can be
// changed between calls. Reading a picture returns TRANSCRIPT.
function pictureLlm({ teach = false, quick = false, readFails = null } = {}) {
  const calls = []
  const sees = { teach, quick }
  return {
    calls,
    sees,
    readFails,
    supportsImages: purpose => sees[purpose] === true,
    async refreshCapabilities() {
      return { ...sees }
    },
    async complete(request) {
      calls.push(request)
      if (request.requireImages) {
        if (!sees[request.purpose]) throw new TutorError('llm-no-vision', 'no vision')
        if (this.readFails) throw new TutorError(this.readFails, 'failed')
        return TRANSCRIPT
      }
      if (request.user.includes('Describe this material')) return JSON.stringify({ summary: '一道方程题', topics: ['方程'], level: 'beginner', suggestedGoal: '' })
      return '{}'
    },
    async stream(request) {
      calls.push(request)
      const full = [JSON.stringify({ say: '题目是这样的', ops: [{ t: 'title', text: '解方程 x²=4' }, { t: 'p', text: '题目是这样的' }] }), step('两边开平方')].join('\n')
      for (const piece of full.match(/[\s\S]{1,23}/gu) ?? []) request.onText?.(piece)
      return full
    },
  }
}

async function settle(jobs, started) {
  for (let attempt = 0; attempt < 500 && jobs.get(started.id).status === 'running'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 2))
  return jobs.get(started.id)
}

async function finish(jobs, started) {
  const job = await settle(jobs, started)
  if (job.status !== 'done') throw new Error(`job ${job.kind} ${job.status}: ${job.error?.code} ${job.error?.message}`)
  return job.result
}

async function failure(jobs, started) {
  const job = await settle(jobs, started)
  assert.equal(job.status, 'failed')
  return job.error
}

async function setup(t, options = {}, clock = { at: Date.parse('2026-11-07T08:00:00Z') }) {
  const root = await mkdtemp(join(tmpdir(), 'aha-pictures-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createStore({ root: join(root, 'data') })
  const llm = pictureLlm(options)
  const jobs = createJobs()
  const now = () => new Date(clock.at)
  const pictures = createPictures({ store, llm, jobs, now })
  const studio = createStudio({ store, llm, jobs, now, pictures, uiLanguage: () => 'zh-CN', removeWaitMs: 200 })
  const upload = async (bytes = PNG, name = 'image.png') => (await finish(jobs, pictures.upload({ name, bytes }))).picture
  const ask = async request => finish(jobs, studio.assist(request))
  const boards = () => llm.calls.filter(call => call.onText)
  return { root, store, llm, jobs, pictures, studio, upload, ask, boards, clock }
}

const listed = async dir => readdir(dir).catch(() => [])

// ── what counts as a picture ───────────────────────────────────────────────

test('pictures are known by their first bytes, files by type or name', () => {
  assert.equal(pictureMime(PNG), 'image/png')
  assert.equal(pictureMime(JPEG), 'image/jpeg')
  assert.equal(pictureMime(Buffer.from('GIF89a......')), 'image/gif')
  assert.equal(pictureMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')), 'image/webp')
  assert.equal(pictureMime(Buffer.from('%PDF-1.7')), null)
  assert.equal(pictureMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  assert.equal(isPictureFile({ name: 'image.png', type: 'image/png' }), true)
  assert.equal(isPictureFile({ name: 'IMG_1.JPG', type: '' }), true)
  assert.equal(isPictureFile({ name: 'drawing.svg', type: 'image/svg+xml' }), false)
  assert.equal(isPictureFile({ name: 'scan.pdf', type: 'application/pdf' }), false)
  assert.equal(pictureAsk('solve', 'zh-CN'), '帮我解图里的题')
  assert.equal(pictureAsk('visualize', 'en'), 'Draw out what the picture shows')
  assert.equal(pictureAsk('nonsense', 'zh-CN'), pictureAsk('explain', 'zh-CN'))
  assert.equal(QUESTION_PICTURES, 4)
})

// ── uploading ──────────────────────────────────────────────────────────────

test('a pasted picture is kept apart from the library, read only when the teacher cannot see it', async t => {
  const seeing = await setup(t, { teach: true, quick: true })
  const seen = await seeing.upload()
  assert.equal(seen.sight, 'image')
  assert.equal(seen.text, null)
  // No reading: a teacher who sees pictures is given the picture itself.
  assert.equal(seeing.llm.calls.length, 0)
  assert.deepEqual(await listed(seeing.store.paths.materials()), [])
  assert.deepEqual(await listed(seeing.store.paths.pictures()), [seen.id])

  const reading = await setup(t, { teach: false, quick: true })
  const read = await reading.upload(JPEG, 'C:\\Users\\me\\Desktop\\题目.jpg')
  assert.equal(read.sight, 'text')
  assert.equal(read.text, TRANSCRIPT)
  assert.equal(read.name, '题目.jpg')
  assert.equal(read.mime, 'image/jpeg')
  assert.equal(reading.llm.calls.filter(call => call.requireImages).length, 1)

  const blind = await setup(t)
  const unseen = await blind.upload()
  assert.equal(unseen.sight, 'none')
  assert.equal(blind.llm.calls.length, 0)
})

test('only pictures within 10 MB are taken', async t => {
  const { pictures } = await setup(t, { teach: true })
  assert.throws(() => pictures.upload({ name: 'notes.pdf', bytes: Buffer.from('%PDF-1.7 ...') }), { code: 'picture-unsupported' })
  assert.throws(() => pictures.upload({ name: 'empty.png', bytes: Buffer.alloc(0) }), { code: 'empty' })
  assert.throws(() => pictures.upload({ name: 'big.png', bytes: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) }), { code: 'image-too-large' })
})

test('a reading that fails is noted on the picture and tried again when asked', async t => {
  const { upload, llm, jobs, studio } = await setup(t, { quick: true, readFails: 'llm-quota' })
  const picture = await upload()
  assert.equal(picture.failed, 'llm-quota')
  assert.equal(picture.text, null)
  llm.calls.length = 0
  // Still failing: a question of pictures alone says why.
  const error = await failure(jobs, studio.assist({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_retry000001' }))
  assert.equal(error.code, 'llm-quota')
  assert.equal(llm.calls.filter(call => call.requireImages).length, 1)
  // Read at last: the question goes ahead with the text.
  llm.calls.length = 0
  llm.readFails = null
  const answer = await finish(jobs, studio.assist({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_retry000001' }))
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'text' }])
  assert.match(llm.calls.find(call => call.onText).user, /Picture 1 \(this question\):\n已知/u)
})

// ── asking ─────────────────────────────────────────────────────────────────

test('a teacher who sees pictures is given them, and a question may be pictures alone', async t => {
  const { upload, ask, boards, pictures, store } = await setup(t, { teach: true })
  const picture = await upload()
  const answer = await ask({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_pictures0001' })
  assert.equal(answer.threadId, 'thd_pictures0001')
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'image' }])
  const [call] = boards()
  assert.equal(call.images.length, 1)
  assert.equal(call.images[0].mime, 'image/png')
  assert.equal(Buffer.from(call.images[0].base64, 'base64').equals(PNG), true)
  assert.match(call.user, /<request>\n帮我解图里的题\n<\/request>/u)
  assert.match(call.user, /attached 1 picture, given to you with this message/u)
  const thread = await store.readJson(store.paths.item('assist', answer.threadId))
  assert.equal(thread.turns[0].request, '帮我解图里的题')
  // Named by its board's topic, not by the question every picture asks.
  assert.equal(thread.title, '解方程 x²=4')
  assert.deepEqual(thread.turns[0].pictures, [{ id: picture.id, seen: 'image' }])
  // Used by the question: it belongs to the thread now.
  assert.equal((await pictures.get(picture.id)).threadId, answer.threadId)
})

test('when only the quick route sees pictures, the teacher gets the text read from them', async t => {
  const { upload, ask, boards, store } = await setup(t, { quick: true })
  const picture = await upload()
  const answer = await ask({ mode: 'solve', request: '第二问怎么做', pictureIds: [picture.id], newThreadId: 'thd_pictures0002' })
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'text' }])
  const [call] = boards()
  assert.equal(call.images, undefined)
  assert.match(call.user, /<learner_pictures>\nPicture 1 \(this question\):\n已知 \$x\^2=4\$，求 \$x\$。\n<\/learner_pictures>/u)
  assert.match(call.user, /figures, graphs and drawings in them were not read/u)
  assert.match(call.user, /<request>\n第二问怎么做\n<\/request>/u)
  // A question with words names its thread, as before.
  assert.equal((await store.readJson(store.paths.item('assist', answer.threadId))).title, '第二问怎么做')
})

test('when no chosen model sees pictures, pictures alone are refused and typed words go ahead', async t => {
  const { upload, ask, boards, jobs, studio, pictures } = await setup(t)
  const picture = await upload()
  const error = await failure(jobs, studio.assist({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_pictures0003' }))
  assert.equal(error.code, 'pictures-unseen')
  assert.equal(boards().length, 0)
  // Refused, the picture is still there to ask about once a model can see it.
  assert.equal((await pictures.get(picture.id)).threadId, null)
  const answer = await ask({ mode: 'solve', request: 'x²=4 怎么解', pictureIds: [picture.id], newThreadId: 'thd_pictures0003' })
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'none' }])
  const [call] = boards()
  assert.equal(call.images, undefined)
  assert.match(call.user, /also attached 1 picture that could not be shown to you\. Do not guess what it shows/u)
})

test('a question with no words and no pictures is refused at once', async t => {
  const { studio } = await setup(t, { teach: true })
  assert.throws(() => studio.assist({ mode: 'solve', request: '   ', pictureIds: ['not-an-id'] }), { code: 'empty-question' })
})

test('the settings asked about now decide: a teacher who can see now is shown pictures read before', async t => {
  const { upload, ask, boards, llm } = await setup(t, { quick: true })
  const picture = await upload()
  assert.equal(picture.sight, 'text')
  llm.sees.teach = true
  const answer = await ask({ mode: 'explain', request: '', pictureIds: [picture.id], newThreadId: 'thd_pictures0004' })
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'image' }])
  assert.equal(boards()[0].images.length, 1)
  assert.match(boards()[0].user, /<request>\n讲讲图里的内容\n<\/request>/u)
})

test('text read from a picture is still used once no model the learner chose sees pictures', async t => {
  const { upload, ask, boards, llm } = await setup(t, { quick: true })
  const picture = await upload()
  llm.sees.quick = false
  const answer = await ask({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_pictures0011' })
  assert.deepEqual(answer.pictures, [{ id: picture.id, seen: 'text' }])
  assert.match(boards()[0].user, /Picture 1 \(this question\):\n已知/u)
})

test('a follow-up shows its own pictures first, then the latest earlier ones, four in all', async t => {
  const { upload, ask, boards } = await setup(t, { teach: true })
  const first = [await upload(), await upload(), await upload()]
  const opened = await ask({ mode: 'solve', request: '', pictureIds: first.map(picture => picture.id), newThreadId: 'thd_pictures0005' })
  const second = [await upload(JPEG), await upload(JPEG)]
  const followed = await ask({ mode: 'solve', request: '这两张呢', pictureIds: second.map(picture => picture.id), threadId: opened.threadId })
  assert.equal(followed.threadId, opened.threadId)
  assert.equal(followed.turn, 1)
  const call = boards()[1]
  assert.equal(call.images.length, QUESTION_PICTURES)
  // The two new JPEGs, then the two latest of the first question.
  assert.deepEqual(call.images.map(image => image.mime), ['image/jpeg', 'image/jpeg', 'image/png', 'image/png'])
  assert.match(call.user, /attached 4 pictures, given to you with this message \(the last 2 from earlier in this session\)/u)
  assert.match(call.user, /\[with 3 picture\(s\)\]/u)
})

test('a question takes at most four pictures, and none of another thread', async t => {
  const { upload, ask, studio, jobs, boards } = await setup(t, { teach: true })
  const many = []
  for (let index = 0; index < 6; index += 1) many.push(await upload())
  const answer = await ask({ mode: 'explain', request: '', pictureIds: many.map(picture => picture.id), newThreadId: 'thd_pictures0006' })
  assert.equal(answer.pictures.length, QUESTION_PICTURES)
  assert.equal(boards()[0].images.length, QUESTION_PICTURES)
  // A picture another thread asked about is not this question's to use.
  const error = await failure(jobs, studio.assist({ mode: 'explain', request: '再看这张', pictureIds: [many[0].id], newThreadId: 'thd_pictures0007' }))
  assert.equal(error.code, 'picture-missing')
})

test('the browser may take out a pending picture, not one a question used', async t => {
  const { upload, ask, pictures } = await setup(t, { teach: true })
  const pending = await upload()
  await pictures.discard(pending.id)
  assert.equal(await pictures.get(pending.id), null)
  const used = await upload()
  await ask({ mode: 'solve', request: '', pictureIds: [used.id], newThreadId: 'thd_pictures0008' })
  await pictures.discard(used.id)
  assert.notEqual(await pictures.get(used.id), null)
})

// ── keeping and removing ───────────────────────────────────────────────────

test('deleting a thread deletes its pictures, and stops an answer still being written', async t => {
  const { upload, ask, studio, pictures, store, jobs, llm } = await setup(t, { teach: true })
  const kept = await upload()
  const other = await ask({ mode: 'solve', request: '', pictureIds: [kept.id], newThreadId: 'thd_keepthis01' })
  const picture = await upload()
  const answer = await ask({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_removing01' })
  // A follow-up still being written when the thread is deleted.
  let release
  const held = new Promise(resolve => { release = resolve })
  const stream = llm.stream
  llm.stream = async request => {
    await held
    return stream(request)
  }
  const writing = studio.assist({ mode: 'solve', request: '再讲一遍', threadId: answer.threadId })
  const removing = studio.removeItem({ kind: 'assist', id: answer.threadId })
  release()
  await removing
  assert.equal((await settle(jobs, writing)).status, 'cancelled')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(await store.readJson(store.paths.item('assist', answer.threadId)), null)
  assert.equal(await pictures.get(picture.id), null)
  // Another thread's pictures stay.
  assert.notEqual(await pictures.get(kept.id), null)
  assert.notEqual(await store.readJson(store.paths.item('assist', other.threadId)), null)
})

test('pictures never asked about are removed a day after they came', async t => {
  const { upload, ask, pictures, clock } = await setup(t, { teach: true })
  const stale = await upload()
  const used = await upload()
  await ask({ mode: 'solve', request: '', pictureIds: [used.id], newThreadId: 'thd_pictures0009' })
  clock.at += 25 * 60 * 60_000
  const fresh = await upload()
  assert.equal(await pictures.get(stale.id), null)
  assert.notEqual(await pictures.get(used.id), null)
  assert.notEqual(await pictures.get(fresh.id), null)
})

test('存进资料库 copies a picture into the library once, named after its thread', async t => {
  const { upload, ask, studio, jobs, pictures, store } = await setup(t, { teach: true, quick: true })
  const picture = await upload()
  const answer = await ask({ mode: 'solve', request: '', pictureIds: [picture.id], newThreadId: 'thd_pictures0010' })
  const thread = await store.readJson(store.paths.item('assist', answer.threadId))
  const { material, picture: shown } = await finish(jobs, studio.keepPicture({ id: picture.id }))
  assert.equal(material.kind, 'image')
  assert.equal(material.title, thread.title)
  assert.equal(material.folderId, null)
  assert.equal(material.fileName, 'image.png')
  assert.equal(shown.materialId, material.id)
  assert.match(material.brief.summary, /方程/u)
  // Kept again: the same material.
  const again = await finish(jobs, studio.keepPicture({ id: picture.id }))
  assert.equal(again.material.id, material.id)
  assert.deepEqual(await listed(store.paths.materials()), [material.id])
  // The thread keeps its own copy.
  assert.notEqual(await pictures.get(picture.id), null)
})

// ── routes ─────────────────────────────────────────────────────────────────

test('the upload route takes question pictures apart, within the picture size', async () => {
  const taken = []
  const route = uploadRoute({ studio: { upload: request => { taken.push(['library', request.name]); return { id: 'job_x' } } }, pictures: { upload: request => { taken.push(['question', request.name, request.bytes.length]); return { id: 'job_y' } } } })
  const send = (query, body) => route.fetch(new Request(`http://dsh.test/api/aha-tutor/upload?${query}`, { method: 'POST', body, duplex: 'half' }))
  assert.deepEqual(await (await send('name=image.png&for=question', PNG)).json(), { ok: true, value: { job: { id: 'job_y' } } })
  assert.deepEqual(await (await send('name=notes.pdf', Buffer.from('%PDF-1.7'))).json(), { ok: true, value: { job: { id: 'job_x' } } })
  const big = await send('name=big.png&for=question', Buffer.alloc(10 * 1024 * 1024 + 1))
  assert.equal(big.status, 413)
  assert.equal((await big.json()).error.code, 'aha-tutor/image-too-large')
  assert.deepEqual(taken, [['question', 'image.png', PNG.length], ['library', 'notes.pdf']])
})

test('the picture route serves stored pictures as what they are, and nothing else', async t => {
  const { upload, pictures } = await setup(t, { teach: true })
  const picture = await upload(JPEG, 'photo.jpg')
  const route = pictureRoute({ pictures })
  const get = id => route.fetch(new Request(`http://dsh.test/api/aha-tutor/picture?id=${encodeURIComponent(id)}`))
  const found = await get(picture.id)
  assert.equal(found.status, 200)
  assert.equal(found.headers.get('content-type'), 'image/jpeg')
  assert.equal(found.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(Buffer.from(await found.arrayBuffer()).equals(JPEG), true)
  for (const id of ['pic_doesnotexist1', '../meta.json', 'mat_abcdefgh', '']) assert.equal((await get(id)).status, 404)
})

test('the RPC routes check picture ids and keep a question to four pictures', async () => {
  const seen = []
  const routes = createRoutes({
    studio: { assist: request => { seen.push(['ask', request.pictureIds]); return { id: 'job_a' } }, keepPicture: request => { seen.push(['keep', request.id]); return { id: 'job_k' } } },
    pictures: { discard: id => { seen.push(['discard', id]); return { removed: id } }, upload: request => { seen.push(['upload', request.name, request.base64]); return { id: 'job_u' } } },
  })
  const ids = Array.from({ length: 6 }, (_, index) => `pic_question00${index}`)
  routes['assist/ask']({ mode: 'solve', request: '', pictureIds: [...ids, '../x', 7] })
  routes['picture/keep']({ id: ids[0] })
  routes['picture/discard']({ id: ids[1] })
  routes['picture/upload']({ name: 'image.png', base64: PNG.toString('base64') })
  assert.throws(() => routes['picture/discard']({ id: 'mat_abcdefgh' }), { code: 'invalid' })
  assert.throws(() => routes['picture/upload']({ name: 'x.png', base64: 'A'.repeat(15 * 1024 * 1024) }), { code: 'image-too-large' })
  assert.deepEqual(seen, [['ask', ids.slice(0, 4)], ['keep', ids[0]], ['discard', ids[1]], ['upload', 'image.png', PNG.toString('base64')]])
})
