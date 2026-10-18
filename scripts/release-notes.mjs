#!/usr/bin/env node
/**
 * The GitHub Release notes of one version, from `docs/releases/v<version>.md`.
 *
 *   node scripts/release-notes.mjs <version> [--body-file <path>]
 *
 * Prints the release title and, with `--body-file`, writes the release body
 * there. Exits 1 with a reason when the notes are missing or malformed, so the
 * Publish workflow can refuse a tag before npm publishes it. Node built-ins
 * only: the release job runs this without installing dependencies.
 *
 * A notes file starts with `# v<version>：<中文短标题>`; the rest is the body,
 * which must tell readers to update to **<version>**.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+$/u
const TITLE = /^# (v\d+\.\d+\.\d+)：(\S.*)$/u

/** The notes file of `version` under the repository root. */
export function releaseNotesUrl(version, root = new URL('../', import.meta.url)) {
  return new URL(`docs/releases/v${version}.md`, root)
}

/**
 * Validate one notes file and split it into the release title and body.
 * @param text - the file's contents.
 * @param version - the version the notes must describe.
 * @returns `{ title, body }`, the title without its heading mark.
 */
export function parseReleaseNotes(text, version) {
  if (!VERSION.test(String(version))) throw new Error(`release notes need a plain version such as 1.0.1, not "${version}"`)
  const [first = '', ...rest] = String(text).replace(/\r\n/gu, '\n').split('\n')
  const heading = TITLE.exec(first.trim())
  if (heading === null) throw new Error(`release notes must start with "# v${version}：<title>"`)
  if (heading[1] !== `v${version}`) throw new Error(`release notes are titled ${heading[1]}, not v${version}`)
  const body = rest.join('\n').trim()
  if (body === '') throw new Error(`release notes for v${version} have no body`)
  if (!body.includes(`**${version}**`)) throw new Error(`release notes for v${version} must tell readers to update to **${version}**`)
  return { title: `v${version}：${heading[2].trim()}`, body: `${body}\n` }
}

/** Read and validate the notes of `version`. */
export function readReleaseNotes(version, root) {
  let text
  try {
    text = readFileSync(releaseNotesUrl(version, root), 'utf8')
  } catch {
    throw new Error(`docs/releases/v${version}.md is missing; write the GitHub Release notes before tagging`)
  }
  return parseReleaseNotes(text, version)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, flag, path] = process.argv.slice(2)
  try {
    if (flag !== undefined && (flag !== '--body-file' || path === undefined)) throw new Error('usage: release-notes.mjs <version> [--body-file <path>]')
    const notes = readReleaseNotes(version)
    if (path !== undefined) writeFileSync(path, notes.body)
    console.log(notes.title)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
