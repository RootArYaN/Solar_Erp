import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogLifecycle } from './Dialog'

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
  const [confirming, setConfirming] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const Icon = icons[icon]
  const busy = loading || confirming
  const busyRef = useRef(busy)
  const onCancelRef = useRef(onCancel)
  busyRef.current = busy
  onCancelRef.current = onCancel

  useDialogLifecycle({
    open,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
    onClose: () => {
      if (!busyRef.current) onCancelRef.current()
    },
    closeOnEscape: !busy,
  })

  if (!open) return null

  async function confirm() {
    if (busy) return
    setConfirming(true)
    try {
      await onConfirm()
    } finally {
      setConfirming(false)
    }
  }

  return createPortal(
    <div className="alert-dialog-layer" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section ref={dialogRef} className={`alert-dialog alert-dialog--${variant}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <div className="alert-dialog__content">
          <div className="alert-dialog__icon"><Icon size={20} /></div>
          <div className="alert-dialog__body">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="alert-dialog__close" onClick={onCancel} disabled={busy} aria-label="Close dialog"><X size={17} /></button>
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={variant === 'danger' ? 'danger-button' : 'primary-button'} onClick={() => void confirm()} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
