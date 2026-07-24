import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

type AlertDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning'
  loading?: boolean
  icon?: 'delete' | 'reset' | 'warning'
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

const icons = {
  delete: Trash2,
  reset: RotateCcw,
  warning: AlertTriangle,
}

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  icon = 'warning',
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const Icon = icons[icon]

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 40)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [loading, onCancel, open])

  if (!open) return null

  return (
    <div className="alert-dialog-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onCancel()
    }}>
      <section className={`alert-dialog alert-dialog--${variant}`} role="alertdialog" aria-modal="true" aria-labelledby="alert-dialog-title" aria-describedby={description ? 'alert-dialog-description' : undefined}>
        <header>
          <div className="alert-dialog__icon"><Icon size={20} /></div>
          <button type="button" className="alert-dialog__close" onClick={onCancel} disabled={loading} aria-label="Close dialog"><X size={17} /></button>
        </header>
        <div className="alert-dialog__body">
          <h2 id="alert-dialog-title">{title}</h2>
          {description && <p id="alert-dialog-description">{description}</p>}
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button type="button" className="danger-button" onClick={() => void onConfirm()} disabled={loading}>{loading ? 'Working…' : confirmLabel}</button>
        </footer>
      </section>
    </div>
  )
}
