/** Issue list panel: the watched repository's Issues, each opening the existing per-Issue Thread page. */
import { useCallback, useState } from 'react'
import { usePoll, type IssueRow, type IssueState } from './api.ts'
import { InfoTip, Tag, type TagTone } from './controls.tsx'
import { PanelProvider, usePanel } from './provider.tsx'
import type { Route } from './route.ts'
import type { T } from './text.ts'
import { ThreadPage } from './thread.tsx'
import { ActionLink, Hint, LoadMore, LoadState, StageMark, When } from './widgets.tsx'

const STATE_TONE: Record<IssueState, TagTone> = { open: 'success', closed: 'neutral', unknown: 'warning' }

/** One Issue as a list row: number and state on the left, then title, state, attached work, and the GitHub link. */
function IssueLine({ issue }: { issue: IssueRow }) {
  const { t, navigate } = usePanel()
  const unknown = issue.state === 'unknown'
  return <li className="dt-row dt-link dt-ticket" data-state={unknown ? 'warning' : undefined}>
    <div className="dt-ticket-stage">
      <StageMark state={unknown ? 'warning' : 'idle'} icon="hash" label={`#${issue.number}`} />
    </div>
    <div className="dt-ticket-body">
      <div className="dt-row-title"><button type="button" className="dt-open"
        onClick={() => navigate({ page: 'trigger', id: issue.key })}>{issue.title}</button></div>
      <div className="dt-row-meta dt-ticket-meta">
        <Tag tone={STATE_TONE[issue.state]} title={unknown ? t('issueStateUnknownHint') : undefined}>
          {t(`issueState.${issue.state}`)}
        </Tag>
        {issue.work > 0 ? <Tag tone="quiet">{t('issueWork', { count: issue.work })}</Tag> : <span>{t('issueNoWork')}</span>}
        <When at={issue.lastAt} />
      </div>
      <div className="dt-ticket-actions">{issue.url && <ActionLink href={issue.url}>{t('openOriginal')}</ActionLink>}</div>
    </div>
  </li>
}

/** The list itself; it names the repository it lists and which of the two empty states it is in. */
function IssueList() {
  const { t, call } = usePanel()
  const [limit, setLimit] = useState(20)
  const { data, error } = usePoll(() => call('GET issues', { query: { limit } }), [limit])
  return <>
    <div className="dt-status-head">
      <h2 className="dt-status-title">{t('issuePanel')}<InfoTip text={t('issuesIntro')} /></h2>
    </div>
    {data?.repository && <div className="dt-row-meta"><span>{data.repository}</span></div>}
    <LoadState error={error} loading={!data} />
    {data && (data.items.length
      ? <ul className="dt-list">{data.items.map(issue => <IssueLine key={issue.key} issue={issue} />)}</ul>
      : <Hint>{data.repository ? t('issuesNone') : t('issuesNoRepository')}</Hint>)}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 20)} />}
  </>
}

/**
 * Root of the Issue sidebar panel: the list, or the Thread of the Issue a row opened.
 * Its navigation is local — the panel keeps its own list↔Thread history so it never drives the management tabs.
 */
export function IssuesApp({ t, openSession }: { t: T; openSession: (sessionId: string) => Promise<void> }) {
  const [open, setOpen] = useState<string>()
  const back = useCallback(() => setOpen(undefined), [])
  const navigate = useCallback((route: Route) => {
    if (route.page === 'trigger' && route.id !== undefined) setOpen(route.id)
  }, [])
  return <PanelProvider t={t} openSession={openSession} navigate={navigate} back={back} backLabel={t('issuePanel')}>
    <div className="dt-page"><div className="dt-column">
      {open === undefined ? <IssueList /> : <ThreadPage key={open} id={open} />}
    </div></div>
  </PanelProvider>
}
