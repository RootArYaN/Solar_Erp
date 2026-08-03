import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type KpiColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 8
type PhoneColumnCount = 1 | 2

interface KpiGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: KpiColumnCount
  phoneColumns?: PhoneColumnCount
  children: ReactNode
  className?: string
  responsive?: boolean
}

export function KpiGrid({
  columns = 4,
  phoneColumns = 2,
  children,
  className = '',
  responsive = false,
  style,
  ...props
}: KpiGridProps) {
  return (
    <div
      {...props}
      className={['workspace-kpi-grid', 'ui-kpi-grid', className].filter(Boolean).join(' ')}
      data-columns={columns}
      data-phone-columns={phoneColumns}
      data-responsive={responsive ? 'true' : undefined}
      style={{ ...style, '--workspace-kpi-columns': columns } as CSSProperties}
    >
      {children}
    </div>
  )
}
