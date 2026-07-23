import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, subtitle, children, onClose }: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-card__header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}
