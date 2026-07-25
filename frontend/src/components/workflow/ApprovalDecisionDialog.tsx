import { FormEvent, useState } from 'react'
import type { ApprovalDecisionInput } from '../../types'
import { Modal } from '../admin/Modal'

export function ApprovalDecisionDialog({ title, decision, busy, onClose, onSubmit }: {
  title: string
  decision: 'approved' | 'rejected'
  busy: boolean
  onClose: () => void
  onSubmit: (value: ApprovalDecisionInput) => Promise<void>
}) {
  const [comment, setComment] = useState(decision === 'approved' ? 'Reviewed and approved.' : '')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit({ decision, comment })
  }
  return <Modal title={`${decision === 'approved' ? 'Approve' : 'Reject'} ${title}`} onClose={onClose}>
    <form className="admin-form" onSubmit={submit}>
      <label className="field"><span>Decision comment</span><textarea autoFocus required={decision === 'rejected'} minLength={decision === 'rejected' ? 3 : undefined} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={decision === 'rejected' ? 'State why this was rejected' : 'Optional approval note'} /></label>
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className={decision === 'approved' ? 'primary-button primary-button--compact' : 'danger-button'} disabled={busy || (decision === 'rejected' && comment.trim().length < 3)}>{busy ? 'Saving…' : decision === 'approved' ? 'Approve' : 'Reject'}</button></footer>
    </form>
  </Modal>
}
