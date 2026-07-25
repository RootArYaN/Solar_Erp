import { AlertTriangle, CloudOff, Inbox, RefreshCw } from 'lucide-react'

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="page-skeleton" aria-label="Loading"><div className="page-skeleton__heading" />{Array.from({ length: rows }, (_, index) => <div className="page-skeleton__row" key={index} />)}</div>
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return <div className="page-empty"><Inbox size={24} /><strong>{title}</strong>{message && <span>{message}</span>}{action}</div>
}

export function ErrorState({ message, onRetry, requestId }: { message: string; onRetry: () => void; requestId?: string | null }) {
  return <div className="page-error"><AlertTriangle size={24} /><strong>Could not load this page</strong><span>{message}</span>{requestId && <small>Request ID: {requestId}</small>}<button className="secondary-button" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>
}

export function DataFreshness({ offline, stale, updatedAt }: { offline: boolean; stale: boolean; updatedAt?: string | null }) {
  if (!offline && !stale) return null
  return <div className={`data-freshness ${offline ? 'data-freshness--offline' : ''}`}><CloudOff size={14} /><span>{offline ? 'Offline. Showing the last available view.' : 'This view may be stale.'}{updatedAt ? ` Updated ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updatedAt))}.` : ''}</span></div>
}

export function ReadOnlyNotice() {
  return <div className="read-only-notice">You have view-only access. Editing and approval controls are disabled.</div>
}
