import katex from 'katex'

// KaTeX markup is cached per formula: the board re-renders every animation
// frame, formulas do not change. DSH already loads KaTeX's stylesheet and
// fonts for its own Markdown, so only the renderer is bundled here, and it
// must be the version of that stylesheet (0.18.7 in DSH 0.2.1): KaTeX 0.18
// renamed its layout classes (katex-sizing, katex-strut, …), and markup from
// another version loses its superscript sizes and stacked symbols such as ≠.
const cache = new Map()

export function renderTex(tex, display = false) {
  const key = `${display ? 'D' : 'I'}${tex}`
  let html = cache.get(key)
  if (html === undefined) {
    try {
      html = katex.renderToString(String(tex), { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, maxSize: 20, maxExpand: 500, output: 'htmlAndMathml' })
    } catch {
      html = null
    }
    if (cache.size > 2000) cache.clear()
    cache.set(key, html)
  }
  return html
}

export function TeX({ tex, display = false }) {
  const html = renderTex(tex, display)
  if (html === null) return <code>{tex}</code>
  return <span className={display ? 'aha-tex aha-tex-display' : 'aha-tex'} dangerouslySetInnerHTML={{ __html: html }} />
}
