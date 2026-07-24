import { Archive, Download, Eye, FileImage, FileText, RotateCcw, Search, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UploadStatus as UploadState } from '../../contracts/api-contracts'
import { validateUpload } from '../../lib/file-validation'
import { getModuleAccess } from '../../lib/permissions'
import { useOnlineStatus } from '../../lib/use-online-status'
import { useUnsavedChanges } from '../../lib/use-unsaved-changes'
import type { Session } from '../../types'
import { UploadStatus } from '../files/UploadStatus'
import { AlertDialog } from '../ui/AlertDialog'
import { DataFreshness, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'

type PosterFile = {
  id: string
  name: string
  title: string
  type: string
  size: number
  url: string
  kind: 'image' | 'pdf'
  status: UploadState
  progress: number
  failureMessage: string | null
  previewExpiresAt: string | null
  archivedAt: string | null
}

type PosterFilter = 'all' | 'image' | 'pdf' | 'archived'

const acceptedPosterFormats = '.jpg,.jpeg,.png,.webp,.gif,.svg,.avif,.bmp,.pdf,image/*,application/pdf'

function posterTitle(filename: string) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replaceAll(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PosterUploadPage({ session }: { session: Session }) {
  const [posters, setPosters] = useState<PosterFile[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PosterFilter>('all')
  const [dragActive, setDragActive] = useState(false)
  const [previewPoster, setPreviewPoster] = useState<PosterFile | null>(null)
  const [posterToArchive, setPosterToArchive] = useState<PosterFile | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const postersRef = useRef<PosterFile[]>([])
  const { toast } = useToast()
  const access = getModuleAccess(session, 'posters')
  const online = useOnlineStatus()
  useUnsavedChanges(posters.length > 0)

  useEffect(() => {
    postersRef.current = posters
  }, [posters])

  useEffect(() => () => {
    postersRef.current.forEach((poster) => URL.revokeObjectURL(poster.url))
  }, [])

  const visiblePosters = useMemo(() => {
    const term = search.trim().toLowerCase()
    return posters.filter((poster) => (
      (filter === 'archived' ? Boolean(poster.archivedAt) : !poster.archivedAt && (filter === 'all' || poster.kind === filter))
      && (!term || `${poster.title} ${poster.name}`.toLowerCase().includes(term))
    ))
  }, [filter, posters, search])

  function addPosters(files?: FileList | File[] | null) {
    if (!files || files.length === 0) return
    const accepted: PosterFile[] = []
    const rejected: string[] = []

    Array.from(files).forEach((file) => {
      const kind = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
      const validation = validateUpload(file, { maxBytes: 25 * 1024 * 1024, allowedMimeTypes: ['image/*', 'application/pdf'] })
      if ('message' in validation) {
        rejected.push(validation.message)
        return
      }
      accepted.push({
        id: crypto.randomUUID(),
        name: file.name,
        title: posterTitle(file.name),
        type: file.type || file.name.split('.').pop()?.toUpperCase() || 'File',
        size: file.size,
        url: URL.createObjectURL(file),
        kind,
        status: 'pending',
        progress: 0,
        failureMessage: null,
        previewExpiresAt: null,
        archivedAt: null,
      })
    })

    if (accepted.length) {
      setPosters((current) => [...accepted, ...current])
      toast({ message: `${accepted.length} poster${accepted.length === 1 ? '' : 's'} added`, variant: 'success' })
    }
    if (rejected.length) {
      toast({ message: `Skipped: ${rejected.join('; ')}`, variant: 'warning' })
    }
    if (inputRef.current) inputRef.current.value = ''
  }


  function retryPoster(id: string) {
    setPosters((current) => current.map((poster) => poster.id === id
      ? { ...poster, status: 'pending', progress: 0, failureMessage: null }
      : poster))
    toast({ message: 'Upload queued for retry when the signed upload endpoint is connected', variant: 'info' })
  }

  function togglePosterArchive() {
    if (!posterToArchive) return
    const restoring = Boolean(posterToArchive.archivedAt)
    setPosters((current) => current.map((item) => item.id === posterToArchive.id
      ? { ...item, archivedAt: restoring ? null : new Date().toISOString(), status: restoring ? 'pending' : 'cancelled', progress: restoring ? 0 : item.progress }
      : item))
    if (!restoring && previewPoster?.id === posterToArchive.id) setPreviewPoster(null)
    toast({ message: `${posterToArchive.title} ${restoring ? 'restored' : 'archived'}`, variant: 'success' })
    setPosterToArchive(null)
  }

  function renamePoster(id: string, title: string) {
    setPosters((current) => current.map((poster) => poster.id === id ? { ...poster, title } : poster))
  }

  function notifyDownload(poster: PosterFile) {
    toast({ message: `Downloading ${poster.name}`, variant: 'info' })
  }

  return (
    <>
      <section className="poster-page">
        <DataFreshness offline={!online} stale updatedAt={null} />
        {access.readOnly && <ReadOnlyNotice />}
        <header className="poster-toolbar">
          <div><strong>Posters</strong></div>
          <div className="poster-toolbar__controls">
            <div className="search-control poster-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posters" />
            </div>
            <div className="poster-filter" aria-label="Poster type filter">
              {(['all', 'image', 'pdf', 'archived'] as PosterFilter[]).map((value) => (
                <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                  {value === 'all' ? 'All' : value === 'image' ? 'Images' : value === 'pdf' ? 'PDF' : 'Archived'}
                </button>
              ))}
            </div>
            <button className="primary-button primary-button--compact" disabled={!access.canCreate} onClick={() => inputRef.current?.click()}><Upload size={15} /> Upload</button>
            <input ref={inputRef} type="file" accept={acceptedPosterFormats} multiple hidden onChange={(event) => addPosters(event.target.files)} />
          </div>
        </header>

        <div
          className={`poster-drop-zone ${dragActive ? 'poster-drop-zone--active' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (!access.canCreate) return
            setDragActive(false)
            addPosters(event.dataTransfer.files)
          }}
        >
          <Upload size={18} />
          <span>Drop posters here</span>
          <small>Images or PDF · 25 MB max</small>
        </div>

        <div className="poster-library-heading">
          <span>{visiblePosters.length} / {posters.length}</span>
        </div>

        <div className="poster-grid">
          {visiblePosters.map((poster) => (
            <article className={`poster-card ${poster.archivedAt ? 'is-archived' : ''}`} key={poster.id}>
              <button className="poster-frame" disabled={Boolean(poster.archivedAt)} onClick={() => setPreviewPoster(poster)} aria-label={`Preview ${poster.title}`}>
                <div className="poster-frame__mat">
                  {poster.kind === 'image'
                    ? <img src={poster.url} alt={poster.title} />
                    : <object data={`${poster.url}#toolbar=0&navpanes=0&scrollbar=0`} type="application/pdf" tabIndex={-1} aria-label={poster.title}>
                        <FileText size={36} />
                      </object>}
                </div>
                <span className={`poster-format poster-format--${poster.kind}`}>{poster.kind === 'pdf' ? 'PDF' : 'IMAGE'}</span>
              </button>
              <div className="poster-card__details">
                <input disabled={!access.canEdit || Boolean(poster.archivedAt)} value={poster.title} onChange={(event) => renamePoster(poster.id, event.target.value)} aria-label="Poster title" />
                <span title={poster.name}>{poster.name}</span>
                <small>{fileSize(poster.size)}</small>
                {poster.archivedAt ? <small>Archived · restorable</small> : <UploadStatus status={poster.status} progress={poster.progress} failureMessage={poster.failureMessage} onRetry={() => retryPoster(poster.id)} onCancel={access.canArchive ? () => setPosterToArchive(poster) : undefined} />}
              </div>
              <div className="poster-card__actions">
                {!poster.archivedAt && <button onClick={() => setPreviewPoster(poster)} title="Preview" aria-label={`Preview ${poster.title}`}><Eye size={14} /></button>}
                {!poster.archivedAt && <a href={poster.url} download={poster.name} onClick={() => notifyDownload(poster)} title="Download" aria-label={`Download ${poster.title}`}><Download size={14} /></a>}
                <button onClick={() => setPosterToArchive(poster)} disabled={!access.canArchive} title={poster.archivedAt ? 'Restore' : 'Archive'} aria-label={`${poster.archivedAt ? 'Restore' : 'Archive'} ${poster.title}`}>{poster.archivedAt ? <RotateCcw size={14} /> : <Archive size={14} />}</button>
              </div>
            </article>
          ))}

          {visiblePosters.length === 0 && (
            <button className="poster-empty-card" disabled={!access.canCreate} onClick={() => inputRef.current?.click()}>
              <div><FileImage size={27} /></div>
              <strong>{posters.length ? 'No matches' : 'Upload poster'}</strong>
            </button>
          )}
        </div>
      </section>

      {previewPoster && (
        <div className="poster-preview-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPreviewPoster(null)
        }}>
          <section className="poster-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${previewPoster.title}`}>
            <header>
              <div><strong>{previewPoster.title}</strong><span>{fileSize(previewPoster.size)}</span></div>
              <div>
                <a href={previewPoster.url} download={previewPoster.name} onClick={() => notifyDownload(previewPoster)}><Download size={15} /> Download</a>
                <button onClick={() => setPreviewPoster(null)} aria-label="Close poster preview"><X size={17} /></button>
              </div>
            </header>
            <div className="poster-preview-content">
              {previewPoster.kind === 'image'
                ? <img src={previewPoster.url} alt={previewPoster.title} />
                : <object data={previewPoster.url} type="application/pdf" aria-label={previewPoster.title}>
                    <p>Preview unavailable. <a href={previewPoster.url} target="_blank" rel="noreferrer">Open PDF</a></p>
                  </object>}
            </div>
          </section>
        </div>
      )}

      <AlertDialog
        open={Boolean(posterToArchive)}
        title={`${posterToArchive?.archivedAt ? 'Restore' : 'Archive'} ${posterToArchive?.title ?? 'poster'}?`}
        confirmLabel={posterToArchive?.archivedAt ? 'Restore poster' : 'Archive poster'}
        icon="warning"
        onCancel={() => setPosterToArchive(null)}
        onConfirm={togglePosterArchive}
      />
    </>
  )
}
