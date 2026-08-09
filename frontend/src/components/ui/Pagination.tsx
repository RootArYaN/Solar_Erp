import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  loading?: boolean
  compact?: boolean
  className?: string
  onPageChange: (page: number) => void
}

export function Pagination({
  page,
  pageSize,
  total,
  loading = false,
  compact = false,
  className = '',
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null

  const safePage = Math.min(Math.max(1, page), totalPages)
  return (
    <nav
      className={['ui-pagination', compact ? 'ui-pagination--compact' : '', className].filter(Boolean).join(' ')}
      aria-label="Pagination"
    >
      <button
        type="button"
        className="ui-pagination__button"
        disabled={safePage <= 1 || loading}
        onClick={() => onPageChange(safePage - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
        <span>Previous</span>
      </button>
      <div className="ui-pagination__status" aria-live="polite">
        <strong>{safePage}</strong>
        <span>/</span>
        <strong>{totalPages}</strong>
        {!compact && <small>{total.toLocaleString('en-IN')} records</small>}
      </div>
      <button
        type="button"
        className="ui-pagination__button"
        disabled={safePage >= totalPages || loading}
        onClick={() => onPageChange(safePage + 1)}
        aria-label="Next page"
      >
        <span>Next</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
