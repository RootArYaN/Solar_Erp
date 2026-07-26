import { Archive, Download, FileImage, ImageUp, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPoster, getPosters, setPosterStatus } from '../../api/operations'
import { downloadStoredFile, uploadStoredFile } from '../../api/files'
import type { Poster } from '../../erp-types'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { ScrollSurface, TabStrip, WorkspaceHeader, WorkspacePage } from '../workspace'

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function PosterUploadPage({ session }: { session: Session }) {
  const [posters, setPosters] = useState<Poster[] | null>(null)
  const [status, setStatus] = useState<'active' | 'archived' | 'draft'>('active')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'posters')
  const { toast } = useToast()

  const load = useCallback(async () => { setError(''); try { setPosters(await getPosters(status)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load posters') } }, [status])
  useEffect(() => { void load() }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true)
    const form = event.currentTarget; const values = new FormData(form); const file = values.get('file')
    if (!(file instanceof File) || !file.size) { toast({ message: 'Choose a poster file', variant: 'warning' }); setWorking(false); return }
    try {
      const stored = await uploadStoredFile({ file, ownerType: 'poster', ownerId: session.company.id })
      await createPoster({ title: String(values.get('title') || file.name), description: String(values.get('description') || ''), category: String(values.get('category') || 'General'), file_id: stored.id })
      setUploadOpen(false); await load(); toast({ message: 'Poster uploaded to the shared library', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not upload poster', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function change(row: Poster, next: Poster['status']) {
    try { await setPosterStatus(row.id, next); await load(); toast({ message: next === 'archived' ? 'Poster archived' : 'Poster unarchived', variant: 'success' }) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not update poster', variant: 'error' }) }
  }

  if (!posters && !error) return <WorkspacePage className="erp-page"><LoadingSkeleton rows={6} /></WorkspacePage>
  if (!posters) return <WorkspacePage className="erp-page"><ErrorState message={error} onRetry={() => void load()} /></WorkspacePage>

  return <WorkspacePage variant="fixed-tabs" className="erp-page">
    <WorkspaceHeader className="erp-page-head"><div><span>Marketing library</span><h1>Posters</h1><p>Persistent campaign files available to authorized agents and admins.</p></div><div className="erp-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canCreate && <button className="primary-button" onClick={() => setUploadOpen(true)}><ImageUp size={15} /> Upload poster</button>}</div></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}
    <TabStrip className="erp-tabs" label="Poster status">{(['active', 'archived', 'draft'] as const).map((value) => <button className={status === value ? 'is-active' : ''} key={value} onClick={() => setStatus(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</TabStrip>
    <ScrollSurface className="poster-scroll-body">
    {posters.length ? <div className="poster-grid poster-grid--persistent">{posters.map((row) => <article className="poster-card" key={row.id}><div className="poster-card__preview"><FileImage size={34} /><span>{row.mime_type === 'application/pdf' ? 'PDF poster' : 'Image poster'}</span></div><div className="poster-card__body"><span className="soft-badge">{row.category}</span><h2>{row.title}</h2><p>{row.description || row.file_name}</p><small>Uploaded {date.format(new Date(row.created_at))}</small></div><footer><button className="secondary-button" onClick={() => void downloadStoredFile(row.file_id, row.file_name)}><Download size={14} /> Download</button>{row.status === 'archived' ? access.canArchive && <button className="secondary-button" onClick={() => void change(row, 'active')}><RotateCcw size={14} /> Unarchive</button> : access.canArchive && <button className="secondary-button" onClick={() => void change(row, 'archived')}><Archive size={14} /> Archive</button>}</footer></article>)}</div> : <EmptyState title={`No ${status} posters`} message="Upload a campaign poster or change the selected status." />}
    </ScrollSurface>

    {uploadOpen && <Modal title="Upload poster" subtitle="JPEG, PNG, WebP and PDF are supported." onClose={() => setUploadOpen(false)}><form className="erp-form" onSubmit={submit}><div className="erp-form-grid"><label><span>Title</span><input name="title" required /></label><label><span>Category</span><input name="category" defaultValue="Residential campaign" /></label><label className="erp-form-wide"><span>Description</span><textarea name="description" /></label><label className="erp-form-wide"><span>Poster file</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setUploadOpen(false)}>Cancel</button><button className="primary-button" disabled={working}>{working && <LoaderCircle className="spin" size={14} />} Upload</button></footer></form></Modal>}
  </WorkspacePage>
}
