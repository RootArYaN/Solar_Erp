import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="page-skeleton" aria-label="Loading"><div className="page-skeleton__heading" />{Array.from({ length: rows }, (_, index) => <div className="page-skeleton__row" key={index} />)}</div>
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return <div className="page-empty"><Inbox size={24} /><strong>{title}</strong>{message && <span>{message}</span>}{action}</div>
}

export function ErrorState({ message, onRetry, requestId }: { message: string; onRetry: () => void; requestId?: string | null }) {
  return <div className="page-error"><AlertTriangle size={24} /><strong>Could not load this page</strong><span>{message}</span>{requestId && <small>Request ID: {requestId}</small>}<button className="secondary-button" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>
}

export function ReadOnlyNotice() {
  return <div className="read-only-notice">You have view-only access. Editing and approval controls are disabled.</div>
}
