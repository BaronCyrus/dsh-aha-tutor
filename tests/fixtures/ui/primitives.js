// Stands in for DSH's client UI primitives, which load only in DSH's web
// client: Markdown shows as its plain text.
import { createElement } from 'react'

export function MarkdownText({ text }) {
  return createElement('span', { className: 'markdown' }, text)
}
