// Error boundaries for the plugin's surfaces. Without one, a crash while
// rendering or in an effect reaches DSH's slot boundary, which blanks the
// whole plugin page, or takes away the board tab or every card of a tool,
// until DSH reloads. Plain JS rather than JSX so the tests can render it.

import { Component, createElement as h } from 'react'

// Shows `fallback({ error, retry })` in place of children that crashed.
// retry() renders the children again, and so does a new `resetKey`.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false, error: null, resetKey: props.resetKey }
    this.retry = () => this.setState({ failed: false, error: null })
  }

  static getDerivedStateFromError(error) {
    return { failed: true, error }
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey === state.resetKey ? null : { failed: false, error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error) {
    this.props.onError?.(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback({ error: this.state.error, retry: this.retry })
  }
}

function errorDetail(error) {
  return String(error?.message ?? error).slice(0, 300)
}

// What shows instead of the part that crashed: one plain line with the raw
// error on hover, and only the ways out it is given. `place` is 'page' (the
// full page's content), 'tab' (the board tab) or 'card' (a tool card).
export function CrashNotice({ t, error, place = 'page', onRetry, onHome }) {
  const retry = onRetry ? h('button', { type: 'button', className: 'aha-btn', 'data-size': place === 'page' ? undefined : 'sm', onClick: onRetry }, t('retry')) : null
  if (place === 'card') {
    return h('div', { className: 'aha-spread', role: 'alert' }, h('span', { className: 'aha-error', title: errorDetail(error) }, t('crashPart')), retry)
  }
  if (place === 'tab') {
    return h('div', { className: 'aha-col', role: 'alert', style: { gap: 8 } }, h('p', { className: 'aha-error', title: errorDetail(error) }, t('crashPart')), retry ? h('div', null, retry) : null)
  }
  return h('div', { className: 'aha-page' },
    h('div', { className: 'aha-card', role: 'alert', style: { alignItems: 'center', textAlign: 'center', gap: 12, padding: '28px 16px' } },
      h('p', { className: 'aha-cardTitle', title: errorDetail(error) }, t('crashPage')),
      retry ? h('p', { className: 'aha-hint' }, t('crashPageHint')) : null,
      h('div', { className: 'aha-row', style: { justifyContent: 'center' } },
        retry,
        h('button', { type: 'button', className: 'aha-btn', 'data-kind': 'primary', onClick: onHome }, t('backHome')))))
}
