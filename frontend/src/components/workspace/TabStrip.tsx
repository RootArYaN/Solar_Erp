import type { HTMLAttributes, ReactNode } from 'react'

interface TabStripProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  className?: string
  label?: string
}

export function TabStrip({ children, className = '', label, ...props }: TabStripProps) {
  return (
    <nav {...props} className={['workspace-tab-strip', className].filter(Boolean).join(' ')} aria-label={label}>
      {children}
    </nav>
  )
}
