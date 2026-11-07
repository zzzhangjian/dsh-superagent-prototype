// @vitest-environment jsdom
// The Issue sidebar entry, its list page, and the Thread a row opens.
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { apply } from '../src/client/index.tsx'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
import { usePanel, mountIssues, remountIssues, settle, all, find, click, text, translator } from './fixtures/panel.tsx'
import { server, issueRow, threadSummary } from './fixtures/panel-server.ts'

const t = translator(zh)
usePanel()
type Entry = { options: { name: string; id?: string; key?: string; order?: number; label?: () => string }
  component: ComponentType<{ t: T }> }
/** Register the plugin's slots against a fake DSH host and return what it registered, in registration order. */
function registered() {
  const entries: Entry[] = []
  const ctx = {
    slots: { inject: (_name: string, register: () => void) => register(),
      register: (options: Entry['options'], component: Entry['component']) => { entries.push({ options, component }); return () => {} } },
    locale: { register: () => () => {}, bind: () => t },
    effect: (effect: () => unknown) => { effect() },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) }, refresh: async () => {} },
    uiWorkspace: { openSession: () => {} },
    get: () => undefined,
  }
  apply(ctx as never)
  return entries
}
/** A Thread page for an Issue key, so a clicked row has an answer to render. */
const issueThread = (key: string, title: string) => ({ ...threadSummary({ key, title }), tickets: [], correlated: [], decisions: [],
  earlier: null, context: [], timeline: [] })
const headings = (selector: string) => all(selector).map(element => element.textContent)

it('adds a second sidebar entry, ordered after the management one, whose own main panel lists the repository\'s Issues', async () => {
  const entries = registered()
  const management = entries.find(entry => entry.options.id === 'dsh-superagent')!
  const nav = entries.find(entry => entry.options.id === 'dsh-superagent-issues')!
  expect(nav.options.order).toBeGreaterThan(management.options.order!)
  expect(nav.options.label?.()).toBe(zh.issuePanel)
  // The list is a separate keyed main panel, not a seventh tab on the management panel.
  const panel = entries.find(entry => entry.options.key === 'dsh-superagent-issues')!
  expect(panel).toBeDefined()
  server.issues = [issueRow(), issueRow({ key: 'github:9', number: 9, title: 'Slow start', state: 'closed', work: 0 }),
    issueRow({ key: 'github:8', number: 8, title: 'Old import', state: 'unknown', work: 3 })]
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<panel.component t={t} />) })
  await settle()
  expect(headings('.dt-row .dt-row-title')).toEqual(['Login fails', 'Slow start', 'Old import'])
  expect(headings('.dt-row .dt-stage')).toEqual(['#7', '#9', '#8'])
  // Open, closed, and an unrecorded state are told apart rather than assumed; attached work is counted per Issue.
  expect(headings('.dt-row .dt-tag')).toEqual([t('issueState.open'), t('issueWork', { count: 1 }), t('issueState.closed'),
    t('issueState.unknown'), t('issueWork', { count: 3 })])
  expect(text()).toContain(t('issueNoWork'))
  expect(document.querySelector('.dt-row[data-state="warning"] .dt-row-title')?.textContent).toBe('Old import')
  expect(text()).toContain('acme/widgets')
  act(() => { root.unmount() }); container.remove()
})

it('opens the Thread of the Issue a row names, then returns to the list', async () => {
  server.threadPages = key => key === 'github:7' ? issueThread(key, '#7 Login fails') : undefined
  await mountIssues()
  expect(text()).toContain('Login fails')
  await click('Login fails')
  expect(server.requests.some(request => request.path === 'threads/github:7?limit=50')).toBe(true)
  expect(text()).toContain('#7 Login fails')
  // The Thread page's back button carries the Issue panel's own label and returns without leaving the panel.
  expect(find(zh.issuePanel, '.dt-page-head .dt-btn')).toBeTruthy()
  await click(zh.issuePanel)
  expect(headings('.dt-row .dt-row-title')).toEqual(['Login fails'])
})

it('says whether no repository is resolved or no Issue has been received, instead of showing nothing', async () => {
  server.issues = []
  await mountIssues()
  expect(text()).toContain(zh.issuesNone)
  expect(text()).not.toContain(zh.issuesNoRepository)
  expect(all('.dt-row')).toEqual([])
  server.repository = undefined
  await remountIssues()
  expect(text()).toContain(zh.issuesNoRepository)
  expect(text()).not.toContain(zh.issuesNone)
})
