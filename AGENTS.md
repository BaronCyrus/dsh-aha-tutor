# Repository agent guide

This file governs the entire `dsh-aha-tutor` repository.

## Repository identity

- Canonical repository: `https://github.com/BaronCyrus/dsh-aha-tutor`
- npm package: `dsh-aha-tutor`
- DSH plugin rows: `aha-tutor` (the plugin) and `preset-aha-tutor` (the conversation preset), both inserted by `cordis.patch.yml`
- Product name: 「开窍 · AI 私人老师」, English "Aha Tutor"; mascot 「小窍」
- RPC channel `/aha-tutor`; HTTP routes `/api/aha-tutor/upload`, `/api/aha-tutor/tts`, `/api/aha-tutor/speech` and `/api/aha-tutor/font`
- Data directory: `$DSH_HOME/aha-tutor/`; project folders: `~/AhaTutor/projects/`

## Project boundaries

- This is a permanent DSH profile plugin, not a temporary dynamic Cordis plugin. It has three entries:
  - `src/index.js` (host): storage, generation, materials, voices, jobs and the RPC handler, built from `src/host/` and `src/core/`.
  - `src/agent.js` (`dsh-aha-tutor/agent`): the conversation preset's tools and system-prompt section.
  - `src/client.jsx` (browser): the full-page app, sidebar entry, right-sidebar board tab and tool cards, built from `src/ui/` through the client wrapper in `tsdown.config.mjs`.
- `src/core/` is pure logic shared by host and browser (mastery, SRS, planner, grading, board scripts and their fixes, plot formulas, course model, retrieval, JSON extraction). Keep it free of Node and DOM APIs.
- Formulas are rendered by the bundled KaTeX and styled by the KaTeX stylesheet and fonts DSH loads. The bundled version must be the stylesheet's version (0.18.7 in DSH 0.2.1); KaTeX renames layout classes between versions. `tests/package-contract.test.mjs` pins it; change both together when DSH moves.
- Generation uses only the model the user chose: DSH's default model or the plugin's two overrides ("teach" and "quick"). Never fall back to another provider, model or credential source on a failure.
- Web research before course design goes through DSH's own web service (`ctx.get('web')`) and whatever search provider DSH is configured with. The plugin never calls a search vendor or touches its credentials; when DSH cannot search, the course is designed without research and the reason is shown.
- Voice questions go through DSH's own speech service (`ctx.get('speechToText')`, the experimental Voice input bundle with local SenseVoice) with DSH's provider and language choices. The plugin never prepares or downloads a recognizer, keeps no audio and sends it nowhere else; until Voice input is enabled and ready, the microphone explains how to set it up.
- Generate on demand: course structure when the learner confirms the blueprint, a lesson's board when it is opened plus at most one prefetched next lesson. Never generate a whole course's boards in the background.
- Cloud TTS keys live in DSH's credential store as records and are used host-side only. Never fall back to environment variables, and never return a key to the browser.
- The in-plugin update installs an exact registry version with DSH's bundled pnpm in the owning profile, under the profile's own pnpm release-age policy. Never pass `--config.minimumReleaseAge`, never edit `minimumReleaseAgeExclude`, and never use `--force`: bypassing the policy leaves a lockfile entry pnpm later rejects, and the profile then refuses every plugin install until that version is 24 hours old. A version pnpm holds back is reported as pending with the time it becomes installable. Verify the installed version even on exit code 0. `link:` installs are never updated in place. After an update, tell the user to quit and reopen DSH.
- Copy, prompts, sample courses and artwork are original to this project. Do not copy text, UI wording, names, logos or images from other learning products, and do not describe the plugin as a clone of one.
- Artwork (`icon.png`, `docs/assets/*.png`, the sidebar icon in `src/ui/icons.jsx`) is made with ChatGPT image generation in the maintainer's browser. Do not substitute stock art or other generators.

## macOS and Windows

The plugin runs inside DSH on both systems. Every change must keep working on both:

- Build paths with `node:path` (`join`, `relative`, `sep`) and `os.homedir()`; never concatenate with `/` or assume `~`. Store files under ids, not user-supplied names, and pass learner-visible names through `safeFileName`.
- Write files with `writeFileAtomic` (it retries `EPERM`/`EBUSY` renames that Windows antivirus and indexers cause).
- Spawn processes without a shell. The pnpm launcher prefers DSH's own `process.execPath` + `pnpm.mjs`; the Windows fallback `pnpm.cmd` is the only place a shell is allowed.
- Text uploads decode as UTF-8 with a GB18030 fallback; normalize `\r\n`.
- UI fonts and voices come from per-OS stacks; never hard-code a single system font or voice name. The one exception is the board's handwriting: the bundled LXGW WenKai GB and Caveat subsets in `assets/fonts/` come first, with the per-OS stack as the fallback.
- Tests that need links use junctions on Windows. CI runs the tests on Ubuntu, macOS and Windows.

## Security requirements

- Model output, uploads, course packs, fetched web pages and web search results are untrusted. Search results keep http(s) links only, are length-capped, reach prompts as reference material (never as instructions) and open outside the app. Keep `src/ui/sanitize.js`'s SVG allow-list, the sandboxed animation iframe (`sandbox="allow-scripts"`, no same-origin, `default-src 'none'` CSP), Markdown without raw HTML and KaTeX with `trust: false`. Plot formulas are read by `src/core/expr.js` and evaluated over numbers only, never as code (no `eval`, `Function` or iframe).
- Web import refuses non-`http(s)` URLs and localhost, private, link-local and metadata addresses, follows redirects by hand and re-checks each hop.
- Project files: starter paths go through `safeRelativePath`; existing files are never overwritten; reviews read text files only, skip symlinks and cap the total size.
- Browser RPC validates every payload and returns only user-facing error messages. Never print, log, commit or return to the browser any API key, token or package-manager output.
- Preserve unrelated DSH plugins, profiles, sessions, settings and credentials.
- Do not start, stop or restart DSH without explicit user permission. Self-tests run in a separate `DSH_HOME` with a `link:` install, never in the user's desktop profile.

## Source and generated files

- Edit `src/`; never hand-edit `lib/`. `lib/` is tracked (`index.js`, `agent.js`, their shared runtime chunk and `client.js`) and must be regenerated with `pnpm run build` after source changes; CI fails when it differs from a fresh build. `lib/client.js.map` is ignored.
- `samples/*.aha-course.json` are generated by `node scripts/build-samples.mjs` through the plugin's own normalizers; edit the script, not the JSON.
- `assets/fonts/*` and `src/core/board-fonts.js` are generated by `python3 -I scripts/build-fonts.py <sources…>` (fonttools and brotli; the script's docstring names the source versions); edit the script, not its output, and keep the fonts' OFL licenses beside them.
- User-facing strings live in `src/ui/i18n.js` (zh and en, same keys) and `locale/*.json` (package metadata). `tests/package-contract.test.mjs` checks both languages and that every endpoint the browser calls is routed.
- `docs/releases/v<version>.md` holds each version's GitHub Release notes. It is tracked and not packaged.
- `.artifacts/` and `node_modules/` are ignored and must never be committed.
- Add or update tests under `tests/` for behavior changes.

## Required validation

```sh
pnpm install
pnpm run check
```

`pnpm run check` must run every test, rebuild all bundles and produce the versioned tarball in `.artifacts/`.

A UI change is verified in a running DSH, not by a passing build alone: link the repository into a scratch profile (`DSH_HOME=<scratch> dsh plugin --profile web add link:<repo>`), start that DSH and check the change in its web client, in both light and dark themes and at a narrow width. Flows that call a model consume the user's quota; ask before running them against the user's own models.

## Release authorization

`npm publish`, Git tags, GitHub Releases and version publication are externally visible and partially irreversible. Execute them only when the user explicitly asks to publish or release and confirms the target version. A request to modify, test or commit alone is not release authorization.

Never reuse, move, delete or overwrite a published npm version or Git tag. If a published version needs a correction, create a new patch version.

## Release cadence

- Tags publish straight to npm's `latest`, which the in-plugin update button and DSH's Plugins page install.
- With DSH's default pnpm settings an exact version installs as soon as it is published: pnpm adds `dsh-aha-tutor@<version>` to the profile's `minimumReleaseAgeExclude` itself. The in-plugin update installs that way, and so does the Plugins page when given `dsh-aha-tutor@<version>`; given only the package name, the Plugins page picks the newest version published at least 24 hours ago. Only a profile that sets `minimumReleaseAge` explicitly holds a new version back, and the in-plugin update then reports it as pending with the time it becomes installable.
- Releases need no 24-hour spacing. Spacing only protects users of update buttons that bypass the cooldown with `--config.minimumReleaseAge`, and this plugin's button has never done that.
- A broken release reaches `latest` at once: deprecate it on npm and publish a fixed patch version.

## First release

npm configures a trusted publisher only for a package that already exists, so 1.0.0 is published by the maintainer, not by CI:

1. Finish the release checklist up to step 4 for 1.0.0.
2. The maintainer runs `npm publish .artifacts/dsh-aha-tutor-1.0.0.tgz --access public` on their own machine, logged in to npm with 2FA. Never ask for a token, password or one-time code in chat.
3. The maintainer adds the trusted publisher on npmjs.com: repository `BaronCyrus/dsh-aha-tutor`, workflow filename `publish.yml`, environment empty.
4. Push the `v1.0.0` tag. The workflow finds 1.0.0 already on npm, skips publishing and creates the GitHub Release with the tarball npm serves.

Every later version is published by its tag with GitHub OIDC.

## Release checklist

1. Synchronize and confirm a clean base:

   ```sh
   git fetch origin --tags --prune
   git status --short --branch
   git log --oneline HEAD..origin/main
   ```

   Fast-forward clean remote changes before editing. Never discard remote changes.

2. Confirm the requested SemVer is unused:

   ```sh
   npm view dsh-aha-tutor@<version> version --json
   git ls-remote --exit-code --tags origin refs/tags/v<version>
   ```

   For an unused npm version, `npm view` normally returns `E404`. An existing npm version or Git tag requires choosing a new version.

3. Update all release metadata together: `package.json` version, `CHANGELOG.md`, `compatibility.json` when the tested DSH version changed, any version pinned in `README.md` / `README.en.md`, and the GitHub Release notes in `docs/releases/v<version>.md`. The notes are in Chinese:
   - The first line is `# v<version>：<短标题>`, which becomes the release title.
   - Then a one-sentence summary and bullets with bold labels.
   - Then a `验证：…` paragraph.
   - They close with `在 DSH 插件管理中更新至 **<version>**，然后重新打开 DSH 加载新版。`

   `node scripts/release-notes.mjs <version>` checks the file, and `pnpm run check` fails while the current `package.json` version has no valid notes or changelog entry.

4. Validate and inspect the exact release artifact:

   ```sh
   pnpm install --frozen-lockfile
   pnpm run check
   npm publish .artifacts/dsh-aha-tutor-<version>.tgz --access public --dry-run --json
   ```

5. Commit the release and push `main` without force. [`.github/workflows/publish.yml`](.github/workflows/publish.yml) must already be on the commit that will be tagged. Do not push the tag in this step.

6. Confirm the package has its GitHub Actions trusted publisher (repository `BaronCyrus/dsh-aha-tutor`, workflow filename `publish.yml`, environment empty). `workflow_dispatch` on the Publish workflow prints the OIDC identity npm will match and does not publish.

7. Create the annotated tag and push it. That push publishes to npm's `latest` with GitHub OIDC; the `release` job then creates the GitHub Release from `docs/releases/v<version>.md`, attaches the tarball npm published and marks it Latest. `release` is the only job with `contents: write`, and it runs no dependency code. Do not run `npm publish` locally after the first release, and do not set `NODE_AUTH_TOKEN` or a setup-node `registry-url` in the workflow; npm treats either as token auth and skips OIDC.

   ```sh
   git tag -a v<version> -m "dsh-aha-tutor v<version>"
   git push origin v<version>
   ```

8. Confirm that both jobs of the tag's run succeeded, that npm's `latest` serves the version (`npm view dsh-aha-tutor dist-tags --prefer-online`; without `--prefer-online` a cached 404 can linger), and that `gh release view v<version>` shows the notes and the `dsh-aha-tutor-<version>.tgz` asset. On an OIDC `package not found` error, fix the trusted publisher and re-run the same workflow; a re-run finds the version already published and only finishes the release. If the tagged tree itself must change, publish a new patch version.
