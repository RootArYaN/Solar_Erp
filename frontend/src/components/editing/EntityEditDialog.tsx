import { AlertTriangle, Loader2, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

export function EntityEditDialog({
  title,
  subtitle,
  children,
  isDirty,
  isSaving,
  error,
  conflict,
  saveLabel = 'Save changes',
  onClose,
  onSave,
  onReload,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  isDirty: boolean
  isSaving: boolean
  error?: string
  conflict?: boolean
  saveLabel?: string
  onClose: () => void
  onSave: () => void
  onReload?: () => void
}) {
  const cardRef = useRef<HTMLElement>(null)

  function requestClose() {
    if (isSaving) return
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKey)
    cardRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => window.removeEventListener('keydown', handleKey)
  }, [isDirty, isSaving])

  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <section ref={cardRef} className="modal-card entity-edit-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-card__header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" onClick={requestClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="modal-card__body entity-edit-dialog__body" data-scroll-surface="modal-body">
        {conflict && <div className="entity-edit-dialog__conflict"><AlertTriangle size={16} /><div><strong>Record changed elsewhere</strong><p>Reload the latest data before saving again.</p></div>{onReload && <button type="button" className="secondary-button secondary-button--compact" onClick={onReload}>Reload latest</button>}</div>}
        {error && !conflict && <div className="inline-error">{error}</div>}
        {children}
      </div>
      <footer className="entity-edit-dialog__footer">
        <button type="button" className="secondary-button" onClick={requestClose} disabled={isSaving}>Cancel</button>
        <button type="button" className="primary-button" onClick={onSave} disabled={isSaving || !isDirty || conflict}>{isSaving && <Loader2 className="spin" size={15} />}{saveLabel}</button>
      </footer>
    </section>
  </div>
}
