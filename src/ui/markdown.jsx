import { useMemo } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

import { useApp } from './hooks.js'

// DSH's own Markdown renderer (GFM + KaTeX, raw HTML disabled) for prompts,
// explanations, notes and feedback.
export function RichText({ text, compact = false, streaming = false }) {
  const { t } = useApp()
  const labels = useMemo(() => ({ code: { copyLabel: t('copyCode'), copiedLabel: t('copied') }, footnotes: t('footnotes') }), [t])
  return <div className="aha-markdown"><MarkdownText text={String(text ?? '')} labels={labels} streaming={streaming} variant={compact ? 'compact' : 'body'} /></div>
}
