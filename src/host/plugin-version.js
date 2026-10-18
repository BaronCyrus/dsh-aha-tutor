// Version check and in-place update for the settings page.
//
// The update installs the exact registry version with DSH's own pnpm inside
// the profile that owns this copy:  pnpm add --save-exact <name>@<version>.
// It never overrides pnpm's minimumReleaseAge (no --config.minimumReleaseAge,
// no minimumReleaseAgeExclude edits, no --force): a version installed past the
// cooldown would sit in the profile's lockfile and make pnpm refuse every
// later plugin install in that profile until it ages. A version pnpm still
// holds back is reported as pending with the time it becomes installable.
// A zero exit code is not trusted; the installed manifest is checked.
// Registry bodies and pnpm output stay host-side.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveDshHome } from './store.js'

export const PACKAGE_NAME = 'dsh-aha-tutor'
export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const VERSION_TTL_MS = 5 * 60_000
const VERSION_TIMEOUT_MS = 10_000
const UPDATE_TIMEOUT_MS = 180_000
const SETTLE_DELAY_MS = 250

const RELEASE_AGE_ERROR = /ERR_PNPM_(?:NO_MATURE_MATCHING_VERSION|MINIMUM_RELEASE_AGE_VIOLATION)/u
const RELEASE_AGE_ENTRY = /(\S+@\S+) was published at (\S+?), within the minimumReleaseAge cutoff \((\S+?)\)/gu

// undefined when the output is not a cooldown refusal; otherwise
// { availableAt } (ms) when pnpm named the refused entries.
export function releaseAgeRefusal(output, finishedAt) {
  const textValue = String(output ?? '').replace(/\u001b\[[0-9;]*m/gu, '')
  if (!RELEASE_AGE_ERROR.test(textValue)) return undefined
  let availableAt
  for (const [, , published, cutoff] of textValue.matchAll(RELEASE_AGE_ENTRY)) {
    const clears = Date.parse(published) + (finishedAt - Date.parse(cutoff))
    if (Number.isFinite(clears) && (availableAt === undefined || clears > availableAt)) availableAt = clears
  }
  return availableAt === undefined ? {} : { availableAt }
}

export function parseSemver(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim())
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] }
}

export function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return undefined
  for (const key of ['major', 'minor', 'patch']) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  if (left.pre === right.pre) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1
  return left.pre < right.pre ? -1 : 1
}

function classifySpec(spec) {
  if (typeof spec !== 'string' || !spec) return 'unknown'
  if (/^(?:link|file):/u.test(spec)) return 'link'
  if (/^(?:\d|[~^*])/u.test(spec)) return 'npm'
  return 'unknown'
}

async function readManifest(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

// The profile that owns this running copy: compare realpaths, else the only
// profile that declares the dependency.
export async function findInstall({ dshHome, ownPackageJsonUrl }) {
  let ownReal
  try {
    ownReal = await realpath(fileURLToPath(ownPackageJsonUrl))
  } catch {
    ownReal = undefined
  }
  let entries = []
  try {
    entries = await readdir(join(dshHome, 'profiles'), { withFileTypes: true })
  } catch {
    entries = []
  }
  const declared = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const profileDir = join(dshHome, 'profiles', entry.name)
    const spec = (await readManifest(join(profileDir, 'package.json')))?.dependencies?.[PACKAGE_NAME]
    if (typeof spec !== 'string') continue
    declared.push({ profile: entry.name, spec })
    if (!ownReal) continue
    try {
      const installed = await realpath(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))
      if (installed === ownReal) return { kind: classifySpec(spec), profile: entry.name }
    } catch {
      // declared but not resolvable here
    }
  }
  if (declared.length === 1) return { kind: classifySpec(declared[0].spec), profile: declared[0].profile }
  return { kind: 'unknown' }
}

const PNPM_SCRIPT = /[\\/]pnpm\.(?:mjs|cjs|js)$/u
const isExistingPath = value => typeof value === 'string' && value !== '' && existsSync(value)
const dshRuntimeRoot = value => (isExistingPath(value) && existsSync(join(value, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')) ? value : undefined)

// DSH desktop passes its bundled pnpm in the host's own arguments.
export function resolvePnpm({ argv } = {}) {
  const entries = Array.isArray(argv) ? argv : []
  for (const entry of entries) if (isExistingPath(entry) && PNPM_SCRIPT.test(entry)) return entry
  for (const entry of entries) {
    const root = dshRuntimeRoot(entry)
    if (!root) continue
    const script = join(root, '..', 'pnpm', 'bin', 'pnpm.mjs')
    if (existsSync(script)) return script
  }
  return undefined
}

export function resolveLauncher({ argv, execPath, platform = process.platform }) {
  const pnpm = resolvePnpm({ argv })
  if (pnpm) return { command: execPath, prefix: [pnpm], shell: false }
  // Fallback to a pnpm on PATH. On Windows that is a .cmd shim, which Node
  // only runs through a shell; the arguments are fixed and validated.
  return platform === 'win32' ? { command: 'pnpm.cmd', prefix: [], shell: true } : { command: 'pnpm', prefix: [], shell: false }
}

function spawnRunCommand({ command, args, cwd, shell }, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('plugin update aborted'))
      return
    }
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('plugin update timed out')), timeoutMs)
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal, windowsHide: true, shell: shell === true, ...(cwd ? { cwd } : {}) })
    } catch (error) {
      settle(reject, error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-8192) })
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
    child.on('error', error => settle(reject, error))
    child.on('close', code => {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        settle(reject, reason instanceof Error ? reason : new Error('plugin update aborted'))
        return
      }
      settle(resolve, { code: code ?? 1, stdout, stderr })
    })
  })
}

async function confirmInstalled({ profileDir, expected, settleDelayMs }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const installed = (await readManifest(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json')))?.version
    if (installed === expected) return
    if (attempt < 3) await new Promise(resolve => { setTimeout(resolve, settleDelayMs) })
  }
  throw new Error('plugin update did not install the requested version')
}

export function createPluginManager({
  fetchImpl = globalThis.fetch,
  runCommand = spawnRunCommand,
  execPath = process.execPath,
  argv = process.argv,
  env = process.env,
  platform = process.platform,
  ownPackageJsonUrl = new URL('../package.json', import.meta.url),
  registryUrl = REGISTRY_LATEST_URL,
  now = Date.now,
  ttlMs = VERSION_TTL_MS,
  timeoutMs = VERSION_TIMEOUT_MS,
  updateTimeoutMs = UPDATE_TIMEOUT_MS,
  settleDelayMs = SETTLE_DELAY_MS,
} = {}) {
  const dshHome = resolveDshHome(env)
  const launcher = resolveLauncher({ argv, execPath, platform })
  let updating = false
  let cached
  let inflight

  const fetchLatest = async signal => {
    const timeout = AbortSignal.timeout(timeoutMs)
    let response
    try {
      response = await fetchImpl(registryUrl, { headers: { Accept: 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      throw new Error('plugin version check failed')
    }
    if (!response.ok) throw new Error('plugin version check failed')
    let version
    try {
      version = (await response.json())?.version
    } catch {
      version = undefined
    }
    if (!parseSemver(version)) throw new Error('plugin version check failed')
    return version
  }

  const readOwnVersion = async () => {
    const version = (await readManifest(fileURLToPath(ownPackageJsonUrl)))?.version
    if (!parseSemver(version)) throw new Error('plugin version is unavailable')
    return version
  }

  // The current version is always shown; the latest may be unknown (offline,
  // or not published yet).
  async function load(signal) {
    const [current, install, latest] = await Promise.all([
      readOwnVersion(),
      findInstall({ dshHome, ownPackageJsonUrl }),
      fetchLatest(signal).catch(error => {
        if (signal?.aborted) throw error
        return null
      }),
    ])
    return { current, latest, latestUnknown: latest === null, updateAvailable: latest !== null && compareSemver(latest, current) === 1, install, fetchedAt: now() }
  }

  async function read({ force = false, signal } = {}) {
    if (!force && cached && now() - cached.fetchedAt < ttlMs) return cached
    inflight ??= load(signal).then(value => { cached = value; return value }).finally(() => { inflight = undefined })
    return inflight
  }

  async function update({ signal } = {}) {
    signal?.throwIfAborted()
    if (updating) throw new Error('plugin update is already running')
    updating = true
    try {
      const install = await findInstall({ dshHome, ownPackageJsonUrl })
      if (install.kind === 'link') throw new Error('plugin is installed from a local checkout')
      if (install.kind !== 'npm' || !install.profile) throw new Error('plugin update could not find the owning profile')
      const latest = await fetchLatest(signal)
      if (!parseSemver(latest)) throw new Error('plugin version check failed')
      const profileDir = join(dshHome, 'profiles', install.profile)
      let result
      try {
        result = await runCommand({
          command: launcher.command,
          args: [...launcher.prefix, 'add', '--save-exact', `${PACKAGE_NAME}@${latest}`],
          cwd: profileDir,
          shell: launcher.shell,
        }, { signal, timeoutMs: updateTimeoutMs })
      } catch (error) {
        if (signal?.aborted) throw error
        throw new Error('plugin update failed')
      }
      if (result.code !== 0) {
        const refusal = releaseAgeRefusal(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, now())
        if (refusal) return { version: latest, profile: install.profile, pending: true, ...refusal }
        throw new Error('plugin update failed')
      }
      await confirmInstalled({ profileDir, expected: latest, settleDelayMs })
      cached = undefined
      return { version: latest, profile: install.profile }
    } finally {
      updating = false
    }
  }

  return Object.freeze({ read, update, invalidate: () => { cached = undefined } })
}
