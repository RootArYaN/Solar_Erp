import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

interface KpiGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4 | 5 | 6 | 8
  children: ReactNode
  className?: string
}

export function KpiGrid({ columns = 4, children, className = '', style, ...props }: KpiGridProps) {
  return (
    <div
      {...props}
      className={['workspace-kpi-grid', className].filter(Boolean).join(' ')}
      style={{ ...style, '--workspace-kpi-columns': columns } as CSSProperties}
    >
      {children}
    </div>
  )
}
