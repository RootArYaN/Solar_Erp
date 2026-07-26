import type { HTMLAttributes, ReactNode } from 'react'

interface DataTableSurfaceProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  toolbar?: ReactNode
  className?: string
  scrollClassName?: string
}

export function DataTableSurface({ children, toolbar, className = '', scrollClassName = '', ...props }: DataTableSurfaceProps) {
  return (
    <section {...props} className={['data-table-surface', className].filter(Boolean).join(' ')}>
      {toolbar}
      <div className={['data-table-scroll', scrollClassName].filter(Boolean).join(' ')} data-scroll-surface="table">
        {children}
      </div>
    </section>
  )
}
