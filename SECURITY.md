# Security

## Reporting

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/BaronCyrus/dsh-aha-tutor/security/advisories/new) rather than public issues. Never paste API keys, tokens or personal study data into an issue.

## What the plugin trusts, and what it does not

Model output, uploaded files and fetched web pages are all treated as untrusted input.

| Surface | Protection |
| --- | --- |
| Board text and Markdown | Rendered by DSH's Markdown renderer (raw HTML disabled) or as plain text; KaTeX runs with `trust: false` |
| Model-drawn SVG | Parsed and rebuilt through an allow-list of elements and attributes: no scripts, event handlers, `foreignObject`, external `href`, `url()` outside the document, or CSS that can fetch |
| Animations | Run in `<iframe sandbox="allow-scripts">` without same-origin access and with a CSP of `default-src 'none'`, so they cannot reach DSH, cookies or the network |
| Web import | `http(s)` only; localhost, private, link-local and metadata addresses are refused, redirects are followed by hand and re-checked; 20 s timeout and size limits |
| Uploads | 60 MB per file, 10 MB per image; parsed host-side with pdf.js (no eval), mammoth and JSZip; text capped at 2 M characters per material |
| Project folders | Starter-file paths are validated (relative, no `..`, no Windows reserved names); existing files are never overwritten; reviews read only text files, skip symlinks and cap the total size |
| Course packs | Imports are fully re-normalized, get fresh ids and are size-limited; nothing in a pack executes on import |

## Secrets

- Cloud TTS keys are stored with DSH's credential store (record-style, no fallback to environment variables) and used host-side only. Settings responses report only whether a key exists.
- TTS requests use `redirect: 'error'`, a 45 s timeout and a response size limit; plain `http` is accepted only for a TTS server on `localhost`.
- The plugin never logs request bodies, keys or package-manager output to the browser.

## Browser ↔ host

- The RPC channel `/aha-tutor` and the routes `/api/aha-tutor/upload` and `/api/aha-tutor/tts` are served by DSH's connection layer, which requires an authenticated browser session (owner). The handler additionally rejects non-owner peers.
- Every payload is validated (id formats, enums, sizes) before reaching a service; errors returned to the browser carry only messages written for users.

## Plugin updates

The in-app update installs an exact registry version with DSH's own pnpm inside the owning profile and never overrides pnpm's `minimumReleaseAge` (no `--config.minimumReleaseAge`, no edits to `minimumReleaseAgeExclude`, no `--force`). A version held back by the cooldown is reported as pending. Local `link:` installs are never updated in place.
