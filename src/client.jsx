// Browser entry of 「开窍 · AI 私人老师」: the full page behind a sidebar
// entry, a whiteboard tab for conversation sessions, and cards for the
// teacher preset's tools.

import { App } from './ui/App.jsx'
import { BoardTab, ToolCard } from './ui/conversation.jsx'
import { en, NS, zh } from './ui/i18n.js'
import { Icon } from './ui/icons.jsx'
import { STYLE } from './ui/styles.js'

export const inject = ['slots', 'locale', 'connection']

const PACKAGE = 'dsh-aha-tutor'
const PANEL_ID = 'aha-tutor'
const TAB_ID = 'dsh-aha-tutor/board'
const TAB_KIND = 'ahaTutorBoard'
const TOOLS = ['aha_whiteboard', 'aha_quiz', 'aha_course', 'aha_cheatsheet', 'aha_learner']

function PanelIcon({ size }) {
  return <Icon name="logo" size={size} />
}

function MainPage({ rpc, t, language, dsh }) {
  return <App rpc={rpc} t={t} language={language()} dsh={dsh} />
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aha-tutor: copy')
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PACKAGE
    tag.textContent = STYLE
    document.head.append(tag)
    return () => tag.remove()
  }, 'aha-tutor: style')

  const t = ctx.locale.bind(NS)
  const rpc = ctx.get('connection').rpc
  const language = () => (String(ctx.locale.getLocale?.()?.active ?? 'zh').startsWith('zh') ? 'zh' : 'en')

  const dsh = Object.freeze({
    selectPanel: () => ctx.get('layout')?.selectPanel?.(PANEL_ID),
    // Register (or reuse) the folder as a workspace and open a session there
    // with the prompt pre-filled; the learner sends it.
    async openWorkspace(path, prompt) {
      const workspaces = ctx.get('workspaces')
      const ui = ctx.get('uiWorkspace')
      if (typeof workspaces?.create !== 'function' || typeof ui?.startSession !== 'function') return false
      const workspace = await workspaces.create({ path })
      ui.startSession(workspace.workspaceId, { prompt, clearPreviousDraft: true })
      return true
    },
    openBoardTab(params) {
      const sidebar = ctx.get('sidebarRight')
      if (typeof sidebar?.openTab !== 'function') return false
      try {
        sidebar.openTab(TAB_KIND, { params })
        return true
      } catch {
        return false
      }
    },
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ rpc, language, dsh }),
  }, MainPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panelLabel'),
  }, PanelIcon))

  // Whiteboard tab in the right sidebar of conversation sessions.
  ctx.inject(['sidebarRightTabs'], tabCtx => {
    tabCtx.effect(() => tabCtx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => t('boardSession'),
      keepMounted: true,
    }), 'aha-tutor: board tab')
  })
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: () => ({ rpc, language: language(), dsh }),
  }, BoardTab))

  for (const toolName of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: toolName,
      locale: NS,
      inject: () => ({ rpc, language: language(), dsh }),
    }, ToolCard))
  }
}
