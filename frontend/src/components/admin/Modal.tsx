import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, subtitle, children, className = '', hideTitle = false, onClose }: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  hideTitle?: boolean
  onClose: () => void
}) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <header className={`modal-card__header ${hideTitle ? 'modal-card__header--titleless' : ''}`}>
          {!hideTitle && <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>}
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="modal-card__body" data-scroll-surface="modal-body">{children}</div>
      </section>
    </div>
  )
}
