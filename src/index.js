// Host entry of 「开窍 · AI 私人老师」 (dsh-aha-tutor).
// Wires the tutoring services to DSH: the LLM runtime, credentials for cloud
// voices, DSH's Voice Input for spoken questions, an RPC channel and HTTP
// routes for the browser page, and a runtime handle for the teacher preset's
// tools.

import { join } from 'node:path'

import { credentialKey } from '@deepseek-ai/dsh-credentials'

import { createCourses } from './host/courses.js'
import { createFolders } from './host/folders.js'
import { TutorError } from './host/generate.js'
import { fontRoute, pictureRoute, speechRoute, ttsRoute, uploadRoute } from './host/http.js'
import { createJobs } from './host/jobs.js'
import { createLearner } from './host/learner.js'
import { createLessons } from './host/lessons.js'
import { createLlmPort } from './host/llm.js'
import { createMistakes } from './host/mistakes.js'
import { createPluginManager } from './host/plugin-version.js'
import { createProjects } from './host/projects.js'
import { createResearch } from './host/research.js'
import { createRoutes, createRpcHandler } from './host/rpc.js'
import { publishRuntime } from './host/runtime.js'
import { createSamples } from './host/samples.js'
import { createKeyStore, createPrefs, createSettingsService } from './host/settings.js'
import { createSpeechInput } from './host/speech.js'
import { createStore, DATA_DIR_NAME, resolveDshHome } from './host/store.js'
import { createPictures } from './host/pictures.js'
import { createStudio } from './host/studio.js'
import { createTts } from './host/tts.js'

export const name = 'aha-tutor'
export const inject = ['llm']
export const CHANNEL = '/aha-tutor'

export function apply(ctx) {
  const logger = ctx.logger
  const store = createStore({ root: join(resolveDshHome(), DATA_DIR_NAME) })
  const prefs = createPrefs(store)
  const keys = createKeyStore({ getCredentials: () => ctx.get?.('credentials'), credentialKey })
  const llm = createLlmPort({
    getLlm: () => ctx.llm ?? ctx.get?.('llm'),
    getDefault: () => ctx.get?.('agentDefaultModel')?.currentSelection?.(),
    getAttachments: () => ctx.get?.('attachments'),
    prefs,
    logger,
  })
  const ready = prefs.load().catch(() => undefined).then(() => llm.refreshCapabilities().catch(() => undefined))
  ctx.on?.('llm/adapters-updated', () => { llm.refreshCapabilities().catch(() => undefined) })

  let uiLanguage = 'zh-CN'
  const jobs = createJobs({ logger })
  const mistakes = createMistakes({ store })
  const learner = createLearner({ store, llm, logger, mistakes })
  const research = createResearch({ getWeb: () => ctx.get?.('web'), llm, logger })
  const courses = createCourses({ store, llm, jobs, research, mistakes })
  const lessons = createLessons({ store, llm, jobs, courses, learner, mistakes })
  const folders = createFolders({ store })
  const pictures = createPictures({ store, llm, jobs })
  const studio = createStudio({ store, llm, jobs, uiLanguage: () => uiLanguage, folders, pictures })
  const projects = createProjects({ store, llm, jobs, courses })
  const samples = createSamples({ dirUrl: new URL('../samples/', import.meta.url), courses })
  const tts = createTts({ cacheDir: store.paths.ttsCache(), getSecret: provider => keys.read(provider) })
  const plugin = createPluginManager()
  const settings = createSettingsService({ prefs, keys, llmPort: llm })
  // DSH's speechToText exists only while its Voice Input bundle is enabled.
  const speechInput = createSpeechInput({ getSpeech: () => ctx.get?.('speechToText'), logger })

  async function speak({ text, provider, signal }) {
    await ready
    const current = prefs.read()
    const chosen = provider ?? current.ttsProvider
    return tts.synthesize({ provider: chosen, config: current.tts?.[chosen] ?? {}, text, rate: 1, signal })
  }

  async function info(payload) {
    if (typeof payload?.language === 'string') uiLanguage = payload.language.startsWith('zh') ? 'zh-CN' : 'en'
    let version = null
    try {
      version = (await plugin.read()).current
    } catch {
      version = null
    }
    return { version, language: uiLanguage }
  }

  const routes = {
    ...createRoutes({ courses, lessons, learner, studio, folders, pictures, projects, jobs, settings, tts: { speak }, plugin, info, speechInput }),
    'app/info': payload => info(payload),
    'samples/list': () => samples.list(),
    'samples/import': payload => samples.importSample({ id: payload.id }),
  }
  const handler = createRpcHandler(routes, { logger })

  // Shipped Connection versions read webServer from the caller's context; register
  // with this injected context so a first hot install mounts the channel.
  ctx.inject(['connection', 'webServer'], connectionCtx => {
    const service = connectionCtx.connection
    connectionCtx.effect(
      () => (typeof service.register === 'function' ? service.register(connectionCtx, CHANNEL, handler) : service.rpc.handle(CHANNEL, handler)),
      'aha-tutor: rpc channel',
    )
  })
  ctx.inject(['connection'], connectionCtx => {
    const fetchRoutes = connectionCtx.connection?.fetch
    if (typeof fetchRoutes?.register !== 'function') return
    connectionCtx.effect(() => fetchRoutes.register(uploadRoute({ studio, pictures })), 'aha-tutor: upload route')
    connectionCtx.effect(() => fetchRoutes.register(ttsRoute({ speak })), 'aha-tutor: tts route')
    connectionCtx.effect(() => fetchRoutes.register(speechRoute({ speechInput })), 'aha-tutor: speech route')
    connectionCtx.effect(() => fetchRoutes.register(fontRoute()), 'aha-tutor: font route')
    connectionCtx.effect(() => fetchRoutes.register(pictureRoute({ pictures })), 'aha-tutor: picture route')
  })

  // Services for the teacher preset's tools (src/agent.js).
  ctx.effect(() => publishRuntime({ store, llm, jobs, courses, lessons, learner, studio, ready }), 'aha-tutor: runtime')
  ctx.effect(() => () => jobs.dispose(), 'aha-tutor: jobs')
}

export { TutorError }
