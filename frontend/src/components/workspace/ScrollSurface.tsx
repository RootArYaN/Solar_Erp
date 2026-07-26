import type { HTMLAttributes, ReactNode } from 'react'

export type ScrollSurfaceAxis = 'vertical' | 'horizontal' | 'both'

interface ScrollSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  axis?: ScrollSurfaceAxis
  className?: string
}

export function ScrollSurface({ children, axis = 'vertical', className = '', ...props }: ScrollSurfaceProps) {
  return (
    <div
      {...props}
      className={['workspace-scroll-surface', `workspace-scroll-surface--${axis}`, className].filter(Boolean).join(' ')}
      data-scroll-surface={axis}
    >
      {children}
    </div>
  )
}
