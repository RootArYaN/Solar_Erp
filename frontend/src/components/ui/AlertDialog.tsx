import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open])

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
        <header>
          <div className="alert-dialog__icon"><Icon size={20} /></div>
          <button type="button" className="alert-dialog__close" onClick={onCancel} disabled={busy} aria-label="Close dialog"><X size={17} /></button>
        </header>
        <div className="alert-dialog__body">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="danger-button" onClick={() => void confirm()} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
