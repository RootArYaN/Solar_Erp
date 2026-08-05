import { Archive, Download, Eye, FileImage, ImageUp, LoaderCircle, Pencil, RefreshCw, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPoster, getPosters, setPosterStatus, updatePoster } from '../../api/operations'
import { downloadStoredFile, getStoredFileBlob, removeStoredFile, uploadStoredFile } from '../../api/files'
import type { Poster } from '../../erp-types'
import { fileUploadRules, validateUploadFile } from '../../lib/file-validation'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { AlertDialog } from '../ui/AlertDialog'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { ScrollSurface, TabButton, TabStrip, WorkspaceHeader, WorkspacePage } from '../workspace'

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function PosterUploadPage({ session }: { session: Session }) {
  const [posters, setPosters] = useState<Poster[] | null>(null)
  const [status, setStatus] = useState<'active' | 'draft'>('active')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<Poster | null>(null)
  const [deleting, setDeleting] = useState<Poster | null>(null)
  const [preview, setPreview] = useState<{ poster: Poster; url: string } | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'posters')
  const { toast } = useToast()

  const load = useCallback(async () => {
    setError('')
    try { setPosters(await getPosters(status)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load posters') }
  }, [status])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!preview) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWorking(true)
    const form = event.currentTarget
    const values = new FormData(form)
    const file = values.get('file')
    if (!(file instanceof File) || !file.size) {
      toast({ message: 'Choose a poster file', variant: 'warning' })
      setWorking(false)
      return
    }
    const validation = await validateUploadFile(file, fileUploadRules.poster)
    if ('message' in validation) {
      toast({ message: validation.message, variant: 'warning' })
      setWorking(false)
      return
    }
    let uploadedFileId: string | null = null
    let posterCreated = false
    try {
      const stored = await uploadStoredFile({ file, ownerType: 'poster', ownerId: session.company.id })
      uploadedFileId = stored.id
      await createPoster({
        title: String(values.get('title') || file.name),
        description: String(values.get('description') || ''),
        category: String(values.get('category') || 'General'),
        file_id: stored.id,
      })
      posterCreated = true
      setUploadOpen(false)
      setStatus('active')
      await load()
      toast({ message: 'Poster uploaded to the shared library', variant: 'success' })
    } catch (reason) {
      if (uploadedFileId && !posterCreated) {
        await removeStoredFile(uploadedFileId).catch(() => undefined)
      }
      toast({ message: reason instanceof Error ? reason.message : 'Could not upload poster', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function openPreview(row: Poster) {
    setPreviewingId(row.id)
    try {
      const blob = await getStoredFileBlob(row.file_id)
      setPreview({ poster: row, url: URL.createObjectURL(blob) })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not preview poster', variant: 'error' })
    } finally {
      setPreviewingId(null)
    }
  }

  async function editPoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    setWorking(true)
    const values = new FormData(event.currentTarget)
    try {
      await updatePoster(editing.id, {
        version: editing.version,
        title: String(values.get('title') || '').trim(),
        description: String(values.get('description') || '').trim(),
        category: String(values.get('category') || '').trim(),
      })
      setEditing(null)
      await load()
      toast({ message: 'Poster details updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update poster', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function movePoster(row: Poster) {
    const nextStatus = row.status === 'active' ? 'draft' : 'active'
    setWorking(true)
    try {
      await setPosterStatus(row.id, nextStatus)
      await load()
      toast({
        message: nextStatus === 'draft' ? 'Poster saved to drafts' : 'Draft published to posters',
        variant: 'success',
      })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not change poster status', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function deletePoster() {
    if (!deleting) return
    setWorking(true)
    try {
      await removeStoredFile(deleting.file_id)
      setDeleting(null)
      await load()
      toast({ message: 'Poster removed', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not remove poster', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  if (!posters && !error) return <WorkspacePage className="erp-page"><LoadingSkeleton rows={6} /></WorkspacePage>
  if (!posters) return <WorkspacePage className="erp-page"><ErrorState message={error} onRetry={() => void load()} /></WorkspacePage>

  return <WorkspacePage variant="fixed-tabs" className="erp-page">
    <WorkspaceHeader className="erp-page-head"><div><span>Marketing library</span><h1>Posters</h1></div><div className="erp-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canCreate && <button className="primary-button" onClick={() => setUploadOpen(true)}><ImageUp size={15} /> Upload poster</button>}</div></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}
    <TabStrip className="erp-tabs" label="Poster status">{(['active', 'draft'] as const).map((value) => <TabButton active={status === value} key={value} onClick={() => setStatus(value)}>{value === 'active' ? 'Posters' : 'Drafts'}</TabButton>)}</TabStrip>
    <ScrollSurface className="poster-scroll-body">
      {posters.length ? <div className="poster-grid poster-grid--persistent">
        {posters.map((row) => <article className="poster-card" key={row.id}>
          <button className="poster-frame" type="button" onClick={() => void openPreview(row)} disabled={previewingId === row.id} aria-label={`Preview ${row.title}`}>
            <span className="poster-frame__mat">
              {previewingId === row.id ? <LoaderCircle className="spin" size={32} /> : <FileImage size={42} />}
              <small>{previewingId === row.id ? 'Loading preview…' : 'Click to preview'}</small>
            </span>
            <span className={`poster-format${row.mime_type === 'application/pdf' ? ' poster-format--pdf' : ''}`}>{row.mime_type === 'application/pdf' ? 'PDF' : 'IMAGE'}</span>
          </button>
          <div className="poster-card__body">
            <h2>{row.title}</h2>
            <p>{row.description || row.file_name}</p>
            <small>Uploaded {date.format(new Date(row.created_at))}</small>
          </div>
          <footer className="poster-card__actions">
            <button type="button" onClick={() => void openPreview(row)} disabled={previewingId === row.id} title="Preview poster"><Eye size={14} /></button>
            <button type="button" onClick={() => void downloadStoredFile(row.file_id, row.file_name)} title="Download poster"><Download size={14} /></button>
            {access.canEdit && <>
              <button type="button" onClick={() => setEditing(row)} title="Edit poster details"><Pencil size={14} /></button>
              <button className="poster-card__delete" type="button" onClick={() => setDeleting(row)} title="Remove poster"><Trash2 size={14} /></button>
              <button type="button" onClick={() => void movePoster(row)} disabled={working} title={row.status === 'active' ? 'Save to drafts' : 'Publish poster'}>
                {row.status === 'active' ? <Archive size={14} /> : <Send size={14} />}
                <span>{row.status === 'active' ? 'To drafts' : 'Publish'}</span>
              </button>
              
            </>}
          </footer>
        </article>)}
      </div> : <EmptyState title={`No ${status === 'active' ? 'posters' : 'drafts'}`} message={status === 'active' ? 'Upload a campaign poster or publish one from Drafts.' : 'Posters saved as drafts will appear here.'} />}
    </ScrollSurface>

    {uploadOpen && <Modal title="Upload poster" subtitle="JPEG, PNG, WebP and PDF are supported." onClose={() => setUploadOpen(false)}><form className="erp-form" onSubmit={submit}><div className="erp-form-grid"><label><span>Title</span><input name="title" required /></label><label><span>Category</span><input name="category" defaultValue="Residential campaign" /></label><label className="erp-form-wide"><span>Description</span><textarea name="description" /></label><label className="erp-form-wide"><span>Poster file</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setUploadOpen(false)}>Cancel</button><button className="primary-button" disabled={working}>{working && <LoaderCircle className="spin" size={14} />} Upload</button></footer></form></Modal>}
    {editing && <Modal title="Edit poster" subtitle="Update the poster title, category and description." onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={editPoster}>
        <div className="erp-form-grid">
          <label><span>Title</span><input name="title" defaultValue={editing.title} required /></label>
          <label><span>Category</span><input name="category" defaultValue={editing.category} required /></label>
          <label className="erp-form-wide"><span>Description</span><textarea name="description" defaultValue={editing.description} /></label>
        </div>
        <footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={working}>{working && <LoaderCircle className="spin" size={14} />} Save changes</button></footer>
      </form>
    </Modal>}
    <AlertDialog
      open={Boolean(deleting)}
      title="Remove poster?"
      description={deleting ? `"${deleting.title}" and its uploaded file will be permanently removed.` : undefined}
      confirmLabel="Remove poster"
      icon="delete"
      loading={working}
      onCancel={() => setDeleting(null)}
      onConfirm={deletePoster}
    />
    {preview && <div className="poster-preview-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setPreview(null)
    }}>
      <section className="poster-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${preview.poster.title}`}>
        <header>
          <div><strong>{preview.poster.title}</strong><span>{preview.poster.file_name}</span></div>
          <div>
            <button type="button" onClick={() => void downloadStoredFile(preview.poster.file_id, preview.poster.file_name)} title="Download poster"><Download size={14} /></button>
            <button type="button" onClick={() => setPreview(null)} aria-label="Close preview"><X size={16} /></button>
          </div>
        </header>
        <div className="poster-preview-content">
          {preview.poster.mime_type === 'application/pdf'
            ? <object data={preview.url} type="application/pdf"><p>PDF preview is unavailable. Use Download to open the poster.</p></object>
            : <img src={preview.url} alt={preview.poster.title} />}
        </div>
      </section>
    </div>}
  </WorkspacePage>
}
