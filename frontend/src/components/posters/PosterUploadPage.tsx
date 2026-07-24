import { Download, Eye, FileImage, FileText, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog } from '../ui/AlertDialog'
import { useToast } from '../ui/ToastProvider'

type PosterFile = {
  id: string
  name: string
  title: string
  type: string
  size: number
  url: string
  kind: 'image' | 'pdf'
}

type PosterFilter = 'all' | 'image' | 'pdf'

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

export function PosterUploadPage() {
  const [posters, setPosters] = useState<PosterFile[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PosterFilter>('all')
  const [dragActive, setDragActive] = useState(false)
  const [previewPoster, setPreviewPoster] = useState<PosterFile | null>(null)
  const [posterToDelete, setPosterToDelete] = useState<PosterFile | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const postersRef = useRef<PosterFile[]>([])
  const { toast } = useToast()

  useEffect(() => {
    postersRef.current = posters
  }, [posters])

  useEffect(() => () => {
    postersRef.current.forEach((poster) => URL.revokeObjectURL(poster.url))
  }, [])

  const visiblePosters = useMemo(() => {
    const term = search.trim().toLowerCase()
    return posters.filter((poster) => (
      (filter === 'all' || poster.kind === filter)
      && (!term || `${poster.title} ${poster.name}`.toLowerCase().includes(term))
    ))
  }, [filter, posters, search])

  function addPosters(files?: FileList | File[] | null) {
    if (!files || files.length === 0) return
    const accepted: PosterFile[] = []
    const rejected: string[] = []

    Array.from(files).forEach((file) => {
      const kind = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
      const supported = kind === 'pdf' || file.type.startsWith('image/')
      if (!supported || file.size > 25 * 1024 * 1024) {
        rejected.push(file.name)
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
      })
    })

    if (accepted.length) {
      setPosters((current) => [...accepted, ...current])
      toast({ message: `${accepted.length} poster${accepted.length === 1 ? '' : 's'} added`, variant: 'success' })
    }
    if (rejected.length) {
      toast({ message: `Skipped: ${rejected.join(', ')}`, variant: 'warning' })
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  function removePoster() {
    if (!posterToDelete) return
    const removed = posterToDelete
    setPosters((current) => current.filter((item) => item.id !== removed.id))
    URL.revokeObjectURL(removed.url)
    if (previewPoster?.id === removed.id) setPreviewPoster(null)
    setPosterToDelete(null)
    toast({ message: `${removed.title} removed`, variant: 'success' })
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
        <header className="poster-toolbar">
          <div><strong>Posters</strong></div>
          <div className="poster-toolbar__controls">
            <div className="search-control poster-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posters" />
            </div>
            <div className="poster-filter" aria-label="Poster type filter">
              {(['all', 'image', 'pdf'] as PosterFilter[]).map((value) => (
                <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                  {value === 'all' ? 'All' : value === 'image' ? 'Images' : 'PDF'}
                </button>
              ))}
            </div>
            <button className="primary-button primary-button--compact" onClick={() => inputRef.current?.click()}><Upload size={15} /> Upload</button>
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
            <article className="poster-card" key={poster.id}>
              <button className="poster-frame" onClick={() => setPreviewPoster(poster)} aria-label={`Preview ${poster.title}`}>
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
                <input value={poster.title} onChange={(event) => renamePoster(poster.id, event.target.value)} aria-label="Poster title" />
                <span title={poster.name}>{poster.name}</span>
                <small>{fileSize(poster.size)}</small>
              </div>
              <div className="poster-card__actions">
                <button onClick={() => setPreviewPoster(poster)} title="Preview" aria-label={`Preview ${poster.title}`}><Eye size={14} /></button>
                <a href={poster.url} download={poster.name} onClick={() => notifyDownload(poster)} title="Download" aria-label={`Download ${poster.title}`}><Download size={14} /></a>
                <button onClick={() => setPosterToDelete(poster)} title="Delete" aria-label={`Delete ${poster.title}`}><Trash2 size={14} /></button>
              </div>
            </article>
          ))}

          {visiblePosters.length === 0 && (
            <button className="poster-empty-card" onClick={() => inputRef.current?.click()}>
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
        open={Boolean(posterToDelete)}
        title={`Delete ${posterToDelete?.title ?? 'poster'}?`}
        confirmLabel="Delete poster"
        icon="delete"
        onCancel={() => setPosterToDelete(null)}
        onConfirm={removePoster}
      />
    </>
  )
}
