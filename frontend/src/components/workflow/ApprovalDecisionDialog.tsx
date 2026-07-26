import { FormEvent, useState } from 'react'
import type { ApprovalDecisionInput } from '../../types'
import { Modal } from '../admin/Modal'

const labels = { approved: 'Approve', condition: 'Add conditions', rejected: 'Reject' } as const

export function ApprovalDecisionDialog({ title, decision, busy, onClose, onSubmit }: {
  title: string
  decision: ApprovalDecisionInput['decision']
  busy: boolean
  onClose: () => void
  onSubmit: (value: ApprovalDecisionInput) => Promise<void>
}) {
  const [comment, setComment] = useState(decision === 'approved' ? 'Reviewed and approved.' : '')
  const requiresComment = decision !== 'approved'
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit({ decision, comment })
  }
  return <Modal title={`${labels[decision]} ${title}`} onClose={onClose}>
    <form className="admin-form" onSubmit={submit}>
      <label className="field"><span>{decision === 'condition' ? 'Approval conditions' : 'Decision comment'}</span><textarea autoFocus required={requiresComment} minLength={requiresComment ? 3 : undefined} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={decision === 'condition' ? 'State the changes required before approval' : decision === 'rejected' ? 'State why this was rejected' : 'Optional approval note'} /></label>
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className={decision === 'rejected' ? 'danger-button' : 'primary-button primary-button--compact'} disabled={busy || (requiresComment && comment.trim().length < 3)}>{busy ? 'Saving…' : labels[decision]}</button></footer>
    </form>
  </Modal>
}
