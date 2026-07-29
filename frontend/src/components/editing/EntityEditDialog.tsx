import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AlertDialog } from '../ui/AlertDialog'
import { Dialog } from '../ui/Dialog'

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
  const [discardOpen, setDiscardOpen] = useState(false)

  function requestClose() {
    if (isSaving) return
    if (isDirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  return <>
    <Dialog
      title={title}
      subtitle={subtitle}
      className="entity-edit-dialog"
      bodyClassName="entity-edit-dialog__body"
      closeDisabled={isSaving}
      closeOnEscape={!discardOpen}
      trapFocus={!discardOpen}
      onClose={requestClose}
      footer={(
        <footer className="entity-edit-dialog__footer">
          <button type="button" className="secondary-button" onClick={requestClose} disabled={isSaving}>Cancel</button>
          <button type="button" className="primary-button" onClick={onSave} disabled={isSaving || !isDirty || conflict}>
            {isSaving && <Loader2 className="spin" size={15} />}{saveLabel}
          </button>
        </footer>
      )}
    >
      {conflict && <div className="entity-edit-dialog__conflict"><AlertTriangle size={16} /><div><strong>Record changed elsewhere</strong><p>Reload the latest data before saving again.</p></div>{onReload && <button type="button" className="secondary-button secondary-button--compact" onClick={onReload}>Reload latest</button>}</div>}
      {error && !conflict && <div className="inline-error">{error}</div>}
      {children}
    </Dialog>
    <AlertDialog
      open={discardOpen}
      title="Discard unsaved changes?"
      description="Your changes have not been saved. This action cannot be undone."
      confirmLabel="Discard changes"
      variant="warning"
      icon="warning"
      onCancel={() => setDiscardOpen(false)}
      onConfirm={onClose}
    />
  </>
}
