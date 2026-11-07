/** Issue list view: the watched repository's GitHub Issues among stored Threads, with state and attached work. */
import type { Thread } from '../../core/index.ts'
import { page, threadTitle, type ViewHost } from './records.ts'
import { attribute } from './text.ts'

/** The Issue's state as GitHub reports it, or `unknown` for a Thread described before the state was stored. */
export type IssueState = 'open' | 'closed' | 'unknown'
const stateOf = (thread: Thread): IssueState => {
  const value = attribute(thread.meta.state)
  return value === 'open' || value === 'closed' ? value : 'unknown'
}
/** An Issue or pull request Thread holds the GitHub number as its ref id; `ci:` Threads and PRs are not Issues to list. */
function issueNumber(thread: Thread): number | undefined {
  if (thread.ref.source !== 'github' || thread.ref.id.startsWith('ci:') || thread.meta.isPr === true) return undefined
  const number = Number(thread.ref.id)
  return Number.isInteger(number) && number > 0 ? number : undefined
}
function issueRow(store: ViewHost['store'], thread: Thread) {
  const number = issueNumber(thread) as number
  // `meta.title` is the Issue title as GitHub states it; a Thread described only by its label starts with `#<number>`.
  const title = attribute(thread.meta.title) ?? threadTitle(store, thread).replace(/^#\d+\s+/, '')
  return { key: thread.key, number, title, state: stateOf(thread), work: thread.subscriptions.length + (thread.context?.length ?? 0),
    url: attribute(thread.meta.url), lastAt: thread.lastAt ?? thread.createdAt }
}
/**
 * Lists the watched repository's Issues, newest number first, as one row per stored Issue Thread.
 * `repository` is the configured repository, or undefined while setup has not resolved one, so the panel can say which empty state it is.
 */
export function issueList(host: ViewHost, repository: string | undefined, offset: number, limit: number) {
  const { store } = host
  const issues = store.threads.list().map((thread, index) => ({ thread, index }))
    .filter(({ thread }) => issueNumber(thread) !== undefined)
    .sort((a, b) => (issueNumber(b.thread) as number) - (issueNumber(a.thread) as number) || a.index - b.index)
    .map(({ thread }) => thread)
  const result = page(issues, offset, limit)
  return { ...(repository ? { repository } : {}), ...result, items: result.items.map(thread => issueRow(store, thread)) }
}
export type IssueListView = ReturnType<typeof issueList>
export type IssueRowView = IssueListView['items'][number]
