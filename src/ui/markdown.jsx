import { useMemo } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

import { useApp } from './hooks.js'

// DSH's own Markdown renderer (GFM + KaTeX, raw HTML disabled) for prompts,
// explanations, notes and feedback, in the size and colour of the text
// around it (styles.js), or of className.
export function RichText({ text, compact = false, streaming = false, className = '' }) {
  const { t } = useApp()
  const labels = useMemo(() => ({ code: { copyLabel: t('copyCode'), copiedLabel: t('copied') }, footnotes: t('footnotes') }), [t])
  return <div className={className ? `aha-markdown ${className}` : 'aha-markdown'}><MarkdownText text={String(text ?? '')} labels={labels} streaming={streaming} variant={compact ? 'compact' : 'body'} /></div>
}
