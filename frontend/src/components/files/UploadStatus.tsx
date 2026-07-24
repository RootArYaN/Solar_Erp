import { RefreshCw, X } from 'lucide-react'
import type { UploadStatus as UploadState } from '../../contracts/api-contracts'

const labels: Record<UploadState, string> = {
  pending: 'Pending secure upload',
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Upload failed',
  cancelled: 'Cancelled',
}

export function UploadStatus({
  status,
  progress,
  failureMessage,
  onRetry,
  onCancel,
}: {
  status: UploadState
  progress: number
  failureMessage?: string | null
  onRetry?: () => void
  onCancel?: () => void
}) {
  const normalizedProgress = Math.min(100, Math.max(0, progress))
  const canCancel = ['pending', 'uploading', 'processing', 'failed'].includes(status)

  return <div className={`upload-status upload-status--${status}`}>
    <div className="upload-status__heading"><span>{labels[status]}</span><b>{normalizedProgress}%</b></div>
    <div className="upload-status__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalizedProgress}><span style={{ width: `${normalizedProgress}%` }} /></div>
    {failureMessage && <small>{failureMessage}</small>}
    {(status === 'failed' || canCancel) && <div className="upload-status__actions">
      {status === 'failed' && onRetry && <button type="button" onClick={onRetry}><RefreshCw size={11} /> Retry</button>}
      {canCancel && onCancel && <button type="button" onClick={onCancel}><X size={11} /> Cancel</button>}
    </div>}
  </div>
}
