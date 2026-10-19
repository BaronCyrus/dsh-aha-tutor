// Host entry of 「开窍 · AI 私人老师」 (dsh-aha-tutor).
// Wires the tutoring services to DSH: the LLM runtime, credentials for cloud
// voices, an RPC channel and two HTTP routes for the browser page, and a
// runtime handle for the teacher preset's tools.

import { join } from 'node:path'

import { credentialKey } from '@deepseek-ai/dsh-credentials'

import { createCourses } from './host/courses.js'
import { TutorError } from './host/generate.js'
import { fontRoute, ttsRoute, uploadRoute } from './host/http.js'
import { createJobs } from './host/jobs.js'
import { createLearner } from './host/learner.js'
import { createLessons } from './host/lessons.js'
import { createLlmPort } from './host/llm.js'
import { createPluginManager } from './host/plugin-version.js'
import { createProjects } from './host/projects.js'
import { createRoutes, createRpcHandler } from './host/rpc.js'
import { publishRuntime } from './host/runtime.js'
import { createSamples } from './host/samples.js'
import { createKeyStore, createPrefs, createSettingsService } from './host/settings.js'
import { createStore, DATA_DIR_NAME, resolveDshHome } from './host/store.js'
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
  const learner = createLearner({ store, llm, logger })
  const courses = createCourses({ store, llm, jobs })
  const lessons = createLessons({ store, llm, jobs, courses, learner })
  const studio = createStudio({ store, llm, jobs, uiLanguage: () => uiLanguage })
  const projects = createProjects({ store, llm, jobs, courses })
  const samples = createSamples({ dirUrl: new URL('../samples/', import.meta.url), courses })
  const tts = createTts({ cacheDir: store.paths.ttsCache(), getSecret: provider => keys.read(provider) })
  const plugin = createPluginManager()
  const settings = createSettingsService({ prefs, keys, llmPort: llm })

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
    ...createRoutes({ courses, lessons, learner, studio, projects, jobs, settings, tts: { speak }, plugin, info }),
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
    connectionCtx.effect(() => fetchRoutes.register(uploadRoute({ studio })), 'aha-tutor: upload route')
    connectionCtx.effect(() => fetchRoutes.register(ttsRoute({ speak })), 'aha-tutor: tts route')
    connectionCtx.effect(() => fetchRoutes.register(fontRoute()), 'aha-tutor: font route')
  })

  // Services for the teacher preset's tools (src/agent.js).
  ctx.effect(() => publishRuntime({ store, llm, jobs, courses, lessons, learner, studio, ready }), 'aha-tutor: runtime')
  ctx.effect(() => () => jobs.dispose(), 'aha-tutor: jobs')
}

export { TutorError }
